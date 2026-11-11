const { collectStyle } = require('./collect-style')
const { offsetToPosition, containsHan } = require('./resource')
const { parseCssStyle } = require('./style-parser-css')
const { decodeStyleString, scanStyleValue } = require('./style-source')
const { directivesBefore, scanDirectives, whitespaceGap } = require('./directives')

const UNARY_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input',
  'isindex', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr'
])

const PREPROCESSOR_LANGS = new Set(['scss', 'sass', 'less', 'styl', 'stylus'])

function failAt(source, offset, message) {
  const bounded = Math.max(0, Math.min(offset, source.length))
  const error = new Error(message)
  error.loc = offsetToPosition(source, bounded)
  return error
}

function projectPathOf(resource) {
  return String(resource.projectPath || '').split('\\').join('/')
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

function offsetFromPostcss(css, line, column) {
  const lines = css.split('\n')
  let offset = 0
  const last = Math.min(Math.max(line, 1), lines.length) - 1
  for (let index = 0; index < last; index += 1) offset += lines[index].length + 1
  return offset + Math.max(0, column - 1)
}

function locateBlocks(source, resource) {
  const projectPath = projectPathOf(resource)
  if (!projectPath.toLowerCase().endsWith('.vue')) {
    return [{
      start: 0,
      end: source.length,
      lang: languageOf(resource.lang, 'css'),
      src: null
    }]
  }
  if (Number.isInteger(resource.styleIndex)) {
    const block = styleBlocks(source)[resource.styleIndex]
    return block ? [block] : []
  }
  return styleBlocks(source)
}

function isPreprocessor(lang) {
  return PREPROCESSOR_LANGS.has(languageOf(lang, 'css'))
}

function skipLineComment(source, index, end) {
  let cursor = index + 2
  while (cursor < end && source[cursor] !== '\n' && source[cursor] !== '\r') cursor += 1
  return cursor
}

function skipBlockComment(source, index, end) {
  const close = source.indexOf('*/', index + 2)
  if (close === -1 || close >= end) return end
  return close + 2
}

function collectBlockComments(source, start, end) {
  const comments = []
  let index = start
  while (index < end) {
    if (source[index] === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2)
      if (close === -1 || close >= end) break
      comments.push({
        start: index,
        end: close + 2,
        text: source.slice(index + 2, close)
      })
      index = close + 2
      continue
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index, end)
      continue
    }
    if (source[index] === '"' || source[index] === "'") {
      const token = scanStyleValue(source, index, end).tokens[0]
      index = token && token.end < end ? token.end + 1 : end
      continue
    }
    index += 1
  }
  return comments
}

function findContentRegions(source, start, end) {
  const regions = []
  let index = start
  while (index < end) {
    if (source[index] === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index, end)
      continue
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index, end)
      continue
    }
    if (source[index] === '"' || source[index] === "'") {
      const scanned = scanStyleValue(source, index, end)
      const token = scanned.tokens[0]
      index = token && token.end < end ? token.end + 1 : end
      continue
    }
    if ((source[index] === 'c' || source[index] === 'C') &&
        /^content\s*:/i.test(source.slice(index, Math.min(end, index + 32)))) {
      const match = /^content\s*:/i.exec(source.slice(index))
      if (!match || (index > start && /[A-Za-z0-9_-]/.test(source[index - 1] || ''))) {
        index += 1
        continue
      }
      const valueStart = index + match[0].length
      let cursor = valueStart
      let depth = 0
      while (cursor < end) {
        if (source[cursor] === '/' && source[cursor + 1] === '*') {
          cursor = skipBlockComment(source, cursor, end)
          continue
        }
        if (source[cursor] === '/' && source[cursor + 1] === '/') {
          cursor = skipLineComment(source, cursor, end)
          continue
        }
        if (source[cursor] === '"' || source[cursor] === "'") {
          const scanned = scanStyleValue(source, cursor, end)
          const token = scanned.tokens[0]
          cursor = token && token.end < end ? token.end + 1 : end
          continue
        }
        const char = source[cursor]
        if (char === '(') depth += 1
        else if (char === ')') depth = Math.max(0, depth - 1)
        else if ((char === ';' || char === '}') && depth === 0) break
        cursor += 1
      }
      regions.push({
        propertyStart: index,
        valueStart,
        valueEnd: cursor
      })
      index = cursor
      continue
    }
    index += 1
  }
  return regions
}

