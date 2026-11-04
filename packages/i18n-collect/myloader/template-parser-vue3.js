const { offsetToPosition } = require('./resource')

const SELF_CLOSING_WARNING = 'non-void-html-element-start-tag-with-trailing-solidus'

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

function diagnosticOffset(diagnostic) {
  if (diagnostic && diagnostic.loc) {
    if (Number.isInteger(diagnostic.loc.offset)) return diagnostic.loc.offset
    if (diagnostic.loc.start && Number.isInteger(diagnostic.loc.start.offset)) {
      return diagnostic.loc.start.offset
    }
  }
  return 0
}

function diagnosticMessage(diagnostic) {
  const message = diagnostic && diagnostic.message ? diagnostic.message : String(diagnostic)
  if (/duplicate attribute/i.test(message)) return 'duplicate-attribute'
  return message
}

function templateSpan(source, resource, compilerSfc) {
  const lang = requestedLang(resource)
  if (!resource.projectPath.toLowerCase().endsWith('.vue')) {
    return { start: 0, end: source.length, lang }
  }
  const parsed = compilerSfc.parse(source, {
    filename: resource.absolutePath || resource.projectPath,
    sourceMap: false
  })
  if (parsed.errors.length > 0) {
    const diagnostic = parsed.errors[0]
    throw failAt(source, diagnosticOffset(diagnostic), diagnosticMessage(diagnostic))
  }
  const block = parsed.descriptor.template
  if (!block || block.src) {
    throw failAt(source, 0, 'Vue template block could not be located')
  }
  return {
    start: block.loc.start.offset,
    end: block.loc.end.offset,
    lang: String(block.lang || 'html').toLowerCase()
  }
}

function identityStarts(length) {
  return Array.from({ length: length + 1 }, (_, index) => index)
}

function referenceValue(raw, compilerDom, cache) {
  if (cache.has(raw)) return cache.get(raw)
  const parsed = compilerDom.parse(`<p>${raw}</p>`, {
    onError() {}
  })
  const element = parsed.children.find(node => node.type === 1)
  const text = element && element.children.find(node => node.type === 2)
  const value = text ? text.content : raw
  cache.set(raw, value)
  return value
}

function readReference(raw, index, compilerDom, cache) {
  if (raw[index] !== '&') return null
  const match = /^(?:&#[0-9]+;|&#x[0-9a-fA-F]+;|&[A-Za-z][A-Za-z0-9]*;)/.exec(raw.slice(index))
  if (!match) return null
  const value = referenceValue(match[0], compilerDom, cache)
  return value === match[0] ? null : { raw: match[0], value }
}

function decodeHtml(raw, compilerDom, cache) {
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
    const reference = readReference(raw, index, compilerDom, cache)
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

function openingTagEnd(source) {
  let quote = null
  for (let index = 0; index < source.length; index += 1) {
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

function attributeContent(fragment, location) {
  const raw = fragment.slice(location.start.offset, location.end.offset)
  const eq = raw.indexOf('=')
  if (eq < 0) return null
  let cursor = eq + 1
  while (cursor < raw.length && /[ \t\n\r\f]/.test(raw[cursor])) cursor += 1
  if (cursor >= raw.length) return null
  let start = location.start.offset + cursor
  let end = location.end.offset
  const quote = raw[cursor]
  if (quote === '"' || quote === "'") {
    start += 1
    end -= 1
  }
  return end < start ? null : {
    start,
    end,
    raw: fragment.slice(start, end),
    name: raw.slice(0, eq).trim()
  }
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

function parse({ source, resource, compilerSfc, compilerDom }) {
  const span = templateSpan(source, resource, compilerSfc)
  if (span.lang !== 'html') {
    return { constructs: [], comments: [], regions: [], warnings: [] }
  }
  const fragment = source.slice(span.start, span.end)
  const diagnostics = []
  const root = compilerDom.parse(fragment, {
    comments: true,
    onError(error) {
      diagnostics.push(error)
    }
  })
  if (diagnostics.length > 0) {
    const diagnostic = diagnostics[0]
    throw failAt(
      source,
      span.start + diagnosticOffset(diagnostic),
      diagnosticMessage(diagnostic)
    )
  }

  const constructs = []
  const comments = []
  const regions = []
  const warnings = []
  const ids = new WeakMap()
  const references = new Map()

  function isConstruct(node) {
    if (!node || node === root || node.type === 3) return false
    if (node.type === 1 || node.type === 5) return true
    return node.type === 2 && !/^\s*$/.test(node.content)
  }

  function visit(node) {
    if (node.type === 3) {
      comments.push({
        start: span.start + node.loc.start.offset,
        end: span.start + node.loc.end.offset,
        text: node.content
      })
    } else if (isConstruct(node)) {
      ids.set(node, constructs.length)
      constructs.push({
        id: constructs.length,
        start: span.start + node.loc.start.offset,
        end: span.start + node.loc.end.offset
      })
    }
    for (const child of node.children || []) visit(child)
  }
  visit(root)

  const owners = []

  function addText(node) {
    const raw = fragment.slice(node.loc.start.offset, node.loc.end.offset)
    const decoded = decodeHtml(raw, compilerDom, references)
    const bounds = visibleBounds(decoded.value)
    if (bounds) {
      regions.push(mappedRegion(
        'text',
        decoded,
        span.start + node.loc.start.offset,
        bounds,
        owners
      ))
    }
  }

  function addInterpolation(node) {
    const start = node.loc.start.offset + 2
    const end = node.loc.end.offset - 2
    const decoded = decodeHtml(fragment.slice(start, end), compilerDom, references)
    regions.push(mappedRegion('expression', decoded, span.start + start, null, owners, {
      expressionKind: 'template-expression'
    }))
  }

  function addAttributes(node) {
    for (const prop of node.props || []) {
      const content = attributeContent(fragment, prop.loc)
      if (!content) continue
      const decoded = decodeHtml(content.raw, compilerDom, references)
      regions.push(mappedRegion('attribute', decoded, span.start + content.start, null, owners, {
        name: content.name
      }))
    }
  }

  function walk(node) {
    if (node.type === 3) return
    const id = ids.get(node)
    if (id != null) owners.push(id)
    if (node.type === 1) {
      addAttributes(node)
      const openingEnd = openingTagEnd(node.loc.source)
      if (openingEnd > 0 && /\/\s*>$/.test(node.loc.source.slice(0, openingEnd))) {
        warnings.push({ code: SELF_CLOSING_WARNING })
      }
      for (const child of node.children || []) walk(child)
    } else if (node.type === 2) {
      addText(node)
    } else if (node.type === 5) {
      addInterpolation(node)
    } else {
      for (const child of node.children || []) walk(child)
    }
    if (id != null) owners.pop()
  }
  walk(root)

  return { constructs, comments, regions, warnings }
}

module.exports = { parse }
