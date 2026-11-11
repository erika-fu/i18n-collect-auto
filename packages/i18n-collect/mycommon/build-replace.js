const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const { SourceMapConsumer, SourceMapGenerator } = require('source-map')
const { SCRIPT_EXTENSIONS } = require('./replace-preview')
const { ReplacementPlanner } = require('./replacement-planner')
const { parseTemplate } = require('../myloader/template-parser')

const PARSE = { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] }
const TEMPLATE_KINDS = new Set(['html-text', 'html-attribute', 'template-expression'])
const MISMATCH = 'catalog location does not match the current source'

function positionAt(source, index) {
  let line = 1
  let column = 0
  for (let cursor = 0; cursor < index && cursor < source.length; cursor += 1) {
    const char = source[cursor]
    if (char === '\n') {
      line += 1
      column = 0
    } else if (char === '\r') {
      if (source[cursor + 1] === '\n') cursor += 1
      line += 1
      column = 0
    } else {
      column += 1
    }
  }
  return { line, column }
}

function applyEditsWithSegments(source, edits) {
  const ordered = [...edits].sort((left, right) => left.start - right.start)
  let code = ''
  let cursor = 0
  const segments = []
  for (const edit of ordered) {
    if (edit.start > cursor) {
      const chunk = source.slice(cursor, edit.start)
      segments.push({
        generatedStart: code.length,
        originalStart: cursor,
        generatedLength: chunk.length,
        originalLength: chunk.length,
        copied: true
      })
      code += chunk
    }
    segments.push({
      generatedStart: code.length,
      originalStart: edit.start,
      generatedLength: edit.text.length,
      originalLength: Math.max(edit.end - edit.start, 0),
      copied: false
    })
    code += edit.text
    cursor = edit.end
  }
  if (cursor < source.length) {
    const chunk = source.slice(cursor)
    segments.push({
      generatedStart: code.length,
      originalStart: cursor,
      generatedLength: chunk.length,
      originalLength: chunk.length,
      copied: true
    })
    code += chunk
  }
  return { code, segments }
}

function originalIndexFor(generatedIndex, segments, prefixLength) {
  const bodyIndex = generatedIndex - prefixLength
  if (bodyIndex < 0) return 0
  for (const segment of segments) {
    const end = segment.generatedStart + segment.generatedLength
    if (bodyIndex < segment.generatedStart || bodyIndex >= end) continue
    if (segment.copied) {
      return segment.originalStart + (bodyIndex - segment.generatedStart)
    }
    const ratio = segment.generatedLength === 0
      ? 0
      : (bodyIndex - segment.generatedStart) / segment.generatedLength
    return segment.originalStart + Math.floor(ratio * segment.originalLength)
  }
  if (segments.length === 0) return bodyIndex
  const last = segments[segments.length - 1]
  return last.originalStart + last.originalLength
}

function buildSourceMap(original, generated, sourceFile, prefixLength, segments) {
  const generator = new SourceMapGenerator({ file: sourceFile })
  generator.setSourceContent(sourceFile, original)
  let offset = 0
  const lines = generated.split('\n')
  for (let line = 1; line <= lines.length; line += 1) {
    const lineText = lines[line - 1]
    const columns = line === lines.length ? [0] : [0, Math.max(lineText.length - 1, 0)]
    for (const column of new Set(columns)) {
      const generatedIndex = offset + column
      const originalIndex = originalIndexFor(generatedIndex, segments, prefixLength)
      const originalPosition = positionAt(original, Math.min(originalIndex, original.length))
      generator.addMapping({
        generated: { line, column },
        original: originalPosition,
        source: sourceFile
      })
    }
    offset += lineText.length + (line === lines.length ? 0 : 1)
  }
  return generator.toJSON()
}

function composeSourceMaps(transformMap, incomingMap, file) {
  if (!transformMap) return incomingMap || null
  if (!incomingMap) return transformMap
  const generator = SourceMapGenerator.fromSourceMap(new SourceMapConsumer(transformMap))
  generator.applySourceMap(new SourceMapConsumer(incomingMap), file)
  return generator.toJSON()
}

function isRequireHelperBinding(binding) {
  if (!binding || !binding.path) return false
  let current = binding.path
  while (current && !current.isVariableDeclarator()) current = current.parentPath
  if (!current) return false
  const init = current.node.init
  return Boolean(
    init
    && init.type === 'CallExpression'
    && init.callee.type === 'Identifier'
    && init.callee.name === 'require'
  )
}

function isReusableHelperBinding(binding) {
  if (!binding) return false
  if (binding.kind === 'module') return true
  return isRequireHelperBinding(binding)
}

