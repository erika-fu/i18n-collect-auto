const { offsetToPosition } = require('./resource')

const WRAPPER_OPEN = '<i18n-collect-root>'
const WRAPPER_CLOSE = '</i18n-collect-root>'
const SELF_CLOSING_WARNING = 'non-void-html-element-start-tag-with-trailing-solidus'

function compileWithRanges(compiler, source, options) {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  try {
    return compiler.compile(source, options)
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  }
}

function failAt(source, offset, message) {
  const bounded = Math.max(0, Math.min(offset, source.length))
  const error = new Error(message)
  error.loc = offsetToPosition(source, bounded)
  return error
}

function requestedLang(resource) {
  if (resource.lang) return String(resource.lang).toLowerCase()
  const query = String(resource.query || '')
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
  return (params.get('lang') || 'html').toLowerCase()
}

function tagEnd(source, start) {
  let quote = null
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      return index + 1
    }
  }
  return -1
}

function templateOpening(source, contentStart) {
  const lower = source.toLowerCase()
  let candidate = lower.lastIndexOf('<template', contentStart)
  while (candidate >= 0) {
    if (tagEnd(source, candidate) === contentStart) return candidate
    candidate = lower.lastIndexOf('<template', candidate - 1)
  }
  return -1
}

function templateBlocks(source, compiler) {
  const blocks = []
  let end = source.length
  while (end > 0) {
    const descriptor = compiler.parseComponent(source.slice(0, end), {
      outputSourceRange: true,
      pad: false
    }).template
    if (!descriptor) break
    const open = templateOpening(source, descriptor.start)
    if (open < 0) break
    blocks.unshift({
      start: descriptor.start,
      end: descriptor.end,
      open,
      lang: String(descriptor.attrs.lang || 'html').toLowerCase(),
      src: descriptor.attrs.src
    })
    end = open
  }
  return blocks
}

function templateSpan(source, resource, compiler) {
  const lang = requestedLang(resource)
  if (!resource.projectPath.toLowerCase().endsWith('.vue')) {
    return { start: 0, end: source.length, lang }
  }
  const matches = templateBlocks(source, compiler)
    .filter(block => block.src == null && block.lang === lang)
  if (matches.length !== 1) {
    const offset = matches.length > 1 ? matches[1].open : 0
    throw failAt(
      source,
      offset,
      matches.length > 1 ? 'Vue template block is ambiguous' : 'Vue template block could not be located'
    )
  }
  return matches[0]
}

function identityStarts(length) {
  return Array.from({ length: length + 1 }, (_, index) => index)
}

function referenceValue(raw, compiler, cache) {
  if (cache.has(raw)) return cache.get(raw)
  const compiled = compileWithRanges(compiler, `<p>${raw}</p>`, { outputSourceRange: true })
  const child = compiled.ast && compiled.ast.children && compiled.ast.children[0]
  const value = child && typeof child.text === 'string' ? child.text : null
  cache.set(raw, value)
  return value
}

