const fs = require('fs')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const parse5 = require('parse5')
const { containsHan, offsetToPosition } = require('../myloader/resource')
const {
  STRUCTURED_MESSAGE_HOSTS,
  bindingAttribute,
  emptyTemplate,
  isStructuredTag,
  parseVueTemplate,
  sourceOffset,
  structuredTextRegions,
  transparentWrapper
} = require('./template-policy-regions')

const BASELINE_VERSION = 1

const REASON_CONCATENATION = 'concatenation'
const REASON_INTERPOLATION = 'interpolation'
const REASON_CONDITIONAL = 'conditional'
const REASON_FORMATTING = 'formatting'
const REASON_STRUCTURED_FRAGMENTATION = 'structured-fragmentation'

const FORMAT_METHODS = new Set([
  'concat',
  'replace',
  'replaceAll',
  'padStart',
  'padEnd',
  'repeat'
])

const FORMAT_CALLEES = new Set(['format', 'sprintf', 'printf'])

const SCRIPT_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'
])

function extensionOf(projectPath) {
  const base = projectPath.split('/').pop() || ''
  const index = base.lastIndexOf('.')
  return index === -1 ? '' : base.slice(index).toLowerCase()
}

function locationOf(fullSource, path, absoluteStart, absoluteEnd, kind) {
  return {
    path,
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
    item.end.column
  ].join('\0')
  if (seen.has(key)) return
  seen.add(key)
  violations.push(item)
}

function recordNode(violations, seen, fullSource, projectPath, node, baseOffset, reason, kind, mapOffset) {
  if (!node || node.start == null || node.end == null) return
  let text = ''
  if (node.type === 'StringLiteral') text = node.value
  else if (node.type === 'TemplateElement') text = node.value.cooked || ''
  else return
  if (!containsHan(text)) return
  const start = mapOffset ? mapOffset(node.start) : baseOffset + node.start
  const end = mapOffset ? mapOffset(node.end) : baseOffset + node.end
  const loc = locationOf(fullSource, projectPath, start, end, kind)
  pushViolation(violations, seen, {
    reason,
    path: loc.path,
    kind: loc.kind,
    start: loc.start,
    end: loc.end,
    text
  })
}

function isConcatBinary(node) {
  return node && node.type === 'BinaryExpression' && node.operator === '+'
}

function walkConcatOperands(node, visit) {
  if (!node) return
  if (isConcatBinary(node)) {
    walkConcatOperands(node.left, visit)
    walkConcatOperands(node.right, visit)
    return
  }
  visit(node)
}

function markHanLeaves(violations, seen, fullSource, projectPath, node, baseOffset, reason, kind, mapOffset) {
  if (!node) return
  if (node.type === 'StringLiteral') {
    recordNode(violations, seen, fullSource, projectPath, node, baseOffset, reason, kind, mapOffset)
    return
  }
  if (node.type === 'TemplateLiteral') {
    for (const quasi of node.quasis) {
      recordNode(
        violations,
        seen,
        fullSource,
        projectPath,
        quasi,
        baseOffset,
        reason,
        'template-literal',
        mapOffset
      )
    }
  }
}

function parseModule(source) {
  return parser.parse(source, {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true
  })
}

function flattenHtmlChildren(childNodes) {
  const flat = []
  for (const child of childNodes || []) {
    if (child.tagName && transparentWrapper(child.tagName)) {
      flat.push(...flattenHtmlChildren(child.childNodes))
      continue
    }
    flat.push(child)
  }
  return flat
}

function flattenJsxChildren(children) {
  const flat = []
  for (const child of children || []) {
    if (child.type === 'JSXElement' && transparentWrapper(jsxElementName(child))) {
      flat.push(...flattenJsxChildren(child.children))
      continue
    }
    if (child.type === 'JSXFragment') {
      flat.push(...flattenJsxChildren(child.children))
      continue
    }
    flat.push(child)
  }
  return flat
}

