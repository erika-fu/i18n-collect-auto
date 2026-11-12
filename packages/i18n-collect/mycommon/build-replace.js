const path = require('path')
const parser = require('@babel/parser')
const { SourceMapConsumer, SourceMapGenerator } = require('source-map')
const { SCRIPT_EXTENSIONS } = require('./replace-preview')
const { ReplacementPlanner } = require('./replacement-planner')
const { parseTemplate } = require('../myloader/template-parser')

const PARSE = { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] }

function sortOccurrences(items) {
  return [...items].sort((left, right) => {
    if (left.path !== right.path) return left.path < right.path ? -1 : 1
    if (left.start.line !== right.start.line) return left.start.line - right.start.line
    if (left.start.column !== right.start.column) return left.start.column - right.start.column
    if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  })
}

function occurrenceFailureMessage(occurrences) {
  if (!occurrences.length) return 'build replacement failed'
  if (occurrences.length === 1) {
    const item = occurrences[0]
    return `${item.path}:${item.start.line}:${item.start.column} ${item.reason}`
  }
  return `build replacement failed with ${occurrences.length} unsafe occurrences`
}

function buildReplacementError(occurrences, message) {
  const sorted = sortOccurrences(occurrences)
  const error = new Error(message || occurrenceFailureMessage(sorted))
  error.name = 'BuildReplacementError'
  error.kind = 'build'
  error.stage = 'replacement'
  error.occurrences = sorted
  return error
}

function failureFromSkipped(planned) {
  if (!planned || !Array.isArray(planned.skipped) || planned.skipped.length === 0) return null
  return buildReplacementError(planned.skipped)
}

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

function parseSourceError(source) {
  try {
    parser.parse(source, PARSE)
    return null
  } catch (error) {
    return error
  }
}

function transformScriptBuildReplacement({
  source,
  projectPath,
  occurrences,
  adapter,
  runtimeExport,
  styleExtensions,
  inputSourceMap,
  helperAvailable = false
}) {
  const parseError = parseSourceError(source)
  if (parseError) {
    return { code: source, map: null, changed: false, planned: null, injected: false, error: parseError }
  }

  const helperName = runtimeExport || 't'
  const planner = new ReplacementPlanner({
    adapter,
    styleExtensions,
    runtime: {
      localizationFunction: true,
      helperName,
      helperAvailable
    }
  })
  const planned = planner.plan({
    occurrences,
    resources: new Map([[projectPath, source]])
  })
  planned.injected = false
  const skippedFailure = failureFromSkipped(planned)
  if (skippedFailure) {
    return { code: source, map: null, changed: false, planned, helperName, injected: false, error: skippedFailure }
  }
  const fileEdits = planned.edits
    .filter(edit => edit.path === projectPath)
    .map(({ start, end, text }) => ({ start, end, text }))
  if (fileEdits.length === 0) {
    return { code: source, map: null, changed: false, planned, helperName, injected: false }
  }

  const edited = applyEditsWithSegments(source, fileEdits)
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
    injected: false
  }
}

function transformVueBuildReplacement({
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
  const vueVersion = adapter === 'vue2' ? 2 : 3
  let template
  try {
    template = parseTemplate({
      source,
      resource: {
        absolutePath: resourcePath,
        projectPath
      },
      standalone: false,
      config: { vueVersion }
    })
  } catch (error) {
    return { code: source, map: null, changed: false, planned: null, error }
  }

  const helperName = runtimeExport || 't'
  const planner = new ReplacementPlanner({
    adapter,
    styleExtensions,
    runtime: {
      localizationFunction: true,
      helperName,
      helperAvailable: false,
      vueVersion
    }
  })
  const planned = planner.plan({
    occurrences,
    resources: new Map([[projectPath, { source, template }]])
  })
  planned.injected = false

  const skippedFailure = failureFromSkipped(planned)
  if (skippedFailure) {
    return { code: source, map: null, changed: false, planned, helperName, injected: false, error: skippedFailure }
  }

  const fileEdits = planned.edits
    .filter(edit => edit.path === projectPath)
    .map(({ start, end, text }) => ({ start, end, text }))

  if (fileEdits.length === 0) {
    return { code: source, map: null, changed: false, planned, helperName, injected: false }
  }

  const edited = applyEditsWithSegments(source, fileEdits)
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
    injected: false
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
  inputSourceMap = null,
  helperAvailable = false
}) {
  if (typeof source !== 'string') {
    return { code: source, map: null, changed: false, planned: null }
  }
  const extension = path.posix.extname(projectPath).toLowerCase()
  const relevant = occurrences.filter(item => item.location && item.location.path === projectPath)
  if (relevant.length === 0) {
    return { code: source, map: null, changed: false, planned: null }
  }

  if ((adapter === 'vue2' || adapter === 'vue3') && extension === '.vue') {
    return transformVueBuildReplacement({
      source,
      root,
      projectPath,
      resourcePath,
      occurrences: relevant,
      adapter,
      runtimeModule,
      runtimeExport,
      styleExtensions,
      inputSourceMap
    })
  }

  if (!SCRIPT_EXTENSIONS.has(extension)) {
    return { code: source, map: null, changed: false, planned: null, injected: false }
  }

  return transformScriptBuildReplacement({
    source,
    projectPath,
    occurrences: relevant,
    adapter: adapter === 'vue2' || adapter === 'vue3' ? adapter : 'js',
    runtimeExport,
    styleExtensions,
    inputSourceMap,
    helperAvailable
  })
}

module.exports = {
  buildReplacementError,
  composeSourceMaps,
  sortOccurrences,
  transformBuildReplacement
}