function readReference(raw, index, compiler, cache) {
  if (raw[index] !== '&') return null
  const match = /^(?:&#[0-9]+;|&#x[0-9a-fA-F]+;|&[A-Za-z][A-Za-z0-9]*;)/.exec(raw.slice(index))
  if (!match) return null
  const value = referenceValue(match[0], compiler, cache)
  return value == null || value === match[0] ? null : { raw: match[0], value }
}

function decodeHtml(raw, compiler, cache) {
  if (!raw.includes('&') && !raw.includes('\r')) {
    return { value: raw, starts: identityStarts(raw.length) }
  }
  let value = ''
  const starts = []
  for (let index = 0; index < raw.length;) {
    if (raw[index] === '\r') {
      starts.push(index)
      value += '\n'
      index += raw[index + 1] === '\n' ? 2 : 1
      continue
    }
    const reference = readReference(raw, index, compiler, cache)
    if (reference) {
      for (let unit = 0; unit < reference.value.length; unit += 1) starts.push(index)
      value += reference.value
      index += reference.raw.length
      continue
    }
    starts.push(index)
    value += raw[index]
    index += 1
  }
  starts.push(raw.length)
  return { value, starts }
}

function visibleBounds(value) {
  if (!/[\n\r]/.test(value)) return { start: 0, end: value.length }
  let start = 0
  let end = value.length
  const leading = /^(?:[ \t\f]*\n)+[ \t\f]*/.exec(value)
  if (leading) start = leading[0].length
  const trailing = /(?:\n[ \t\f]*)+$/.exec(value)
  if (trailing && trailing.index >= start) end = trailing.index
  return end <= start ? null : { start, end }
}

function scanString(source, index) {
  const quote = source[index]
  let cursor = index + 1
  while (cursor < source.length) {
    if (source[cursor] === '\\') cursor += 2
    else if (source[cursor] === quote) return cursor + 1
    else cursor += 1
  }
  return -1
}

function scanTemplate(source, index) {
  let cursor = index + 1
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2
      continue
    }
    if (source[cursor] === '`') return cursor + 1
    if (source[cursor] === '$' && source[cursor + 1] === '{') {
      cursor += 2
      let depth = 1
      while (cursor < source.length && depth > 0) {
        if (source[cursor] === '"' || source[cursor] === "'") {
          const next = scanString(source, cursor)
          if (next < 0) return -1
          cursor = next
          continue
        }
        if (source[cursor] === '`') {
          const next = scanTemplate(source, cursor)
          if (next < 0) return -1
          cursor = next
          continue
        }
        if (source[cursor] === '{') depth += 1
        else if (source[cursor] === '}') depth -= 1
        if (depth > 0) cursor += 1
      }
      if (depth !== 0) return -1
      cursor += 1
      continue
    }
    cursor += 1
  }
  return -1
}

function scanExpressionEnd(source, start) {
  let cursor = start
  let depth = 0
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === '"' || char === "'") {
      const next = scanString(source, cursor)
      if (next < 0) return -1
      cursor = next
      continue
    }
    if (char === '`') {
      const next = scanTemplate(source, cursor)
      if (next < 0) return -1
      cursor = next
      continue
    }
    if (char === '/' && source[cursor + 1] === '/') {
      const next = source.indexOf('\n', cursor)
      cursor = next === -1 ? source.length : next + 1
      continue
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const next = source.indexOf('*/', cursor + 2)
      if (next < 0) return -1
      cursor = next + 2
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      if (depth === 0) return source[cursor + 1] === '}' ? cursor : -1
      depth -= 1
    }
    cursor += 1
  }
  return -1
}

function interpolationPieces(raw) {
  const pieces = []
  let cursor = 0
  while (cursor < raw.length) {
    const open = raw.indexOf('{{', cursor)
    if (open === -1) break
    const end = scanExpressionEnd(raw, open + 2)
    if (end < 0) return { errorOffset: open }
    pieces.push({ type: 'text', start: cursor, end: open })
    pieces.push({ type: 'expression', start: open + 2, end })
    cursor = end + 2
  }
  pieces.push({ type: 'text', start: cursor, end: raw.length })
  return { pieces }
}

function attributeContent(source, location) {
  const raw = source.slice(location.start, location.end)
  const eq = raw.indexOf('=')
  if (eq < 0) return null
  let cursor = eq + 1
  while (cursor < raw.length && /[ \t\n\r\f]/.test(raw[cursor])) cursor += 1
  if (cursor >= raw.length) return null
  let start = location.start + cursor
  let end = location.end
  const quote = raw[cursor]
  if (quote === '"' || quote === "'") {
    start += 1
    end -= 1
  }
  return end < start ? null : { start, end, raw: source.slice(start, end) }
}

function mappedRegion(type, decoded, base, bounds, owners, extra) {
  const start = bounds ? bounds.start : 0
  const end = bounds ? bounds.end : decoded.value.length
  return {
    type,
    value: decoded.value.slice(start, end),
    start: base + decoded.starts[start],
    end: base + decoded.starts[end],
    sourceOffsets: decoded.starts.map(offset => base + offset),
    owners: owners.slice(),
    ...extra
  }
}

function compilerError(errors) {
  return (errors || []).find(error => {
    const message = typeof error === 'string' ? error : error.msg
    return !String(message).startsWith('invalid expression:')
  })
}

function normalizedErrorMessage(error) {
  const message = typeof error === 'string' ? error : error.msg
  if (String(message).startsWith('duplicate attribute:')) return 'duplicate-attribute'
  return message
}