function recordStructuredText(violations, seen, fullSource, projectPath, absoluteStart, absoluteEnd, text, kind) {
  if (!containsHan(text)) return
  const loc = locationOf(fullSource, projectPath, absoluteStart, absoluteEnd, kind)
  pushViolation(violations, seen, {
    reason: REASON_STRUCTURED_FRAGMENTATION,
    path: loc.path,
    kind: loc.kind,
    start: loc.start,
    end: loc.end,
    text
  })
}

function collectHtmlHanTexts(node, visit) {
  if (!node) return
  if (node.nodeName === '#text') {
    if (containsHan(node.value || '')) visit(node)
    return
  }
  if (!node.childNodes) return
  for (const child of node.childNodes) collectHtmlHanTexts(child, visit)
}

function scanHtmlStructuredElement(element, fullSource, projectPath, baseOffset, kind, violations, seen) {
  if (!element || !element.childNodes) return
  const host = String(element.tagName || '').toLowerCase()
  if (STRUCTURED_MESSAGE_HOSTS.has(host)) {
    const textKids = []
    const structuredKids = []
    for (const child of flattenHtmlChildren(element.childNodes)) {
      if (child.nodeName === '#text') {
        if (containsHan(child.value || '')) textKids.push(child)
        continue
      }
      if (child.nodeName === '#comment' || child.nodeName === '#document-fragment') continue
      if (child.tagName && isStructuredTag(child.tagName)) structuredKids.push(child)
    }
    if (textKids.length > 0 && structuredKids.length > 0) {
      for (const textNode of textKids) {
        const location = textNode.sourceCodeLocation
        if (!location) continue
        recordStructuredText(
          violations,
          seen,
          fullSource,
          projectPath,
          baseOffset + location.startOffset,
          baseOffset + location.endOffset,
          textNode.value,
          kind
        )
      }
      for (const structured of structuredKids) {
        collectHtmlHanTexts(structured, textNode => {
          const location = textNode.sourceCodeLocation
          if (!location) return
          recordStructuredText(
            violations,
            seen,
            fullSource,
            projectPath,
            baseOffset + location.startOffset,
            baseOffset + location.endOffset,
            textNode.value,
            kind
          )
        })
      }
    }
  }
  for (const child of element.childNodes) {
    if (child.tagName) {
      scanHtmlStructuredElement(child, fullSource, projectPath, baseOffset, kind, violations, seen)
    }
  }
}

function scanHtmlStructuredMarkup(fullSource, projectPath, templateStart, templateEnd, kind, violations, seen) {
  const fragment = fullSource.slice(templateStart, templateEnd)
  const root = parse5.parseFragment(fragment, { sourceCodeLocationInfo: true })
  for (const child of root.childNodes || []) {
    if (child.tagName) {
      scanHtmlStructuredElement(child, fullSource, projectPath, templateStart, kind, violations, seen)
    }
  }
}

function jsxElementName(node) {
  if (!node || node.type !== 'JSXElement') return null
  const name = node.openingElement && node.openingElement.name
  if (!name) return null
  if (name.type === 'JSXIdentifier') return name.name
  if (name.type === 'JSXMemberExpression') {
    const parts = []
    let current = name
    while (current) {
      if (current.type === 'JSXIdentifier') {
        parts.unshift(current.name)
        break
      }
      if (current.type === 'JSXMemberExpression') {
        parts.unshift(current.property.name)
        current = current.object
        continue
      }
      return null
    }
    return parts.join('.')
  }
  return null
}

function collectJsxHanTexts(node, visit) {
  if (!node) return
  if (node.type === 'JSXText') {
    if (containsHan(node.value || '')) visit(node)
    return
  }
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
    for (const child of node.children || []) collectJsxHanTexts(child, visit)
  }
}

