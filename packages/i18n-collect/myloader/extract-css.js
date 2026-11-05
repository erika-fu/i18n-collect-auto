const { collectStyle } = require('./collect-style')
const { offsetToPosition } = require('./resource')
const { parseCssStyle } = require('./style-parser-css')

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
  let style
  try {
    style = parseCssStyle(css, located.start)
  } catch (error) {
    throw cssError(error, source, located.start, css)
  }
  const projectPath = projectPathOf(resource)
  return collectStyle({ source, projectPath, style })
}

module.exports = { extractCss, UNSUPPORTED_STYLE }
