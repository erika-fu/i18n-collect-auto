const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const PARSE = { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] }
const SCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])
const MISMATCH = 'catalog location does not match the current source'
const OPTION_BUCKETS = new Set(['methods', 'computed', 'watch', 'directives', 'filters'])
const LIFECYCLE = new Set([
  'beforeCreate', 'created', 'beforeMount', 'mounted', 'beforeUpdate', 'updated',
  'beforeDestroy', 'destroyed', 'beforeUnmount', 'unmounted', 'activated', 'deactivated',
  'errorCaptured', 'renderTracked', 'renderTriggered', 'serverPrefetch', 'data'
])

function offsetAt(source, position) {
  if (!position || !Number.isInteger(position.line) || !Number.isInteger(position.column)) return -1
  let line = 1
  let column = 0
  for (let index = 0; index <= source.length; index += 1) {
    if (line === position.line && column === position.column) return index
    if (index === source.length) break
    const char = source[index]
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      line += 1
      column = 0
    } else {
      column += 1
    }
  }
  return -1
}

function fileClass(projectPath, styleExtensions) {
  const extension = path.posix.extname(projectPath).toLowerCase()
  if (extension === '.vue') return 'vue'
  if (extension === '.html' || extension === '.htm') return 'html'
  if (styleExtensions.has(extension)) return 'style'
  if (SCRIPT_EXTENSIONS.has(extension)) return 'script'
  return 'other'
}

function scopeReason(kind, klass) {
  if (kind === 'css-generated-content' || klass === 'style') return 'CSS generated content is outside replacement scope'
  if (kind === 'static-html-text' || kind === 'static-html-attribute' || klass === 'html') {
    return 'standalone HTML is outside replacement scope'
  }
  if (klass === 'other') return 'file type is outside replacement scope'
  return null
}

function formatCall(name, key) {
  const literal = String(key).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `${name}('${literal}')`
}

function matchesText(slice, text) {
  return slice === text || decodeHtml(slice) === text
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, '\u00A0')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(parseInt(digits, 16)))
    .replace(/&amp;/g, '&')
}