function scanJsxStructuredElement(node, fullSource, projectPath, baseOffset, violations, seen) {
  if (!node || node.type !== 'JSXElement') return
  const host = String(jsxElementName(node) || '').toLowerCase()
  if (STRUCTURED_MESSAGE_HOSTS.has(host)) {
    const textKids = []
    const structuredKids = []
    for (const child of flattenJsxChildren(node.children)) {
      if (child.type === 'JSXText') {
        if (containsHan(child.value || '')) textKids.push(child)
        continue
      }
      if (child.type !== 'JSXElement') continue
      const name = jsxElementName(child)
      if (isStructuredTag(name)) structuredKids.push(child)
    }
    if (textKids.length > 0 && structuredKids.length > 0) {
      for (const textNode of textKids) {
        recordStructuredText(
          violations,
          seen,
          fullSource,
          projectPath,
          baseOffset + textNode.start,
          baseOffset + textNode.end,
          textNode.value,
          'script-string'
        )
      }
      for (const structured of structuredKids) {
        collectJsxHanTexts(structured, textNode => {
          recordStructuredText(
            violations,
            seen,
            fullSource,
            projectPath,
            baseOffset + textNode.start,
            baseOffset + textNode.end,
            textNode.value,
            'script-string'
          )
        })
      }
    }
  }
}

function scanAst(ast, fullSource, projectPath, baseOffset, violations, seen, expressionKind, mapOffset) {
  const scriptKind = expressionKind || 'script-string'
  traverse(ast, {
    JSXElement(nodePath) {
      scanJsxStructuredElement(nodePath.node, fullSource, projectPath, baseOffset, violations, seen)
    },
    BinaryExpression(nodePath) {
      if (nodePath.node.operator !== '+') return
      if (nodePath.parent && isConcatBinary(nodePath.parent)) return
      walkConcatOperands(nodePath.node, operand => {
        markHanLeaves(
          violations,
          seen,
          fullSource,
          projectPath,
          operand,
          baseOffset,
          REASON_CONCATENATION,
          scriptKind,
          mapOffset
        )
      })
    },
    TemplateLiteral(nodePath) {
      if (nodePath.node.expressions.length === 0) return
      for (const quasi of nodePath.node.quasis) {
        recordNode(
          violations,
          seen,
          fullSource,
          projectPath,
          quasi,
          baseOffset,
          REASON_INTERPOLATION,
          'template-literal',
          mapOffset
        )
      }
    },
    ConditionalExpression(nodePath) {
      const { consequent, alternate } = nodePath.node
      for (const branch of [consequent, alternate]) {
        if (isConcatBinary(branch)) {
          walkConcatOperands(branch, operand => {
            markHanLeaves(
              violations,
              seen,
              fullSource,
              projectPath,
              operand,
              baseOffset,
              REASON_CONDITIONAL,
              scriptKind,
              mapOffset
            )
          })
          continue
        }
        markHanLeaves(
          violations,
          seen,
          fullSource,
          projectPath,
          branch,
          baseOffset,
          REASON_CONDITIONAL,
          branch && branch.type === 'TemplateLiteral' ? 'template-literal' : scriptKind,
          mapOffset
        )
      }
    },

    CallExpression(nodePath) {
      const callee = nodePath.node.callee
      let formatting = false
      if (callee.type === 'Identifier' && FORMAT_CALLEES.has(callee.name)) formatting = true
      if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
        if (FORMAT_METHODS.has(callee.property.name)) formatting = true
      }
      if (!formatting) return
      if (callee.type === 'MemberExpression') {
        markHanLeaves(
          violations,
          seen,
          fullSource,
          projectPath,
          callee.object,
          baseOffset,
          REASON_FORMATTING,
          scriptKind,
          mapOffset
        )
      }
      for (const arg of nodePath.node.arguments) {
        markHanLeaves(
          violations,
          seen,
          fullSource,
          projectPath,
          arg,
          baseOffset,
          REASON_FORMATTING,
          scriptKind,
          mapOffset
        )
      }
    }
  })
}