function auditPreprocessorBlock(source, projectPath, block) {
  const fail = (offset, message) => {
    throw failAt(source, offset, message)
  }
  const comments = collectBlockComments(source, block.start, block.end)
  const directives = scanDirectives(comments, fail)
  const usedIgnoreStarts = new Set()
  const entries = []
  const regions = findContentRegions(source, block.start, block.end)

  for (const region of regions) {
    const inherited = directivesBefore(source, directives, region.propertyStart, fail)
    const scanned = scanStyleValue(source, region.valueStart, region.valueEnd)
    const valueDirectives = scanDirectives(scanned.comments, fail)
    const strings = scanned.tokens
      .filter(token => token.type === 'static-string')
      .map(token => ({
        token,
        value: decodeStyleString(source, token.start, token.end)
      }))
      .filter(item => item.value.trim() && containsHan(item.value))

    function markIgnoreUsed(list, constructStart) {
      let cursor = constructStart
      for (;;) {
        const found = list.find(
          directive => directive.ignoreReason && whitespaceGap(source, directive.end, cursor)
        )
        if (!found) break
        usedIgnoreStarts.add(found.start)
        cursor = found.start
      }
    }

    strings.forEach((item, index) => {
      const own = directivesBefore(source, valueDirectives, item.token.quoteStart, fail)
      const declarationDirective = index === 0
        ? inherited
        : { exclude: false, key: null, ignoreReason: null }
      if (own.exclude || declarationDirective.exclude) return
      const ignoreReason = own.ignoreReason || declarationDirective.ignoreReason || null
      if (ignoreReason) {
        markIgnoreUsed(valueDirectives, item.token.quoteStart)
        if (index === 0) markIgnoreUsed(directives, region.propertyStart)
      }
      const location = {
        path: projectPath,
        kind: 'css-preprocessor-candidate',
        start: offsetToPosition(source, item.token.start),
        end: offsetToPosition(source, item.token.end)
      }
      const entry = { value: item.value, locations: [location] }
      if (ignoreReason) entry.ignoreReason = ignoreReason
      entries.push(entry)
    })
  }

  for (const directive of directives) {
    if (!directive.ignoreReason) continue
    if (usedIgnoreStarts.has(directive.start)) continue
    fail(
      directive.start,
      `unused i18n-ignore directive "${directive.ignoreReason}": no associated style finding`
    )
  }

  return entries
}

function auditCssBlock(source, projectPath, block) {
  const css = source.slice(block.start, block.end)
  let style
  try {
    style = parseCssStyle(css, block.start)
  } catch (error) {
    if (!error || error.name !== 'CssSyntaxError') throw error
    const offset = offsetFromPostcss(css, error.line || 1, error.column || 1)
    throw failAt(source, block.start + offset, error.reason || error.message)
  }
  return collectStyle({ source, projectPath, style, audit: true }).entries
}

function auditBlock(source, projectPath, block) {
  if (block.src != null) return []
  const lang = languageOf(block.lang, 'css')
  if (isPreprocessor(lang)) return auditPreprocessorBlock(source, projectPath, block)
  return auditCssBlock(source, projectPath, block)
}

function auditStyle({ source, resource, config }) {
  if (typeof source !== 'string') throw new TypeError('Style audit requires source text')
  if (!resource || typeof resource.projectPath !== 'string' || !resource.projectPath) {
    throw new TypeError('Style audit requires a project path')
  }
  void config
  const projectPath = projectPathOf(resource)
  const blocks = locateBlocks(source, resource)
  const entries = []
  for (const block of blocks) {
    entries.push(...auditBlock(source, projectPath, block))
  }
  return { entries, warnings: [] }
}

module.exports = {
  auditStyle,
  PREPROCESSOR_REVIEW_KIND: 'css-preprocessor-candidate'
}