function parse({ source, resource, templateCompiler }) {
  const span = templateSpan(source, resource, templateCompiler)
  if (span.lang !== 'html') {
    return { constructs: [], comments: [], regions: [], warnings: [] }
  }
  const fragment = source.slice(span.start, span.end)
  const wrapped = `${WRAPPER_OPEN}${fragment}${WRAPPER_CLOSE}`
  const compiled = compileWithRanges(templateCompiler, wrapped, {
    comments: true,
    outputSourceRange: true
  })
  const structuralError = compilerError(compiled.errors)
  if (structuralError) {
    const local = Number.isInteger(structuralError.start)
      ? structuralError.start - WRAPPER_OPEN.length
      : 0
    throw failAt(source, span.start + Math.max(0, local), normalizedErrorMessage(structuralError))
  }

  const root = compiled.ast
  if (!root) return { constructs: [], comments: [], regions: [], warnings: [] }
  const base = span.start - WRAPPER_OPEN.length
  const constructs = []
  const comments = []
  const regions = []
  const warnings = []
  const ids = new WeakMap()
  const references = new Map()

  function children(node) {
    if (!node) return []
    const found = new Set(Array.isArray(node.children) ? node.children : [])
    for (const condition of node.ifConditions || []) {
      if (condition.block && condition.block !== node) found.add(condition.block)
    }
    for (const slot of Object.values(node.scopedSlots || {})) found.add(slot)
    return [...found].sort((left, right) => (left.start || 0) - (right.start || 0))
  }

  function isConstruct(node) {
    if (!node || node === root || node.isComment) return false
    if (node.type === 1) return true
    return typeof node.text === 'string' && !/^\s*$/.test(node.text)
  }

  function visit(node, parentId = null) {
    if (!node) return
    let childParentId = parentId
    if (node.isComment) {
      comments.push({
        start: base + node.start,
        end: base + node.end,
        text: node.text
      })
    } else if (isConstruct(node)) {
      const id = constructs.length
      ids.set(node, id)
      constructs.push({
        id,
        kind: node.type === 1 ? 'element' : node.type === 2 ? 'expression' : 'text',
        name: node.type === 1 ? node.tag : null,
        parentId,
        start: base + node.start,
        end: base + node.end
      })
      childParentId = id
    }
    for (const child of children(node)) visit(child, childParentId)
  }
  visit(root)

  const owners = []

  function addText(node) {
    const raw = wrapped.slice(node.start, node.end)
    const found = interpolationPieces(raw)
    if (found.errorOffset != null) {
      throw failAt(source, base + node.start + found.errorOffset, 'Unclosed Vue interpolation')
    }
    for (const piece of found.pieces) {
      if (piece.end <= piece.start) continue
      const pieceRaw = raw.slice(piece.start, piece.end)
      const decoded = decodeHtml(pieceRaw, templateCompiler, references)
      const pieceBase = base + node.start + piece.start
      if (piece.type === 'expression') {
        regions.push(mappedRegion('expression', decoded, pieceBase, null, owners, {
          expressionKind: 'template-expression'
        }))
      } else {
        const bounds = visibleBounds(decoded.value)
        if (bounds) regions.push(mappedRegion('text', decoded, pieceBase, bounds, owners))
      }
    }
  }

  function addAttributes(node) {
    for (const attr of node.attrsList || []) {
      if (!Number.isInteger(attr.start) || !Number.isInteger(attr.end)) continue
      const content = attributeContent(wrapped, attr)
      if (!content) continue
      const decoded = decodeHtml(content.raw, templateCompiler, references)
      regions.push(mappedRegion('attribute', decoded, base + content.start, null, owners, {
        name: attr.name
      }))
    }
  }

  function walk(node) {
    if (!node || node.isComment) return
    const id = ids.get(node)
    if (id != null) owners.push(id)
    if (node.type === 1) {
      if (node !== root) {
        addAttributes(node)
        const openEnd = tagEnd(wrapped, node.start)
        if (openEnd > node.start && /\/\s*>$/.test(wrapped.slice(node.start, openEnd))) {
          warnings.push({ code: SELF_CLOSING_WARNING })
        }
      }
      for (const child of children(node)) walk(child)
    } else if (typeof node.text === 'string') {
      addText(node)
    }
    if (id != null) owners.pop()
  }
  walk(root)

  return { constructs, comments, regions, warnings }
}

module.exports = { parse }