function looksLocalized(source, index) {
  const before = source.slice(Math.max(0, index - 80), index)
  const match = before.match(/(?:this\s*\.\s*\$t|\$t|(?:^|[^.\w])t)\s*\(\s*['"`]?\s*$/)
  if (!match) return null
  if (match[0].includes('this')) return 'this.$t'
  if (match[0].includes('$t')) return '$t'
  return 't'
}

function enclosingMustache(source, start, end) {
  const open = source.lastIndexOf('{{', start)
  if (open < 0) return null
  const close = source.indexOf('}}', end)
  if (close < 0) return null
  if (source.slice(open + 2, start).includes('}}')) return null
  return { origin: open + 2, text: source.slice(open + 2, close) }
}

function enclosingAttributeValue(source, start) {
  let cursor = start
  while (cursor >= 0 && source[cursor] !== '=' && source[cursor] !== '<' && source[cursor] !== '>') cursor -= 1
  if (source[cursor] !== '=') return null
  cursor += 1
  while (cursor < source.length && /[ \t\n\r\f]/.test(source[cursor])) cursor += 1
  const quote = source[cursor]
  if (quote !== '"' && quote !== "'") return null
  const valueStart = cursor + 1
  let valueEnd = valueStart
  while (valueEnd < source.length && source[valueEnd] !== quote) {
    if (source[valueEnd] === '\\') valueEnd += 2
    else valueEnd += 1
  }
  if (source[valueEnd] !== quote) return null
  return { origin: valueStart, text: source.slice(valueStart, valueEnd) }
}

function localizationInExpression(host, start, end) {
  let expression
  try {
    expression = parser.parseExpression(host.text)
  } catch (error) {
    return null
  }
  const ast = {
    type: 'File',
    program: {
      type: 'Program',
      sourceType: 'module',
      directives: [],
      body: [{ type: 'ExpressionStatement', expression }]
    }
  }
  let name = null
  traverse(ast, {
    StringLiteral(nodePath) {
      if (host.origin + nodePath.node.start === start && host.origin + nodePath.node.end === end) {
        name = enclosingLocalizationCall(nodePath) || name
      }
    },
    TemplateElement(nodePath) {
      if (host.origin + nodePath.node.start === start && host.origin + nodePath.node.end === end) {
        name = enclosingLocalizationCall(nodePath) || name
      }
    }
  })
  return name
}

function localizationAt(source, start, end) {
  const host = enclosingMustache(source, start, end) || enclosingAttributeValue(source, start)
  if (host) {
    const name = localizationInExpression(host, start, end)
    if (name) return name
  }
  return looksLocalized(source, start)
}

function hasEquals(source, index) {
  let cursor = index
  while (cursor >= 0 && /[ \t\n\r\f]/.test(source[cursor])) cursor -= 1
  return source[cursor] === '='
}

function staticAttributeEdit(source, start, end, call) {
  const quoted = source[start - 1] === '"' || source[start - 1] === "'"
  const valueEnd = quoted && source[end] === source[start - 1] ? end + 1 : end
  const delimiter = quoted ? start - 1 : start
  let cursor = delimiter - 1
  while (cursor >= 0 && /[ \t\n\r\f]/.test(source[cursor])) cursor -= 1
  if (source[cursor] !== '=') return null
  cursor -= 1
  while (cursor >= 0 && /[ \t\n\r\f]/.test(source[cursor])) cursor -= 1
  const nameEnd = cursor + 1
  while (cursor >= 0 && /[^\s=>/"']/.test(source[cursor])) cursor -= 1
  const nameStart = cursor + 1
  const name = source.slice(nameStart, nameEnd)
  if (!name || name.startsWith(':') || name.startsWith('v-bind:') || name.startsWith('v-on:') || name.startsWith('@') || name.startsWith('#')) {
    return null
  }
  return { start: nameStart, end: valueEnd, text: `:${name}="${call}"` }
}

function editFragment(source, start, end, text, call, kind, adapter) {
  const slice = source.slice(start, end)
  const quoted = (slice.startsWith("'") && slice.endsWith("'")) || (slice.startsWith('"') && slice.endsWith('"')) || (slice.startsWith('`') && slice.endsWith('`'))
  const body = quoted ? slice.slice(1, -1) : slice
  if (!matchesText(body, text)) return { skip: MISMATCH }
  if (quoted) return { start, end, text: call }
  const quote = source[start - 1]
  const closing = source[end]
  if ((quote === '"' || quote === "'") && closing === quote) {
    if (kind === 'html-attribute' && hasEquals(source, start - 2)) {
      const edit = staticAttributeEdit(source, start, end, call)
      if (!edit) return { skip: `semantic position is not supported by the ${adapter} adapter` }
      return edit
    }
    return { start: start - 1, end: end + 1, text: call }
  }
  if (kind === 'html-attribute' && hasEquals(source, start - 1)) {
    const edit = staticAttributeEdit(source, start, end, call)
    if (!edit) return { skip: `semantic position is not supported by the ${adapter} adapter` }
    return edit
  }
  if (quote === '`' && closing === '`' && !slice.includes('${')) {
    return { start: start - 1, end: end + 1, text: call }
  }
  if (quote === '`' || closing === '`' || closing === '$' || quote === '}') {
    return { start, end, text: `\${${call}}` }
  }
  return { skip: MISMATCH }
}

function scriptBlocks(source, klass) {
  if (klass === 'script') return [{ setup: false, innerStart: 0, innerEnd: source.length, source }]
  if (klass !== 'vue') return []
  const blocks = []
  const pattern = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi
  let match = pattern.exec(source)
  while (match) {
    const openTag = match[0].slice(0, match[0].length - match[2].length - '</script>'.length)
    const innerStart = match.index + openTag.length
    blocks.push({
      setup: /\bsetup\b/.test(match[1] || ''),
      innerStart,
      innerEnd: innerStart + match[2].length,
      source: maskOutside(source, innerStart, innerStart + match[2].length)
    })
    match = pattern.exec(source)
  }
  return blocks
}

function maskOutside(source, start, end) {
  const chars = []
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (index >= start && index < end) chars.push(char)
    else chars.push(char === '\n' || char === '\r' ? char : ' ')
  }
  return chars.join('')
}

function insideJsx(nodePath) {
  let current = nodePath
  while (current) {
    if (current.isJSXElement() || current.isJSXFragment() || current.isJSXAttribute() || current.isJSXExpressionContainer() || current.isJSXOpeningElement() || current.isJSXText()) {
      return true
    }
    current = current.parentPath
  }
  return false
}

function calleeName(callee) {
  if (!callee) return null
  if (callee.type === 'Identifier' && (callee.name === 't' || callee.name === '$t')) return callee.name
  if (callee.type !== 'MemberExpression' || callee.computed || !callee.property || callee.property.type !== 'Identifier') return null
  if (callee.property.name !== '$t' || !callee.object || callee.object.type !== 'ThisExpression') return null
  return 'this.$t'
}

function enclosingLocalizationCall(nodePath) {
  const start = nodePath.node.start
  const end = nodePath.node.end
  let current = nodePath.parentPath
  while (current) {
    if (current.isCallExpression()) {
      const name = calleeName(current.node.callee)
      const wraps = current.node.arguments.some(argument => argument && argument.start <= start && argument.end >= end)
      if (wraps && name) return name
    }
    if (current.isFunction()) break
    current = current.parentPath
  }
  return null
}

function keyName(key) {
  if (!key) return null
  if (key.type === 'Identifier') return key.name
  if (key.type === 'StringLiteral') return key.value
  return null
}

function isComponentOptions(objectPath) {
  const parent = objectPath.parentPath
  if (!parent) return false
  if (parent.isExportDefaultDeclaration()) return true
  if (!parent.isAssignmentExpression()) return false
  const left = parent.node.left
  return left.type === 'MemberExpression'
    && !left.computed
    && left.object.type === 'Identifier'
    && left.object.name === 'module'
    && left.property.type === 'Identifier'
    && left.property.name === 'exports'
}

function isOptionsBucket(objectPath) {
  const parent = objectPath.parentPath
  if (!parent || !parent.isObjectProperty() || parent.node.computed) return false
  if (!OPTION_BUCKETS.has(keyName(parent.node.key))) return false
  return parent.parentPath && parent.parentPath.isObjectExpression() && isComponentOptions(parent.parentPath)
}

function methodName(fnPath) {
  if (fnPath.isObjectMethod()) return keyName(fnPath.node.key)
  if (fnPath.isFunctionExpression() && fnPath.parentPath && fnPath.parentPath.isObjectProperty()) {
    return keyName(fnPath.parentPath.node.key)
  }
  return null
}

function isVueInstanceMethod(fnPath) {
  const name = methodName(fnPath)
  if (!name || name === 'setup') return false
  let objectPath = null
  if (fnPath.isObjectMethod() && fnPath.parentPath && fnPath.parentPath.isObjectExpression()) objectPath = fnPath.parentPath
  if (fnPath.isFunctionExpression() && fnPath.parentPath && fnPath.parentPath.isObjectProperty() && fnPath.parentPath.parentPath && fnPath.parentPath.parentPath.isObjectExpression()) {
    objectPath = fnPath.parentPath.parentPath
  }
  if (!objectPath) return false
  if (LIFECYCLE.has(name) && isComponentOptions(objectPath)) return true
  return isOptionsBucket(objectPath)
}

function isArrowMethod(nodePath) {
  if (!nodePath.isArrowFunctionExpression() || !nodePath.parentPath || !nodePath.parentPath.isObjectProperty()) return false
  return nodePath.parentPath.node.value === nodePath.node
}

function resolveInstance(nodePath) {
  let current = nodePath
  let arrowMethod = false
  while (current) {
    if (current.isArrowFunctionExpression()) {
      if (isArrowMethod(current)) arrowMethod = true
      current = current.parentPath
      continue
    }
    if (current.isFunctionExpression() || current.isFunctionDeclaration() || current.isObjectMethod() || current.isClassMethod()) {
      if (isVueInstanceMethod(current)) return { call: 'this.$t' }
      return { blocked: true }
    }
    current = current.parentPath
  }
  if (arrowMethod) return { skip: 'arrow function does not provide a Vue instance' }
  return null
}

function placed(nodePath) {
  let current = nodePath.parentPath && nodePath.parentPath.isTemplateLiteral() ? nodePath.parentPath : nodePath
  while (current.parentPath && (
    current.parentPath.isParenthesizedExpression()
    || current.parentPath.isTSAsExpression()
    || current.parentPath.isTSTypeAssertion()
    || current.parentPath.isTSNonNullExpression()
    || current.parentPath.isTSSatisfiesExpression()
  )) {
    current = current.parentPath
  }
  return current
}

function isObjectKey(nodePath) {
  const parent = placed(nodePath).parent
  const node = placed(nodePath).node
  if (!parent) return false
  if (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod' || parent.type === 'ClassProperty' || parent.type === 'ClassMethod') {
    return parent.key === node
  }
  return false
}

function isSwitchCase(nodePath) {
  const site = placed(nodePath)
  return site.parent && site.parent.type === 'SwitchCase' && site.parent.test === site.node
}

function sameNode(parent, field, node) {
  return parent && parent[field] === node
}

function supportedScriptPosition(nodePath) {
  const site = placed(nodePath)
  const node = site.node
  const parent = site.parent
  if (!parent) return false
  if (sameNode(parent, 'init', node) && parent.type === 'VariableDeclarator') return true
  if (parent.type === 'AssignmentExpression' && parent.right === node) return true
  if ((parent.type === 'ReturnStatement' || parent.type === 'ThrowStatement') && parent.argument === node) return true
  if ((parent.type === 'CallExpression' || parent.type === 'NewExpression') && parent.arguments.includes(node)) return true
  if (parent.type === 'ArrayExpression' && parent.elements.includes(node)) return true
  if (parent.type === 'ObjectProperty' && parent.value === node) return true
  if (parent.type === 'ConditionalExpression' && (parent.test === node || parent.consequent === node || parent.alternate === node)) return true
  if ((parent.type === 'LogicalExpression' || parent.type === 'BinaryExpression') && (parent.left === node || parent.right === node)) return true
  if (parent.type === 'SequenceExpression' && parent.expressions.includes(node)) return true
  if (parent.type === 'ArrowFunctionExpression' && parent.body === node) return true
  if (parent.type === 'ExpressionStatement' && parent.expression === node) return true
  if (parent.type === 'ExportDefaultDeclaration' && parent.declaration === node) return true
  return false
}

function describeLiteral(nodePath) {
  const element = nodePath.isTemplateElement()
  const template = element ? nodePath.parentPath.node : null
  const single = template && template.expressions.length === 0 && template.quasis.length === 1
  return {
    start: nodePath.node.start,
    end: nodePath.node.end,
    value: element ? nodePath.node.value.cooked : nodePath.node.value,
    jsx: insideJsx(nodePath),
    localized: enclosingLocalizationCall(nodePath),
    objectKey: isObjectKey(nodePath),
    switchCase: isSwitchCase(nodePath),
    supported: supportedScriptPosition(nodePath),
    instance: resolveInstance(nodePath),
    hasT: nodePath.scope.hasBinding('t'),
    wholeStart: single ? template.start : null,
    wholeEnd: single ? template.end : null
  }
}

function indexBlock(block) {
  let ast
  try {
    ast = parser.parse(block.source, PARSE)
  } catch (error) {
    return { ...block, error: true, nodes: new Map() }
  }
  const nodes = new Map()
  traverse(ast, {
    StringLiteral(nodePath) {
      nodes.set(`${nodePath.node.start}:${nodePath.node.end}`, describeLiteral(nodePath))
    },
    TemplateElement(nodePath) {
      if (nodePath.node.value.cooked == null) return
      nodes.set(`${nodePath.node.start}:${nodePath.node.end}`, describeLiteral(nodePath))
    }
  })
  return { ...block, error: false, nodes }
}

function prepareScript(source, klass) {
  return scriptBlocks(source, klass).map(indexBlock)
}

function blockAt(blocks, offset) {
  return blocks.find(block => offset >= block.innerStart && offset < block.innerEnd) || null
}

function selectCall(adapter, info, setup) {
  if (adapter === 'js') {
    if (!info.hasT) return { skip: 'js adapter requires t to already be in scope' }
    return { call: 't' }
  }
  if (adapter === 'vue2' && setup) return { skip: 'vue2 adapter does not replace script setup' }
  if (setup) {
    if (!info.hasT) return { skip: 'vue3 adapter requires t to already be in scope' }
    return { call: 't' }
  }
  if (info.instance && info.instance.call) return { call: info.instance.call }
  if (adapter === 'vue3' && info.hasT) return { call: 't' }
  if (info.instance && info.instance.skip) return { skip: info.instance.skip }
  if (adapter === 'vue2') return { skip: 'vue2 adapter requires a component instance method' }
  return { skip: 'vue3 adapter requires t in scope or a component instance method' }
}

function detailOf(base, extra) {
  return { ...base, ...extra }
}

function decideTemplate(source, item, adapter, base) {
  if (adapter === 'js') {
    const reason = item.location.kind === 'html-text'
      ? 'Vue template text is not a js adapter position'
      : item.location.kind === 'html-attribute'
        ? 'Vue attribute is not a js adapter position'
        : 'Vue template expression is not a js adapter position'
    return { action: 'skip', detail: detailOf(base, { reason }) }
  }
  const start = offsetAt(source, item.location.start)
  const end = offsetAt(source, item.location.end)
  if (start < 0 || end < start) return { action: 'skip', detail: detailOf(base, { reason: MISMATCH }) }
  const existing = localizationAt(source, start, end)
  if (existing && item.location.kind !== 'html-text') {
    return { action: 'keep', detail: detailOf(base, { call: formatCall(existing, item.key) }) }
  }
  const call = formatCall('$t', item.key)
  if (item.location.kind === 'html-text') {
    if (!matchesText(source.slice(start, end), item.source)) return { action: 'skip', detail: detailOf(base, { reason: MISMATCH }) }
    return { action: 'replace', edit: { start, end, text: `{{ ${call} }}` }, detail: detailOf(base, { call }) }
  }
  const edit = editFragment(source, start, end, item.source, call, item.location.kind, adapter)
  if (edit.keep) return { action: 'keep', detail: detailOf(base, { call }) }
  if (edit.skip) return { action: 'skip', detail: detailOf(base, { reason: edit.skip }) }
  return { action: 'replace', edit, detail: detailOf(base, { call }) }
}

function decideScript(source, item, adapter, blocks, base) {
  const start = offsetAt(source, item.location.start)
  const end = offsetAt(source, item.location.end)
  if (start < 0 || end < start) return { action: 'skip', detail: detailOf(base, { reason: MISMATCH }) }
  const block = blockAt(blocks, start)
  if (!block) return { action: 'skip', detail: detailOf(base, { reason: MISMATCH }) }
  if (block.error) return { action: 'skip', detail: detailOf(base, { reason: 'source could not be parsed' }) }
  const info = block.nodes.get(`${start}:${end}`)
  if (!info || info.value !== item.source) return { action: 'skip', detail: detailOf(base, { reason: MISMATCH }) }
  if (info.localized) return { action: 'keep', detail: detailOf(base, { call: formatCall(info.localized, item.key) }) }
  if (info.jsx) return { action: 'skip', detail: detailOf(base, { reason: 'React JSX is outside replacement scope' }) }
  if (info.objectKey) return { action: 'skip', detail: detailOf(base, { reason: 'object key is not a supported semantic position' }) }
  if (info.switchCase) return { action: 'skip', detail: detailOf(base, { reason: 'switch case is not a supported semantic position' }) }
  if (!info.supported) return { action: 'skip', detail: detailOf(base, { reason: `semantic position is not supported by the ${adapter} adapter` }) }
  const selected = selectCall(adapter, info, block.setup)
  if (selected.skip) return { action: 'skip', detail: detailOf(base, { reason: selected.skip }) }
  const call = formatCall(selected.call, item.key)
  const edit = info.wholeStart == null
    ? { start: info.start, end: info.end, text: item.location.kind === 'template-literal' ? `\${${call}}` : call }
    : { start: info.wholeStart, end: info.wholeEnd, text: call }
  return { action: 'replace', edit, detail: detailOf(base, { call }) }
}

function decide(source, item, adapter, klass, blocks) {
  const base = {
    path: item.location.path,
    key: item.key,
    kind: item.location.kind,
    source: item.source,
    start: item.location.start,
    end: item.location.end
  }
  const scoped = scopeReason(item.location.kind, klass)
  if (scoped) return { action: 'skip', detail: detailOf(base, { reason: scoped }) }
  if (source == null) return { action: 'skip', detail: detailOf(base, { reason: 'source file is missing' }) }
  if (item.location.kind === 'html-text' || item.location.kind === 'html-attribute' || item.location.kind === 'template-expression') {
    return decideTemplate(source, item, adapter, base)
  }
  if (item.location.kind === 'script-string' || item.location.kind === 'template-literal') {
    return decideScript(source, item, adapter, blocks, base)
  }
  return { action: 'skip', detail: detailOf(base, { reason: `semantic position is not supported by the ${adapter} adapter` }) }
}

function applyEdits(source, edits) {
  const ordered = [...edits].sort((left, right) => right.start - left.start)
  let next = source
  for (const edit of ordered) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end)
  return next
}

function byPosition(left, right) {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1
  if (left.start.line !== right.start.line) return left.start.line - right.start.line
  if (left.start.column !== right.start.column) return left.start.column - right.start.column
  return left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0
}

function previewFile(projectPath, source, items, adapter, styleExtensions) {
  const klass = fileClass(projectPath, styleExtensions)
  const blocks = source == null ? [] : prepareScript(source, klass)
  const decisions = items.map(item => decide(source, item, adapter, klass, blocks))
  const edits = []
  for (const decision of decisions) {
    if (decision.action !== 'replace') continue
    const overlaps = edits.some(edit => decision.edit.start < edit.end && edit.start < decision.edit.end)
    if (overlaps) {
      decision.action = 'skip'
      decision.detail = { ...decision.detail, reason: 'overlapping source range' }
      delete decision.detail.call
      continue
    }
    edits.push(decision.edit)
  }
  const preview = source == null ? null : applyEdits(source, edits)
  return {
    replacements: decisions.filter(decision => decision.action === 'replace').map(decision => decision.detail),
    skipped: decisions.filter(decision => decision.action === 'skip').map(decision => decision.detail),
    recognized: decisions.filter(decision => decision.action === 'keep').map(decision => decision.detail),
    preview: preview != null && preview !== source ? { path: projectPath, content: preview } : null
  }
}

function planPreview({ adapter, items, sources, styleExtensions }) {
  const grouped = new Map()
  for (const item of items) {
    const list = grouped.get(item.location.path) || []
    list.push(item)
    grouped.set(item.location.path, list)
  }
  const replacements = []
  const skipped = []
  const recognized = []
  const previews = []
  for (const projectPath of [...grouped.keys()].sort()) {
    const result = previewFile(projectPath, sources.has(projectPath) ? sources.get(projectPath) : null, grouped.get(projectPath), adapter, styleExtensions)
    replacements.push(...result.replacements)
    skipped.push(...result.skipped)
    recognized.push(...result.recognized)
    if (result.preview) previews.push(result.preview)
  }
  replacements.sort(byPosition)
  skipped.sort(byPosition)
  recognized.sort(byPosition)
  previews.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return { replacements, skipped, recognized, previews }
}

function isFunctionNode(node) {
  return node && (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression' || node.type === 'FunctionDeclaration' || node.type === 'ObjectMethod')
}

function bindingIsFunction(binding) {
  if (!binding || !binding.path) return false
  const node = binding.path.node
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') return true
  if (node.type === 'VariableDeclarator') return isFunctionNode(node.init)
  return false
}

function objectExportsFunctionT(objectPath) {
  return objectPath.node.properties.some(property => {
    if ((property.type !== 'ObjectProperty' && property.type !== 'ObjectMethod') || property.computed) return false
    if (keyName(property.key) !== 't') return false
    if (property.type === 'ObjectMethod' || isFunctionNode(property.value)) return true
    if (property.value && property.value.type === 'Identifier') return bindingIsFunction(objectPath.scope.getBinding(property.value.name))
    return false
  })
}

function isExportsT(member) {
  return member.type === 'MemberExpression'
    && !member.computed
    && keyName(member.property) === 't'
    && (
      (member.object.type === 'Identifier' && member.object.name === 'exports')
      || (
        member.object.type === 'MemberExpression'
        && !member.object.computed
        && member.object.object.type === 'Identifier'
        && member.object.object.name === 'module'
        && keyName(member.object.property) === 'exports'
      )
    )
}

function isModuleExports(member) {
  return member.type === 'MemberExpression'
    && !member.computed
    && member.object.type === 'Identifier'
    && member.object.name === 'module'
    && keyName(member.property) === 'exports'
}

function exportsLocalizationFunction(source) {
  let ast
  try {
    ast = parser.parse(source, PARSE)
  } catch (error) {
    return false
  }
  let found = false
  traverse(ast, {
    ExportNamedDeclaration(nodePath) {
      const declaration = nodePath.node.declaration
      if (declaration && declaration.type === 'FunctionDeclaration' && declaration.id && declaration.id.name === 't') found = true
      if (declaration && declaration.type === 'VariableDeclaration') {
        found = declaration.declarations.some(declarator => declarator.id.type === 'Identifier' && declarator.id.name === 't' && isFunctionNode(declarator.init)) || found
      }
      for (const specifier of nodePath.node.specifiers || []) {
        if (!specifier.exported || specifier.exported.type !== 'Identifier' || specifier.exported.name !== 't') continue
        const local = specifier.local && specifier.local.type === 'Identifier' ? specifier.local.name : ''
        if (bindingIsFunction(nodePath.scope.getBinding(local))) found = true
      }
    },
    ExportDefaultDeclaration(nodePath) {
      const declaration = nodePath.node.declaration
      if (declaration.type === 'FunctionDeclaration' && declaration.id && declaration.id.name === 't') found = true
      if (declaration.type === 'ObjectExpression' && objectExportsFunctionT(nodePath.get('declaration'))) found = true
    },
    AssignmentExpression(nodePath) {
      const left = nodePath.node.left
      const right = nodePath.node.right
      if (isExportsT(left)) {
        if (isFunctionNode(right) || (right.type === 'Identifier' && bindingIsFunction(nodePath.scope.getBinding(right.name)))) found = true
      }
      if (isModuleExports(left)) {
        if (right.type === 'FunctionExpression' && right.id && right.id.name === 't') found = true
        if (right.type === 'ObjectExpression' && objectExportsFunctionT(nodePath.get('right'))) found = true
      }
    }
  })
  return found
}

function runtimeCalls(source) {
  const found = { vue2: false, vue3: false }
  let ast
  try {
    ast = parser.parse(source, PARSE)
  } catch (error) {
    return found
  }
  traverse(ast, {
    NewExpression(nodePath) {
      if (nodePath.node.callee.type === 'Identifier' && nodePath.node.callee.name === 'VueI18n') found.vue2 = true
    },
    CallExpression(nodePath) {
      const callee = nodePath.node.callee
      if (callee.type === 'Identifier' && callee.name === 'createI18n') found.vue3 = true
      if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' && callee.object.name === 'Vue' && keyName(callee.property) === 'use') {
        const [argument] = nodePath.node.arguments
        if (argument && argument.type === 'Identifier' && argument.name === 'VueI18n') found.vue2 = true
      }
    }
  })
  return found
}

module.exports = {
  SCRIPT_EXTENSIONS,
  exportsLocalizationFunction,
  planPreview,
  runtimeCalls
}
