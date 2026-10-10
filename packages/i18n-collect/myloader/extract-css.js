const postcss = require('postcss')
const { containsHan, offsetToPosition } = require('./resource')

const UNSUPPORTED_STYLE = 'unsupported-style-preprocessor'
const UNARY_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input',
  'isindex', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr'
])

function failAt(source, offset, message) {
  const bounded = Math.max(0, Math.min(offset, source.length))
  const error = new Error(message)
  error.loc = offsetToPosition(source, bounded)
  return error
}

function projectPathOf(resource) {
  return String(resource.projectPath || '').split('\\').join('/')
}

function extensionOf(projectPath) {
  const base = projectPath.split('?')[0].split('#')[0]
  const slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'))
  const name = base.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

function languageOf(value, fallback) {
  if (value == null || value === '') return String(fallback || 'css').toLowerCase()
  return String(value).toLowerCase()
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

function rawClose(source, from, name) {
  const close = new RegExp(`</${name}\\s*>`, 'i')
  const found = close.exec(source.slice(from))
  if (!found) return null
  return { end: from + found.index, next: from + found.index + found[0].length }
}

function styleBlocks(source) {
  const blocks = []
  let cursor = 0
  let depth = 0
  while (cursor < source.length) {
    if (depth === 0 && source.startsWith('<!--', cursor)) {
      const end = source.indexOf('-->', cursor + 4)
      cursor = end === -1 ? source.length : end + 3
      continue
    }
    if (source[cursor] !== '<') {
      cursor += 1
      continue
    }
    const tag = scanTag(source, cursor)
    if (!tag) {
      cursor += 1
      continue
    }
    const name = tag.name.toLowerCase()
    if (tag.closing) {
      if (depth > 0) depth -= 1
      cursor = tag.tagEnd
      continue
    }
    if (depth === 0 && (name === 'script' || name === 'style')) {
      const closed = tag.selfClosing
        ? { end: tag.tagEnd, next: tag.tagEnd }
        : rawClose(source, tag.tagEnd, name)
      if (!closed) throw failAt(source, tag.tagStart, 'Vue style block could not be located')
      if (name === 'style') {
        blocks.push({
          start: tag.tagEnd,
          end: closed.end,
          lang: languageOf(attributeValue(tag.attrs, 'lang'), 'css'),
          src: attributeValue(tag.attrs, 'src')
        })
      }
      cursor = closed.next
      continue
    }
    if (!tag.selfClosing && !UNARY_TAGS.has(name)) depth += 1
    cursor = tag.tagEnd
  }
  return blocks
}

function locate(source, resource) {
  const projectPath = projectPathOf(resource)
  if (!projectPath.toLowerCase().endsWith('.vue')) {
    return {
      start: 0,
      end: source.length,
      lang: languageOf(resource.lang, 'css'),
      src: null
    }
  }
  const index = Number.isInteger(resource.styleIndex) ? resource.styleIndex : 0
  const block = styleBlocks(source)[index]
  if (!block) throw failAt(source, 0, 'Vue style block could not be located')
  return block
}

function configuredExtensions(config) {
  const values = config && Array.isArray(config.styleExtensions) ? config.styleExtensions : ['.css']
  return new Set(values.map(value => String(value).toLowerCase()))
}

function parsesAsStandardCss(resource, located, config) {
  const requested = languageOf(resource.lang, 'css')
  const effective = languageOf(located.lang, requested)
  if (requested !== 'css' || effective !== 'css') return false
  const extension = extensionOf(projectPathOf(resource))
  if (extension === '.vue' || extension === '.css' || extension === '') return true
  return !configuredExtensions(config).has(extension)
}

function unsupportedWarning(resource, lang) {
  const identity = resource.identity ||
    `${projectPathOf(resource)}::style[index=${resource.styleIndex == null ? 0 : resource.styleIndex};lang=${lang}]`
  return {
    code: UNSUPPORTED_STYLE,
    identity,
    message: `i18n-collect does not parse ${lang} styles (${identity}); CSS content was not collected`
  }
}

function offsetFromPostcss(css, line, column) {
  const lines = css.split('\n')
  let offset = 0
  const last = Math.min(Math.max(line, 1), lines.length) - 1
  for (let index = 0; index < last; index += 1) offset += lines[index].length + 1
  return offset + Math.max(0, column - 1)
}

function cssError(error, source, origin, css) {
  if (!error || error.name !== 'CssSyntaxError') throw error
  const offset = offsetFromPostcss(css, error.line || 1, error.column || 1)
  throw failAt(source, origin + offset, error.reason || error.message)
}

function declarationValue(css, decl) {
  const start = decl.source.start.offset
  const end = decl.source.end.offset + 1
  const text = css.slice(start, Math.max(start, end))
  let index = 0
  let depth = 0
  while (index < text.length) {
    if (text[index] === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2)
      index = close === -1 ? text.length : close + 2
      continue
    }
    const char = text[index]
    if (char === '(') depth += 1
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (char === ':' && depth === 0) {
      return { offset: start + index + 1, text: text.slice(index + 1) }
    }
    index += 1
  }
  return { offset: end, text: '' }
}

function isNoneOrNormal(value) {
  const compact = value.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  return /^(none|normal)$/i.test(compact)
}

function isNewline(source, index) {
  const char = source[index]
  return char === '\n' || char === '\r' || char === '\f'
}

function skipNewline(source, index) {
  if (source[index] === '\r' && source[index + 1] === '\n') return index + 2
  return index + 1
}

function decodeCodePoint(code) {
  if (!Number.isFinite(code) || code === 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) {
    return '\uFFFD'
  }
  return String.fromCodePoint(code)
}

function consumeEscape(source, backslash) {
  const next = backslash + 1
  if (next >= source.length) return { value: '\uFFFD', next }
  if (isNewline(source, next)) return { value: '', next: skipNewline(source, next) }
  const hex = /^[0-9a-fA-F]{1,6}/.exec(source.slice(next))
  if (hex) {
    let cursor = next + hex[0].length
    if (cursor < source.length && isNewline(source, cursor)) cursor = skipNewline(source, cursor)
    else if (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1
    return { value: decodeCodePoint(parseInt(hex[0], 16)), next: cursor }
  }
  return { value: source[next], next: next + 1 }
}

function readString(source, quoteIndex) {
  const quote = source[quoteIndex]
  let index = quoteIndex + 1
  let value = ''
  const start = index
  while (index < source.length) {
    const char = source[index]
    if (char === quote) return { value, start, end: index, next: index + 1 }
    if (char === '\\') {
      const escaped = consumeEscape(source, index)
      value += escaped.value
      index = escaped.next
      continue
    }
    value += char
    index += 1
  }
  return { value, start, end: source.length, next: source.length }
}

function scanStrings(value) {
  const found = []
  let index = 0
  let depth = 0
  while (index < value.length) {
    if (value[index] === '/' && value[index + 1] === '*') {
      const close = value.indexOf('*/', index + 2)
      index = close === -1 ? value.length : close + 2
      continue
    }
    const char = value[index]
    if (char === '"' || char === "'") {
      const parsed = readString(value, index)
      found.push(parsed)
      index = parsed.next
      continue
    }
    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)
    index += 1
  }
  return found
}

function extractCss({ source, resource, config }) {
  if (typeof source !== 'string') throw new TypeError('CSS extractor requires source text')
  if (!resource || typeof resource.projectPath !== 'string' || !resource.projectPath) {
    throw new TypeError('CSS extractor requires a project path')
  }
  const located = locate(source, resource)
  if (!parsesAsStandardCss(resource, located, config)) {
    const requested = languageOf(resource.lang, 'css')
    const effective = languageOf(located.lang, requested)
    const lang = requested !== 'css' ? requested : effective
    return { entries: [], warnings: [unsupportedWarning(resource, lang)] }
  }
  if (located.src != null) return { entries: [], warnings: [] }
  const css = source.slice(located.start, located.end)
  let root
  try {
    root = postcss.parse(css)
  } catch (error) {
    throw cssError(error, source, located.start, css)
  }
  const projectPath = projectPathOf(resource)
  const entries = []
  root.walkDecls(decl => {
    if (String(decl.prop).toLowerCase() !== 'content') return
    if (!decl.source || !decl.source.start || !decl.source.end) return
    const value = declarationValue(css, decl)
    if (isNoneOrNormal(value.text)) return
    for (const string of scanStrings(value.text)) {
      if (!string.value.trim() || !containsHan(string.value)) continue
      const start = located.start + value.offset + string.start
      const end = located.start + value.offset + string.end
      entries.push({
        value: string.value,
        locations: [{
          path: projectPath,
          kind: 'css-generated-content',
          start: offsetToPosition(source, start),
          end: offsetToPosition(source, end)
        }]
      })
    }
  })
  return { entries, warnings: [] }
}

module.exports = { extractCss, UNSUPPORTED_STYLE }
