const parser = require('@babel/parser')
const { messageContract } = require('./catalog')

const SAFE_REASONS = new Set(['concatenation', 'interpolation'])
const ADAPTERS = new Set(['js', 'vue2', 'vue3'])
const PARSE = { sourceType: 'module', plugins: ['jsx', 'typescript'] }

function refusal(reason) {
  return { ok: false, reason }
}

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

function escapeKey(key) {
  return String(key).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function formatCall(helper, key, placeholders) {
  const literal = escapeKey(key)
  if (!placeholders.length) return `${helper}('${literal}')`
  const params = placeholders.map(name => name).join(', ')
  return `${helper}('${literal}', { ${params} })`
}

function placeholderName(node) {
  if (!node) return null
  if (node.type === 'Identifier') return node.name
  return null
}

function flattenConcat(node, parts) {
  if (!node) return false
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return flattenConcat(node.left, parts) && flattenConcat(node.right, parts)
  }
  if (node.type === 'StringLiteral') {
    parts.push({ type: 'text', value: node.value })
    return true
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    parts.push({ type: 'text', value: node.quasis[0] ? node.quasis[0].value.cooked || '' : '' })
    return true
  }
  const name = placeholderName(node)
  if (name) {
    parts.push({ type: 'placeholder', name })
    return true
  }
  return false
}

function deriveFromConcatenation(expressionNode) {
  const parts = []
  if (!flattenConcat(expressionNode, parts)) return null
  if (!parts.some(part => part.type === 'text' && /[\u4e00-\u9fff]/.test(part.value))) return null
  if (!parts.some(part => part.type === 'placeholder')) return null
  let derived = ''
  const placeholders = []
  for (const part of parts) {
    if (part.type === 'text') derived += part.value
    else {
      derived += `{${part.name}}`
      placeholders.push(part.name)
    }
  }
  return { derived, placeholders }
}

function deriveFromTemplateLiteral(node) {
  if (!node || node.type !== 'TemplateLiteral') return null
  let derived = ''
  const placeholders = []
  for (let index = 0; index < node.quasis.length; index += 1) {
    derived += node.quasis[index].value.cooked || ''
    if (index < node.expressions.length) {
      const name = placeholderName(node.expressions[index])
      if (!name) return null
      derived += `{${name}}`
      placeholders.push(name)
    }
  }
  if (!placeholders.length) return null
  if (!/[\u4e00-\u9fff]/.test(derived.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, ''))) return null
  return { derived, placeholders }
}

function parseExpression(expression) {
  try {
    return parser.parseExpression(expression, PARSE)
  } catch (error) {
    return null
  }
}

function chooseHelper(adapter, candidate, fileSource) {
  if (adapter === 'js') return 't'
  const pathName = candidate.location && candidate.location.path
  const isVue = typeof pathName === 'string' && pathName.toLowerCase().endsWith('.vue')
  if (!isVue) return 't'
  const start = offsetAt(fileSource, candidate.location.start)
  if (start < 0) return '$t'
  const before = fileSource.slice(0, start)
  const templateOpen = before.lastIndexOf('<template')
  const templateClose = before.lastIndexOf('</template>')
  const scriptOpen = before.lastIndexOf('<script')
  const scriptClose = before.lastIndexOf('</script>')
  const inTemplate = templateOpen > templateClose && (scriptOpen < templateOpen || scriptOpen < 0)
  if (inTemplate) return '$t'
  const inScript = scriptOpen > scriptClose
  if (inScript && /methods\s*:/.test(fileSource.slice(scriptOpen, start))) return 'this.$t'
  return adapter === 'vue2' ? 'this.$t' : '$t'
}

function planProvenSafeMigration({
  candidate,
  key,
  source,
  fileSource,
  adapter
} = {}) {
  if (!candidate || !candidate.location || typeof candidate.expression !== 'string') {
    return refusal('review write requires a dynamic message candidate with an expression location')
  }
  if (!ADAPTERS.has(adapter)) {
    return refusal(`unknown adapter "${adapter}"; expected js, vue2, or vue3`)
  }
  if (typeof key !== 'string' || !key) return refusal('review write requires a non-empty explicit key')
  if (typeof source !== 'string' || !source) return refusal('review write requires canonical explicit source text')
  if (typeof fileSource !== 'string') return refusal('review write requires the current source file contents')
  if (!SAFE_REASONS.has(candidate.reason)) {
    return refusal(
      `automatic source writing is not proven-safe for ${candidate.reason || 'this'} dynamic messages`
    )
  }

  const start = offsetAt(fileSource, candidate.location.start)
  const end = offsetAt(fileSource, candidate.location.end)
  if (start < 0 || end < start) {
    return refusal('candidate location does not match the current source')
  }
  const slice = fileSource.slice(start, end)
  if (slice !== candidate.expression) {
    return refusal('candidate expression does not match the current source')
  }

  const ast = parseExpression(candidate.expression)
  if (!ast) return refusal('candidate expression could not be parsed for proven-safe migration')

  let derived = null
  if (candidate.reason === 'concatenation') derived = deriveFromConcatenation(ast)
  else if (candidate.reason === 'interpolation') {
    derived = ast.type === 'TemplateLiteral'
      ? deriveFromTemplateLiteral(ast)
      : deriveFromConcatenation(ast)
  }
  if (!derived) {
    return refusal(
      'expression interpolations are not side-effect-free identifiers with mechanically derivable named placeholders'
    )
  }
  if (derived.derived !== source) {
    return refusal(
      'mechanically derived message text does not match the approved explicit source'
    )
  }
  const contract = messageContract(source)
  if (contract.placeholders.join('\0') !== derived.placeholders.join('\0')) {
    return refusal('derived placeholders do not match the approved explicit source contract')
  }

  const helper = chooseHelper(adapter, candidate, fileSource)
  const call = formatCall(helper, key, derived.placeholders)
  const preview = `${fileSource.slice(0, start)}${call}${fileSource.slice(end)}`
  return {
    ok: true,
    call,
    preview,
    placeholders: derived.placeholders,
    helper,
    edit: {
      path: candidate.location.path,
      start: candidate.location.start,
      end: candidate.location.end,
      text: call
    }
  }
}

function simpleDiff(pathName, before, after) {
  const beforeLines = String(before).split('\n')
  const afterLines = String(after).split('\n')
  const lines = [`--- ${pathName}`, `+++ ${pathName}`]
  const max = Math.max(beforeLines.length, afterLines.length)
  for (let index = 0; index < max; index += 1) {
    const left = beforeLines[index]
    const right = afterLines[index]
    if (left === right) continue
    if (left !== undefined) lines.push(`-${left}`)
    if (right !== undefined) lines.push(`+${right}`)
  }
  return `${lines.join('\n')}\n`
}

function applyEdits(source, edits) {
  const ordered = [...edits].sort((left, right) => right.start - left.start || right.end - left.end)
  let next = source
  for (const edit of ordered) {
    next = `${next.slice(0, edit.start)}${edit.text}${next.slice(edit.end)}`
  }
  return next
}

module.exports = {
  SAFE_REASONS,
  applyEdits,
  offsetAt,
  planProvenSafeMigration,
  simpleDiff
}
