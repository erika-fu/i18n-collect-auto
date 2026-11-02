const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const parse5 = require('parse5')
const { DEFAULTS, normalizeFilterPattern } = require('./config')
const { isStaticLocalizationKeyArgument } = require('./localized-call')
const { scopeMatches } = require('./scope-pattern')
const { containsHan, offsetToPosition } = require('../myloader/resource')

const BOUNDARIES_VERSION = 1
const REASON_RUNTIME_MULTILINGUAL_LITERAL = 'runtime-multilingual-literal'

const SCRIPT_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'
])

const MODULE_SPECIFIER_PARENTS = new Set([
  'ImportDeclaration',
  'ExportAllDeclaration',
  'ExportNamedDeclaration'
])

function extensionOf(projectPath) {
  const base = projectPath.split('/').pop() || ''
  const index = base.lastIndexOf('.')
  return index === -1 ? '' : base.slice(index).toLowerCase()
}

function normalizePatternList(root, values, field) {
  if (!Array.isArray(values)) {
    throw new Error(`${field} must be an array of valid values`)
  }
  const normalized = values.map((value, index) => normalizeFilterPattern(root, value, `${field}[${index}]`))
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} must not contain duplicates`)
  }
  return normalized
}

function attributeAllowlistOf(options) {
  const list = options && Array.isArray(options.attributeAllowlist)
    ? options.attributeAllowlist
    : DEFAULTS.attributeAllowlist
  return new Set(list)
}

function normalizeBoundary(raw, index, root) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`runtime-multilingual boundaries[${index}] must be an object`)
  }
  if (typeof raw.id !== 'string' || !raw.id) {
    throw new Error(`runtime-multilingual boundaries[${index}] must have a non-empty id`)
  }
  if (!Array.isArray(raw.include) || raw.include.length === 0) {
    throw new Error(`runtime-multilingual boundaries[${index}].include must be a non-empty array`)
  }
  const include = normalizePatternList(root, raw.include, `runtime-multilingual boundaries[${index}].include`)
  const exclude = raw.exclude === undefined
    ? []
    : normalizePatternList(root, raw.exclude, `runtime-multilingual boundaries[${index}].exclude`)
  return { id: raw.id, include, exclude }
}

function readRuntimeMultilingualBoundaries(filePath, root) {
  if (!fs.existsSync(filePath)) return []
  let document
  try {
    document = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`runtime-multilingual boundaries is not valid JSON: ${error.message}`)
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('runtime-multilingual boundaries must be an object')
  }
  if (document.version !== BOUNDARIES_VERSION) {
    throw new Error(
      `runtime-multilingual boundaries version ${document.version} is unsupported; supported version is ${BOUNDARIES_VERSION}`
    )
  }
  if (!Array.isArray(document.boundaries)) {
    throw new Error('runtime-multilingual boundaries must include a boundaries array')
  }
  const projectRoot = path.resolve(root || path.dirname(filePath))
  const boundaries = document.boundaries.map((item, index) => normalizeBoundary(item, index, projectRoot))
  const ids = new Set()
  for (const boundary of boundaries) {
    if (ids.has(boundary.id)) {
      throw new Error(`duplicate boundary id "${boundary.id}"`)
    }
    ids.add(boundary.id)
  }
  return boundaries
}

function patternsMatch(projectPath, patterns) {
  return patterns.some(pattern => scopeMatches(projectPath, pattern))
}

function matchingRuntimeMultilingualBoundary(projectPath, boundaries) {
  const candidate = String(projectPath || '').split('\\').join('/')
  if (!Array.isArray(boundaries)) {
    throw new TypeError('matchingRuntimeMultilingualBoundary requires a boundaries array')
  }
  for (const boundary of boundaries) {
    if (!patternsMatch(candidate, boundary.include || [])) continue
    if (patternsMatch(candidate, boundary.exclude || [])) continue
    return boundary
  }
  return null
}

function isInsideRuntimeMultilingualBoundary(projectPath, boundaries) {
  return matchingRuntimeMultilingualBoundary(projectPath, boundaries) != null
}

function locationOf(fullSource, projectPath, absoluteStart, absoluteEnd, kind) {
  return {
    path: projectPath,
    kind,
    start: offsetToPosition(fullSource, absoluteStart),
    end: offsetToPosition(fullSource, absoluteEnd)
  }
}

function pushViolation(violations, seen, item) {
  const key = [
    item.path,
    item.reason,
    item.kind,
    item.text,
    item.start.line,
    item.start.column,
    item.end.line,
    item.end.column,
    item.boundaryId
  ].join('\0')
  if (seen.has(key)) return
  seen.add(key)
  violations.push(item)
}

function recordLiteral(violations, seen, fullSource, projectPath, absoluteStart, absoluteEnd, text, kind, boundaryId) {
  if (!containsHan(text)) return
  const loc = locationOf(fullSource, projectPath, absoluteStart, absoluteEnd, kind)
  pushViolation(violations, seen, {
    reason: REASON_RUNTIME_MULTILINGUAL_LITERAL,
    path: loc.path,
    kind: loc.kind,
    start: loc.start,
    end: loc.end,
    text,
    boundaryId
  })
}

function parseModule(source) {
  return parser.parse(source, {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true
  })
}

function scanScriptSource(fullSource, projectPath, baseOffset, slice, violations, seen, boundaryId, allowlist) {
  const ast = parseModule(slice)
  traverse(ast, {
    StringLiteral(nodePath) {
      if (MODULE_SPECIFIER_PARENTS.has(nodePath.parent.type)) return
      if (isStaticLocalizationKeyArgument(nodePath)) return
      const node = nodePath.node
      if (node.start == null || node.end == null) return
      recordLiteral(
        violations,
        seen,
        fullSource,
        projectPath,
        baseOffset + node.start,
        baseOffset + node.end,
        node.value,
        'script-string',
        boundaryId
      )
    },
    TemplateElement(nodePath) {
      const node = nodePath.node
      if (node.start == null || node.end == null) return
      const text = node.value.cooked || ''
      recordLiteral(
        violations,
        seen,
        fullSource,
        projectPath,
        baseOffset + node.start,
        baseOffset + node.end,
        text,
        'template-literal',
        boundaryId
      )
    },
    JSXText(nodePath) {
      const node = nodePath.node
      if (node.start == null || node.end == null) return
      const text = node.value
      if (!containsHan(text)) return
      recordLiteral(
        violations,
        seen,
        fullSource,
        projectPath,
        baseOffset + node.start,
        baseOffset + node.end,
        text,
        'html-text',
        boundaryId
      )
    },
    JSXAttribute(nodePath) {
      const nameNode = nodePath.node.name
      const name = nameNode && nameNode.type === 'JSXIdentifier' ? nameNode.name : null
      if (!name || !allowlist.has(name)) return
      const value = nodePath.node.value
      if (!value || value.type !== 'StringLiteral') return
      if (value.start == null || value.end == null) return
      recordLiteral(
        violations,
        seen,
        fullSource,
        projectPath,
        baseOffset + value.start,
        baseOffset + value.end,
        value.value,
        'html-attribute',
        boundaryId
      )
    }
  })
}

function scanTag(source, index) {
  if (source[index] !== '<') return null
  const closing = source[index + 1] === '/'
  let cursor = index + (closing ? 2 : 1)
  if (!/[A-Za-z]/.test(source[cursor] || '')) return null
  const nameStart = cursor
  while (cursor < source.length && /[A-Za-z0-9:-]/.test(source[cursor])) cursor += 1
  const name = source.slice(nameStart, cursor)
  let selfClosing = false
  let quote = null
  while (cursor < source.length) {
    const char = source[cursor]
    if (quote) {
      if (char === quote) quote = null
      cursor += 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      cursor += 1
      continue
    }
    if (char === '/' && source[cursor + 1] === '>') selfClosing = true
    if (char === '>') {
      return {
        name,
        closing,
        selfClosing: selfClosing && !closing,
        attrs: source.slice(nameStart + name.length, selfClosing ? cursor - 1 : cursor),
        tagStart: index,
        tagEnd: cursor + 1
      }
    }
    cursor += 1
  }
  return null
}

function attributeValue(rawAttrs, name) {
  const pattern = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\\`]+))`,
    'i'
  )
  const match = pattern.exec(rawAttrs)
  if (!match) return null
  return match[1] ?? match[2] ?? match[3] ?? ''
}

function skipToClose(source, from, name) {
  const close = new RegExp(`</${name}\\s*>`, 'i')
  const found = close.exec(source.slice(from))
  if (!found) return source.length
  return from + found.index + found[0].length
}

function findBlock(source, blockName) {
  const blocks = []
  let cursor = 0
  while (cursor < source.length) {
    if (source.startsWith('<!--', cursor)) {
      const end = source.indexOf('-->', cursor + 4)
      cursor = end === -1 ? source.length : end + 3
      continue
    }
    if (source[cursor] !== '<') {
      cursor += 1
      continue
    }
    const tag = scanTag(source, cursor)
    if (!tag || tag.closing) {
      cursor = tag ? tag.tagEnd : cursor + 1
      continue
    }
    const name = tag.name.toLowerCase()
    if (name !== blockName) {
      if ((name === 'script' || name === 'style' || name === 'template') && !tag.selfClosing) {
        cursor = skipToClose(source, tag.tagEnd, name)
      } else {
        cursor = tag.tagEnd
      }
      continue
    }
    if (tag.selfClosing) {
      cursor = tag.tagEnd
      continue
    }
    const close = new RegExp(`</${name}\\s*>`, 'i')
    const found = close.exec(source.slice(tag.tagEnd))
    if (!found) break
    const contentStart = tag.tagEnd
    const contentEnd = tag.tagEnd + found.index
    blocks.push({
      start: contentStart,
      end: contentEnd,
      attrs: tag.attrs,
      lang: (attributeValue(tag.attrs, 'lang') || '').toLowerCase()
    })
    cursor = contentEnd + found[0].length
  }
  return blocks
}

function scanExpressionEnd(raw, from) {
  let depth = 0
  let quote = null
  for (let index = from; index < raw.length; index++) {
    const char = raw[index]
    if (quote) {
      if (char === '\\') {
        index += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      if (depth === 0 && raw[index + 1] === '}') return index
      if (depth > 0) depth -= 1
    }
  }
  return -1
}

function interpolationSpans(raw) {
  const spans = []
  let cursor = 0
  while (cursor < raw.length) {
    const open = raw.indexOf('{{', cursor)
    if (open === -1) break
    const end = scanExpressionEnd(raw, open + 2)
    if (end < 0) break
    spans.push({ start: open + 2, end })
    cursor = end + 2
  }
  return spans
}

function scanExpressionSource(fullSource, projectPath, baseOffset, slice, violations, seen, boundaryId) {
  const trimmed = slice.trim()
  if (!trimmed) return
  const lead = slice.indexOf(trimmed)
  const wrapped = `(${trimmed})`
  let ast
  try {
    ast = parser.parse(wrapped, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true
    })
  } catch (error) {
    return
  }
  traverse(ast, {
    StringLiteral(nodePath) {
      if (isStaticLocalizationKeyArgument(nodePath)) return
      const node = nodePath.node
      if (node.start == null || node.end == null) return
      recordLiteral(
        violations,
        seen,
        fullSource,
        projectPath,
        baseOffset + lead - 1 + node.start,
        baseOffset + lead - 1 + node.end,
        node.value,
        'template-expression',
        boundaryId
      )
    },
    TemplateElement(nodePath) {
      const node = nodePath.node
      if (node.start == null || node.end == null) return
      recordLiteral(
        violations,
        seen,
        fullSource,
        projectPath,
        baseOffset + lead - 1 + node.start,
        baseOffset + lead - 1 + node.end,
        node.value.cooked || '',
        'template-literal',
        boundaryId
      )
    }
  })
}

function attributeNameBase(name) {
  const raw = String(name || '')
  if (raw.startsWith(':') || raw.startsWith('v-bind:')) {
    return raw.replace(/^:|^v-bind:/, '')
  }
  return raw
}

function scanMarkup(fullSource, projectPath, templateStart, templateEnd, violations, seen, boundaryId, htmlKind, allowlist) {
  const fragment = fullSource.slice(templateStart, templateEnd)
  for (const span of interpolationSpans(fragment)) {
    scanExpressionSource(
      fullSource,
      projectPath,
      templateStart + span.start,
      fragment.slice(span.start, span.end),
      violations,
      seen,
      boundaryId
    )
  }

  const root = parse5.parseFragment(fragment, { sourceCodeLocationInfo: true })
  const visit = node => {
    if (!node) return
    if (node.nodeName === '#text') {
      const location = node.sourceCodeLocation
      if (!location) return
      const text = node.value || ''
      const trimmed = text.trim()
      if (!containsHan(trimmed)) return
      const lead = text.indexOf(trimmed)
      recordLiteral(
        violations,
        seen,
        fullSource,
        projectPath,
        templateStart + location.startOffset + lead,
        templateStart + location.startOffset + lead + trimmed.length,
        trimmed,
        htmlKind || 'html-text',
        boundaryId
      )
      return
    }
    if (node.attrs) {
      for (const attr of node.attrs) {
        const base = attributeNameBase(attr.name)
        if (!allowlist.has(base)) continue
        const location = node.sourceCodeLocation && node.sourceCodeLocation.attrs
          ? node.sourceCodeLocation.attrs[attr.name]
          : null
        if (!location) continue
        const dynamic = String(attr.name || '').startsWith(':') || String(attr.name || '').startsWith('v-bind:')
        if (dynamic) {
          const raw = attr.value || ''
          scanExpressionSource(
            fullSource,
            projectPath,
            templateStart + location.startOffset,
            raw,
            violations,
            seen,
            boundaryId
          )
          continue
        }
        if (!containsHan(attr.value || '')) continue
        // Attribute value range excludes quotes when parse5 reports them.
        const valueStart = location.startOffset + (attr.name.length + 1)
        let start = templateStart + valueStart
        let end = templateStart + location.endOffset
        const slice = fullSource.slice(start, end)
        if ((slice.startsWith('"') || slice.startsWith("'")) && slice.length >= 2) {
          start += 1
          end -= 1
        }
        recordLiteral(
          violations,
          seen,
          fullSource,
          projectPath,
          start,
          end,
          attr.value,
          htmlKind === 'static-html-text' ? 'static-html-attribute' : 'html-attribute',
          boundaryId
        )
      }
    }
    for (const child of node.childNodes || []) visit(child)
  }
  for (const child of root.childNodes || []) visit(child)
}

function scanVueSource(fullSource, projectPath, violations, seen, boundaryId, allowlist) {
  for (const block of findBlock(fullSource, 'script')) {
    scanScriptSource(
      fullSource,
      projectPath,
      block.start,
      fullSource.slice(block.start, block.end),
      violations,
      seen,
      boundaryId,
      allowlist
    )
  }
  for (const block of findBlock(fullSource, 'template')) {
    scanMarkup(fullSource, projectPath, block.start, block.end, violations, seen, boundaryId, 'html-text', allowlist)
  }
  for (const block of findBlock(fullSource, 'style')) {
    scanCssContent(fullSource, projectPath, block.start, block.end, violations, seen, boundaryId)
  }
}

function scanCssContent(fullSource, projectPath, cssStart, cssEnd, violations, seen, boundaryId) {
  const css = fullSource.slice(cssStart, cssEnd)
  const contentPattern = /content\s*:\s*([^;{}]+)/gi
  let match
  while ((match = contentPattern.exec(css))) {
    const value = match[1]
    const valueOrigin = cssStart + match.index + match[0].indexOf(value)
    const stringPattern = /(["'])((?:\\.|(?!\1).)*)\1/g
    let stringMatch
    while ((stringMatch = stringPattern.exec(value))) {
      const raw = stringMatch[2]
      // Unescape basic sequences for Han detection of the literal text.
      const text = raw.replace(/\\(['"\\])/g, '$1')
      if (!containsHan(text)) continue
      const absoluteStart = valueOrigin + stringMatch.index
      const absoluteEnd = absoluteStart + stringMatch[0].length
      recordLiteral(
        violations,
        seen,
        fullSource,
        projectPath,
        absoluteStart,
        absoluteEnd,
        text,
        'css-generated-content',
        boundaryId
      )
    }
  }
}

function scanRuntimeMultilingualPolicy(files, boundaries, options = {}) {
  if (!Array.isArray(files)) throw new TypeError('scanRuntimeMultilingualPolicy requires a files array')
  if (!Array.isArray(boundaries)) throw new TypeError('scanRuntimeMultilingualPolicy requires a boundaries array')
  const allowlist = attributeAllowlistOf(options)
  const violations = []
  const seen = new Set()
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || typeof file.source !== 'string') {
      throw new TypeError('each file needs path and source strings')
    }
    const projectPath = file.path.split('\\').join('/')
    const boundary = matchingRuntimeMultilingualBoundary(projectPath, boundaries)
    if (!boundary) continue
    const ext = extensionOf(projectPath)
    if (ext === '.vue') scanVueSource(file.source, projectPath, violations, seen, boundary.id, allowlist)
    else if (SCRIPT_EXTENSIONS.has(ext) || ext === '') {
      scanScriptSource(file.source, projectPath, 0, file.source, violations, seen, boundary.id, allowlist)
    } else if (ext === '.html' || ext === '.htm') {
      scanMarkup(
        file.source,
        projectPath,
        0,
        file.source.length,
        violations,
        seen,
        boundary.id,
        'static-html-text',
        allowlist
      )
    } else if (ext === '.css') {
      scanCssContent(file.source, projectPath, 0, file.source.length, violations, seen, boundary.id)
    }
  }
  violations.sort((left, right) => {
    const byPath = left.path.localeCompare(right.path)
    if (byPath) return byPath
    if (left.start.line !== right.start.line) return left.start.line - right.start.line
    if (left.start.column !== right.start.column) return left.start.column - right.start.column
    return left.reason.localeCompare(right.reason)
  })
  return violations
}

module.exports = {
  BOUNDARIES_VERSION,
  REASON_RUNTIME_MULTILINGUAL_LITERAL,
  isInsideRuntimeMultilingualBoundary,
  matchingRuntimeMultilingualBoundary,
  readRuntimeMultilingualBoundaries,
  scanRuntimeMultilingualPolicy
}