function scanScriptSource(fullSource, projectPath, baseOffset, slice, violations, seen) {
  const ast = parseModule(slice)
  scanAst(ast, fullSource, projectPath, baseOffset, violations, seen, 'script-string')
}

function scanExpressionSource(fullSource, projectPath, baseOffset, slice, violations, seen) {
  const trimmed = slice.trim()
  if (!trimmed) return
  const lead = slice.indexOf(trimmed)
  const wrapped = `(${trimmed})`
  const ast = parser.parse(wrapped, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true
  })
  // Leading '(' shifts every node start by 1 relative to the trimmed expression.
  scanAst(ast, fullSource, projectPath, baseOffset + lead - 1, violations, seen, 'template-expression')
}

function scanExpressionRegion(fullSource, projectPath, region, violations, seen) {
  const trimmed = region.value.trim()
  if (!trimmed) return
  const lead = region.value.indexOf(trimmed)
  const ast = parser.parse(`(${trimmed})`, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true
  })
  const mapOffset = offset => sourceOffset(region, lead - 1 + offset)
  scanAst(ast, fullSource, projectPath, 0, violations, seen, 'template-expression', mapOffset)
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

function scanTemplateMarkup(fullSource, projectPath, templateStart, templateEnd, violations, seen, htmlKind) {
  const fragment = fullSource.slice(templateStart, templateEnd)
  const spans = interpolationSpans(fragment)
  for (const span of spans) {
    const expression = fragment.slice(span.start, span.end)
    scanExpressionSource(
      fullSource,
      projectPath,
      templateStart + span.start,
      expression,
      violations,
      seen
    )
  }

  const binding = /(?:^|\s)(?::|v-bind:)([A-Za-z_:][\w:.-]*)\s*=\s*(["'])/g
  let match
  while ((match = binding.exec(fragment))) {
    const quote = match[2]
    const valueStart = match.index + match[0].length
    let cursor = valueStart
    while (cursor < fragment.length) {
      const char = fragment[cursor]
      if (char === '\\') {
        cursor += 2
        continue
      }
      if (char === quote) break
      cursor += 1
    }
    const expression = fragment.slice(valueStart, cursor)
    scanExpressionSource(
      fullSource,
      projectPath,
      templateStart + valueStart,
      expression,
      violations,
      seen
    )
  }

  scanHtmlStructuredMarkup(
    fullSource,
    projectPath,
    templateStart,
    templateEnd,
    htmlKind || 'html-text',
    violations,
    seen
  )
}

function scanVueSource(file, projectPath, violations, seen, options) {
  const fullSource = file.source
  for (const block of findBlock(fullSource, 'script')) {
    scanScriptSource(fullSource, projectPath, block.start, fullSource.slice(block.start, block.end), violations, seen)
  }
  const template = findBlock(fullSource, 'template').length > 0
    ? parseVueTemplate(fullSource, file, options)
    : emptyTemplate()
  for (const region of template.regions) {
    if (region.type === 'expression') {
      scanExpressionRegion(fullSource, projectPath, region, violations, seen)
    } else if (region.type === 'attribute' && bindingAttribute(region.name)) {
      scanExpressionRegion(fullSource, projectPath, region, violations, seen)
    }
  }
  for (const region of structuredTextRegions(template)) {
    recordStructuredText(
      violations,
      seen,
      fullSource,
      projectPath,
      region.start,
      region.end,
      region.value,
      'html-text'
    )
  }
}

function scanCompleteStaticCopyPolicy(files, options = {}) {
  if (!Array.isArray(files)) throw new TypeError('scanCompleteStaticCopyPolicy requires a files array')
  const violations = []
  const seen = new Set()
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || typeof file.source !== 'string') {
      throw new TypeError('each file needs path and source strings')
    }
    const projectPath = file.path.split('\\').join('/')
    const ext = extensionOf(projectPath)
    if (ext === '.vue') scanVueSource(file, projectPath, violations, seen, options)
    else if (SCRIPT_EXTENSIONS.has(ext) || ext === '') {
      scanScriptSource(file.source, projectPath, 0, file.source, violations, seen)
    } else if (ext === '.html' || ext === '.htm') {
      scanTemplateMarkup(
        file.source,
        projectPath,
        0,
        file.source.length,
        violations,
        seen,
        'static-html-text'
      )
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

function positionKey(position) {
  return `${position.line}:${position.column}`
}

function exactViolationKey(item) {
  return [
    item.path,
    item.reason,
    item.kind,
    item.text,
    positionKey(item.start),
    positionKey(item.end)
  ].join('\0')
}

function softViolationKeys(item) {
  return [
    `${item.path}\0${item.reason}\0${item.kind}\0${positionKey(item.start)}`,
    `${item.path}\0${item.reason}\0${item.kind}\0${item.text}`
  ]
}

function normalizeViolation(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`complete-static-copy baseline violations[${index}] must be an object`)
  }
  for (const field of ['reason', 'path', 'kind', 'text']) {
    if (typeof raw[field] !== 'string' || !raw[field]) {
      throw new Error(`complete-static-copy baseline violations[${index}].${field} must be a non-empty string`)
    }
  }
  for (const field of ['start', 'end']) {
    const position = raw[field]
    if (!position || typeof position !== 'object' || Array.isArray(position)) {
      throw new Error(`complete-static-copy baseline violations[${index}].${field} must be a position`)
    }
    if (!Number.isInteger(position.line) || position.line < 1) {
      throw new Error(`complete-static-copy baseline violations[${index}].${field}.line must be a positive integer`)
    }
    if (!Number.isInteger(position.column) || position.column < 0) {
      throw new Error(`complete-static-copy baseline violations[${index}].${field}.column must be a non-negative integer`)
    }
  }
  return {
    reason: raw.reason,
    path: String(raw.path).split('\\').join('/'),
    kind: raw.kind,
    start: { line: raw.start.line, column: raw.start.column },
    end: { line: raw.end.line, column: raw.end.column },
    text: raw.text
  }
}

function readPolicyBaseline(filePath) {
  if (!fs.existsSync(filePath)) return []
  let document
  try {
    document = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`complete-static-copy baseline is not valid JSON: ${error.message}`)
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('complete-static-copy baseline must be an object')
  }
  if (document.version !== BASELINE_VERSION) {
    throw new Error(`complete-static-copy baseline version ${document.version} is unsupported; supported version is ${BASELINE_VERSION}`)
  }
  if (!Array.isArray(document.violations)) {
    throw new Error('complete-static-copy baseline must include a violations array')
  }
  return document.violations.map((item, index) => normalizeViolation(item, index))
}

