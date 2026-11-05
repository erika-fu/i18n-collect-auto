const parse5 = require('parse5')
const { offsetToPosition } = require('./resource')

const IGNORED_PARSE_ERRORS = new Set([
  'non-void-html-element-start-tag-with-trailing-solidus'
])

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

function templateSpan(source, resource) {
  return { start: 0, end: source.length, lang: requestedLang(resource) }
}

function identityStarts(length) {
  const starts = []
  for (let index = 0; index <= length; index += 1) starts.push(index)
  return starts
}

function decodeReference(raw) {
  const fragment = parse5.parseFragment(raw)
  const node = fragment.childNodes.length === 1 ? fragment.childNodes[0] : null
  return node && node.nodeName === '#text' && node.value !== raw ? node.value : null
}

function readReference(raw, index) {
  if (raw[index] !== '&') return null
  const match = /^(?:&#[0-9]+;|&#x[0-9a-fA-F]+;|&[A-Za-z][A-Za-z0-9]*;)/.exec(raw.slice(index))
  if (!match) return null
  const value = decodeReference(match[0])
  if (value == null) return null
  return { raw: match[0], value }
}

function decodeHtmlText(raw) {
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
    if (raw[index] === '&') {
      const reference = readReference(raw, index)
      if (reference) {
        for (let unit = 0; unit < reference.value.length; unit += 1) starts.push(index)
        value += reference.value
        index += reference.raw.length
        continue
      }
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
  if (end <= start) return null
  return { start, end }
}

function ejsDelimiter(source, offset) {
  if (!Number.isInteger(offset) || offset < 0) return false
  if (source[offset] === '<' && source[offset + 1] === '%') return true
  return source[offset] === '%' && source[offset - 1] === '<'
}

function ejsPieces(raw) {
  const pieces = []
  let cursor = 0
  while (cursor < raw.length) {
    const open = raw.indexOf('<%', cursor)
    if (open === -1) {
      pieces.push({ start: cursor, end: raw.length })
      break
    }
    const close = raw.indexOf('%>', open + 2)
    if (close === -1) {
      pieces.push({ start: cursor, end: raw.length })
      break
    }
    if (open > cursor) pieces.push({ start: cursor, end: open })
    cursor = close + 2
  }
  return pieces
}

function attributeContent(fragment, location) {
  const raw = fragment.slice(location.startOffset, location.endOffset)
  const eq = raw.indexOf('=')
  if (eq < 0) return null
  let cursor = eq + 1
  while (cursor < raw.length && /[ \t\n\r\f]/.test(raw[cursor])) cursor += 1
  if (cursor >= raw.length) return null
  let start = location.startOffset + cursor
  let end = location.endOffset
  const quote = raw[cursor]
  if (quote === '"' || quote === "'") {
    start += 1
    end -= 1
  }
  if (end < start) return null
  return { start, end, raw: fragment.slice(start, end) }
}

function isConstruct(node) {
  const location = node.sourceCodeLocation
  if (!location) return false
  if (node.nodeName === '#text') return !/^\s*$/.test(node.value || '')
  return node.nodeName[0] !== '#'
}

function eachNode(node, visit) {
  visit(node)
  for (const child of node.childNodes || []) eachNode(child, visit)
  if (node.content) eachNode(node.content, visit)
}

function mappedRegion(type, value, decoded, base, bounds, owners, extra) {
  const start = bounds ? bounds.start : 0
  const end = bounds ? bounds.end : decoded.value.length
  return {
    type,
    value: value == null ? decoded.value.slice(start, end) : value,
    start: base + decoded.starts[start],
    end: base + decoded.starts[end],
    sourceOffsets: decoded.starts.map(offset => base + offset),
    owners: owners.slice(),
    ...extra
  }
}

function parse({ source, resource }) {
  const span = templateSpan(source, resource)
  if (span.lang !== 'html') {
    return { constructs: [], comments: [], regions: [], warnings: [] }
  }
  const fragment = source.slice(span.start, span.end)
  const warnings = []
  const fatal = []
  const root = parse5.parseFragment(fragment, {
    sourceCodeLocationInfo: true,
    onParseError(error) {
      if (IGNORED_PARSE_ERRORS.has(error.code)) warnings.push({ code: error.code })
      else if (error.code === 'invalid-first-character-of-tag-name' && ejsDelimiter(fragment, error.startOffset)) {
        warnings.push({ code: error.code })
      } else {
        fatal.push(error)
      }
    }
  })
  if (fatal.length > 0) {
    throw failAt(source, span.start + (fatal[0].startOffset || 0), fatal[0].code || 'HTML parse error')
  }

  const constructs = []
  const comments = []
  const constructIds = new WeakMap()
  function addConstructs(node, parentId = null) {
    const location = node.sourceCodeLocation
    let childParentId = parentId
    if (location && node.nodeName === '#comment') {
      comments.push({
        start: span.start + location.startOffset,
        end: span.start + location.endOffset,
        text: node.data
      })
    } else if (location && isConstruct(node)) {
      const id = constructs.length
      const construct = {
        id,
        kind: node.tagName ? 'element' : 'text',
        name: node.tagName || null,
        parentId,
        start: span.start + location.startOffset,
        end: span.start + location.endOffset
      }
      constructIds.set(node, id)
      constructs.push(construct)
      childParentId = id
    }
    for (const child of node.childNodes || []) addConstructs(child, childParentId)
    if (node.content) addConstructs(node.content, childParentId)
  }
  addConstructs(root)

  const regions = []
  const ownerStack = []

  function addTextRegions(node) {
    const location = node.sourceCodeLocation
    if (!location) throw failAt(source, span.start, 'HTML text location is untrustworthy')
    const raw = fragment.slice(location.startOffset, location.endOffset)
    const decoded = decodeHtmlText(raw)
    if (decoded.value !== node.value) {
      regions.push({
        type: 'text',
        value: node.value,
        start: span.start + location.startOffset,
        end: span.start + location.endOffset,
        sourceOffsets: [],
        owners: ownerStack.slice(),
        untrusted: true
      })
      return
    }
    const pieces = []
    for (const piece of ejsPieces(raw)) pieces.push({ type: 'text', ...piece })
    for (const piece of pieces) {
      if (piece.end <= piece.start) continue
      const pieceRaw = raw.slice(piece.start, piece.end)
      const pieceDecoded = decodeHtmlText(pieceRaw)
      const base = span.start + location.startOffset + piece.start
      const bounds = visibleBounds(pieceDecoded.value)
      if (!bounds) continue
      regions.push(mappedRegion('text', null, pieceDecoded, base, bounds, ownerStack))
    }
  }

  function addAttributeRegions(node) {
    const locations = node.sourceCodeLocation && node.sourceCodeLocation.attrs
    if (!locations) return
    for (const attr of node.attrs || []) {
      const location = locations[attr.name]
      if (!location) continue
      const content = attributeContent(fragment, location)
      if (!content) continue
      const decoded = decodeHtmlText(content.raw)
      if (!content.raw.includes('<%')) {
        if (decoded.value !== attr.value) {
          throw failAt(source, span.start + content.start, 'HTML attribute location is untrustworthy')
        }
      }
      const base = span.start + content.start
      if (content.raw.includes('<%')) {
        for (const piece of ejsPieces(content.raw)) {
          if (piece.end <= piece.start) continue
          const pieceDecoded = decodeHtmlText(content.raw.slice(piece.start, piece.end))
          regions.push(mappedRegion('attribute', null, pieceDecoded, base + piece.start, null, ownerStack, {
            name: attr.name
          }))
        }
        continue
      }
      regions.push(mappedRegion('attribute', attr.value, decoded, base, null, ownerStack, {
        name: attr.name
      }))
    }
  }

  function walk(node) {
    if (node.nodeName === '#text') {
      const id = constructIds.get(node)
      if (id != null) ownerStack.push(id)
      addTextRegions(node)
      if (id != null) ownerStack.pop()
      return
    }
    if (node.nodeName[0] === '#') {
      for (const child of node.childNodes || []) walk(child)
      return
    }
    const id = constructIds.get(node)
    if (id != null) ownerStack.push(id)
    addAttributeRegions(node)
    for (const child of node.childNodes || []) walk(child)
    if (node.content) walk(node.content)
    if (id != null) ownerStack.pop()
  }

  walk(root)
  return { constructs, comments, regions, warnings }
}

module.exports = { parse }