function inspectSource(source, runtimeExport = 't') {
  let ast
  try {
    ast = parser.parse(source, PARSE)
  } catch (error) {
    return { bindings: new Set(), esm: false, reusableHelper: false, error }
  }
  let esm = ast.program.sourceType === 'module'
  let bindings = new Set()
  let reusableHelper = false
  traverse(ast, {
    Program(nodePath) {
      bindings = new Set(Object.keys(nodePath.scope.bindings))
      reusableHelper = isReusableHelperBinding(nodePath.scope.getBinding(runtimeExport))
    },
    ImportDeclaration() {
      esm = true
    },
    ExportNamedDeclaration() {
      esm = true
    },
    ExportDefaultDeclaration() {
      esm = true
    },
    ExportAllDeclaration() {
      esm = true
    }
  })
  return { bindings, esm, reusableHelper, error: null }
}

function chooseHelperName(bindings) {
  if (!bindings.has('t')) return 't'
  let index = 0
  while (true) {
    const name = index === 0 ? '__i18n_t' : `__i18n_t${index}`
    if (!bindings.has(name)) return name
    index += 1
  }
}

function runtimeRequest(root, runtimeModule, resourcePath) {
  const absoluteRuntime = path.resolve(root, runtimeModule)
  let relative = path.relative(path.dirname(resourcePath), absoluteRuntime)
  relative = relative.split(path.sep).join('/')
  if (!relative.startsWith('.')) relative = `./${relative}`
  return relative
}

function injectionStatement(esm, helperName, runtimeExport, request) {
  const moduleLiteral = JSON.stringify(request)
  if (esm) {
    if (helperName === runtimeExport) return `import { ${runtimeExport} } from ${moduleLiteral}\n`
    return `import { ${runtimeExport} as ${helperName} } from ${moduleLiteral}\n`
  }
  if (helperName === runtimeExport) return `const { ${runtimeExport} } = require(${moduleLiteral})\n`
  return `const { ${runtimeExport}: ${helperName} } = require(${moduleLiteral})\n`
}

function vueScriptBlocks(source) {
  const blocks = []
  const pattern = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi
  let match = pattern.exec(source)
  while (match) {
    const openTag = match[0].slice(0, match[0].length - match[2].length - '</script>'.length)
    const innerStart = match.index + openTag.length
    const inner = match[2]
    blocks.push({
      setup: /\bsetup\b/.test(match[1] || ''),
      innerStart,
      innerEnd: innerStart + inner.length,
      inner
    })
    match = pattern.exec(source)
  }
  return blocks
}

function helperCallPrefix(helperName) {
  return `${helperName}(`
}

function isReusableAlias(source, helperName, runtimeExport) {
  let ast
  try {
    ast = parser.parse(source, PARSE)
  } catch (error) {
    return false
  }
  let reusable = false
  traverse(ast, {
    ImportDeclaration(nodePath) {
      for (const specifier of nodePath.node.specifiers || []) {
        if (specifier.type !== 'ImportSpecifier') continue
        const local = specifier.local && specifier.local.name
        const imported = specifier.imported && specifier.imported.name
        if (local === helperName && imported === runtimeExport) reusable = true
      }
    },
    VariableDeclarator(nodePath) {
      const id = nodePath.node.id
      const init = nodePath.node.init
      if (!init || init.type !== 'CallExpression' || init.callee.type !== 'Identifier' || init.callee.name !== 'require') {
        return
      }
      if (id.type === 'ObjectPattern') {
        reusable = id.properties.some(property => (
          property.type === 'ObjectProperty'
          && !property.computed
          && property.key.type === 'Identifier'
          && property.key.name === runtimeExport
          && property.value.type === 'Identifier'
          && property.value.name === helperName
        )) || reusable
      }
    }
  })
  return reusable
}

function chooseVueHelperName(source, runtimeExport) {
  const bindings = new Set()
  let anyReusable = false
  for (const block of vueScriptBlocks(source)) {
    const inspected = inspectSource(block.inner, runtimeExport)
    for (const name of inspected.bindings) bindings.add(name)
    if (inspected.reusableHelper) anyReusable = true
  }
  if (anyReusable || !bindings.has(runtimeExport)) {
    return runtimeExport
  }
  return chooseHelperName(bindings)
}

function templateMismatchError(planned) {
  const mismatch = planned.skipped.find(item => (
    TEMPLATE_KINDS.has(item.kind) && item.reason === MISMATCH
  ))
  if (!mismatch) return null
  return new Error(MISMATCH)
}