function comparePolicyBaseline(current, baseline) {
  if (!Array.isArray(current) || !Array.isArray(baseline)) {
    throw new TypeError('comparePolicyBaseline requires current and baseline arrays')
  }
  const exact = new Map(baseline.map(item => [exactViolationKey(item), item]))
  const soft = new Map()
  for (const item of baseline) {
    for (const key of softViolationKeys(item)) {
      if (!soft.has(key)) soft.set(key, item)
    }
  }
  const grandfathered = []
  const newViolations = []
  const modifiedViolations = []
  for (const item of current) {
    const exactKey = exactViolationKey(item)
    if (exact.has(exactKey)) {
      grandfathered.push(item)
      continue
    }
    const related = softViolationKeys(item).map(key => soft.get(key)).find(Boolean)
    if (related) modifiedViolations.push({ current: item, baseline: related })
    else newViolations.push(item)
  }
  return { grandfathered, newViolations, modifiedViolations }
}

module.exports = {
  BASELINE_VERSION,
  REASON_CONCATENATION,
  REASON_CONDITIONAL,
  REASON_FORMATTING,
  REASON_INTERPOLATION,
  REASON_STRUCTURED_FRAGMENTATION,
  comparePolicyBaseline,
  readPolicyBaseline,
  scanCompleteStaticCopyPolicy
}