function transformScriptBuildReplacement({
  source,
  root,
  projectPath,
  resourcePath,
  occurrences,
  adapter,
  runtimeModule,
  runtimeExport,
  styleExtensions,
  inputSourceMap
}) {
  const inspected = inspectSource(source, runtimeExport)
  if (inspected.error) {
    return { code: source, map: null, changed: false, planned: null, error: inspected.error }
  }

  const helperName = inspected.reusableHelper ? runtimeExport : chooseHelperName(inspected.bindings)
  const inject = !inspected.reusableHelper
  const planner = new ReplacementPlanner({
    adapter,
    styleExtensions,
    runtime: {
      localizationFunction: true,
      helperName,
      helperAvailable: true
    }
  })
  const planned = planner.plan({
    occurrences,
    resources: new Map([[projectPath, source]])
  })
  const fileEdits = planned.edits
    .filter(edit => edit.path === projectPath)
    .map(({ start, end, text }) => ({ start, end, text }))
  if (fileEdits.length === 0) {
    return { code: source, map: null, changed: false, planned, helperName }
  }

  const edited = applyEditsWithSegments(source, fileEdits)
  let code = edited.code
  let prefixLength = 0
  if (inject) {
    const request = runtimeRequest(root, runtimeModule, resourcePath)
    const statement = injectionStatement(inspected.esm, helperName, runtimeExport, request)
    prefixLength = statement.length
    code = statement + code
  }

  const map = composeSourceMaps(
    buildSourceMap(source, code, projectPath, prefixLength, edited.segments),
    inputSourceMap,
    projectPath
  )

  return {
    code,
    map,
    changed: true,
    planned,
    helperName,
    injected: inject
  }
}

function transformVue3BuildReplacement({
  source,
  root,
  projectPath,
  resourcePath,
  occurrences,
  runtimeModule,
  runtimeExport,
  styleExtensions,
  inputSourceMap
}) {
  let template
  try {
    template = parseTemplate({
      source,
      resource: {
        absolutePath: resourcePath,
        projectPath
      },
      standalone: false,
      config: { vueVersion: 3 }
    })
  } catch (error) {
    return { code: source, map: null, changed: false, planned: null, error }
  }

  const helperName = chooseVueHelperName(source, runtimeExport)
  const planner = new ReplacementPlanner({
    adapter: 'vue3',
    styleExtensions,
    runtime: {
      localizationFunction: true,
      helperName,
      helperAvailable: true,
      vueVersion: 3
    }
  })
  const planned = planner.plan({
    occurrences,
    resources: new Map([[projectPath, { source, template }]])
  })

  const mismatch = templateMismatchError(planned)
  if (mismatch) {
    return { code: source, map: null, changed: false, planned, helperName, error: mismatch }
  }

  const fileEdits = planned.edits
    .filter(edit => edit.path === projectPath)
    .map(({ start, end, text }) => ({ start, end, text }))

  const request = runtimeRequest(root, runtimeModule, resourcePath)
  const injectionTargets = []
  for (const block of vueScriptBlocks(source)) {
    const helperEdits = fileEdits.filter(edit => (
      edit.start >= block.innerStart
      && edit.start < block.innerEnd
      && planned.replacements.some(item => item.call && item.call.startsWith(helperCallPrefix(helperName)) && edit.text.includes(item.call))
    ))
    if (helperEdits.length === 0) continue
    const inspected = inspectSource(block.inner, runtimeExport)
    const reuse = helperName === runtimeExport
      ? inspected.reusableHelper
      : isReusableAlias(block.inner, helperName, runtimeExport)
    if (reuse) continue
    const esm = inspected.esm || block.setup || /^\s*import\b/m.test(block.inner) || /^\s*export\b/m.test(block.inner)
    injectionTargets.push({
      start: block.innerStart,
      end: block.innerStart,
      text: injectionStatement(esm, helperName, runtimeExport, request)
    })
  }

  const allEdits = [...fileEdits, ...injectionTargets]
  if (allEdits.length === 0) {
    return { code: source, map: null, changed: false, planned, helperName }
  }

  const edited = applyEditsWithSegments(source, allEdits)
  const map = composeSourceMaps(
    buildSourceMap(source, edited.code, projectPath, 0, edited.segments),
    inputSourceMap,
    projectPath
  )

  return {
    code: edited.code,
    map,
    changed: true,
    planned,
    helperName,
    injected: injectionTargets.length > 0
  }
}

function transformBuildReplacement({
  source,
  root,
  projectPath,
  resourcePath,
  occurrences = [],
  adapter = 'js',
  runtimeModule,
  runtimeExport = 't',
  styleExtensions = [],
  inputSourceMap = null
}) {
  if (typeof source !== 'string') {
    return { code: source, map: null, changed: false, planned: null }
  }
  const extension = path.posix.extname(projectPath).toLowerCase()
  const relevant = occurrences.filter(item => item.location && item.location.path === projectPath)
  if (relevant.length === 0) {
    return { code: source, map: null, changed: false, planned: null }
  }

  if (adapter === 'vue3' && extension === '.vue') {
    return transformVue3BuildReplacement({
      source,
      root,
      projectPath,
      resourcePath,
      occurrences: relevant,
      runtimeModule,
      runtimeExport,
      styleExtensions,
      inputSourceMap
    })
  }

  if (!SCRIPT_EXTENSIONS.has(extension)) {
    return { code: source, map: null, changed: false, planned: null }
  }

  return transformScriptBuildReplacement({
    source,
    root,
    projectPath,
    resourcePath,
    occurrences: relevant,
    adapter: adapter === 'vue3' ? 'vue3' : 'js',
    runtimeModule,
    runtimeExport,
    styleExtensions,
    inputSourceMap
  })
}

module.exports = {
  composeSourceMaps,
  transformBuildReplacement
}
