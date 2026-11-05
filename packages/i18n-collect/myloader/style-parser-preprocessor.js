const { scanStyleValue } = require('./style-source')

const COMPUTED_AT_RULES = new Set([
  'at-root',
  'content',
  'each',
  'else',
  'for',
  'function',
  'if',
  'include',
  'mixin',
  'use',
  'while'
])

function syntaxError(source, offset, message, name = 'ScssSyntaxError') {
  const error = new Error(message)
  error.name = name
  error.offset = Math.max(0, Math.min(offset, source.length))
  return error
}

function readComment(source, start, limit) {
  if (source[start + 1] === '*') {
    const close = source.indexOf('*/', start + 2)
    if (close === -1 || close + 2 > limit) {
      throw syntaxError(source, start, 'Unclosed comment')
    }
    return {
      comment: { start, end: close + 2, text: source.slice(start + 2, close) },
      next: close + 2
    }
  }
  let end = start + 2
  while (end < limit && source[end] !== '\n' && source[end] !== '\r') end += 1
  return {
    comment: { start, end, text: source.slice(start + 2, end) },
    next: end
  }
}

function skipString(source, start, limit, errorName) {
  const quote = source[start]
  let cursor = start + 1
  let interpolated = false
  while (cursor < limit) {
    if (source[cursor] === '\\') {
      cursor += source[cursor + 1] === '\r' && source[cursor + 2] === '\n' ? 3 : 2
      continue
    }
    if (source[cursor] === '#' && source[cursor + 1] === '{') interpolated = true
    if (source[cursor] === quote) return { next: cursor + 1, interpolated }
    cursor += 1
  }
  throw syntaxError(source, start, 'Unclosed string', errorName)
}

function topLevelColon(source, start, end, errorName) {
  let cursor = start
  let round = 0
  let square = 0
  let interpolation = 0
  while (cursor < end) {
    const char = source[cursor]
    if (char === '"' || char === "'") {
      cursor = skipString(source, cursor, end, errorName).next
      continue
    }
    if (char === '/' && (source[cursor + 1] === '*' || source[cursor + 1] === '/')) {
      cursor = readComment(source, cursor, end).next
      continue
    }
    if (char === '#' && source[cursor + 1] === '{') {
      interpolation += 1
      cursor += 2
      continue
    }
    if (char === '}' && interpolation > 0) interpolation -= 1
    else if (char === '(') round += 1
    else if (char === ')') round -= 1
    else if (char === '[') square += 1
    else if (char === ']') square -= 1
    else if (char === ':' && round === 0 && square === 0 && interpolation === 0) return cursor
    cursor += 1
  }
  return -1
}

function directTokens(source, start, end, errorName) {
  const scanned = scanStyleValue(source, start, end)
  const computed = new Set()
  const comments = []
  let cursor = start
  let interpolation = 0
  while (cursor < end) {
    const char = source[cursor]
    if (char === '/' && (source[cursor + 1] === '*' || source[cursor + 1] === '/')) {
      const parsed = readComment(source, cursor, end)
      comments.push(parsed.comment)
      cursor = parsed.next
      continue
    }
    if (char === '#' && source[cursor + 1] === '{') {
      interpolation += 1
      cursor += 2
      continue
    }
    if (char === '{' && interpolation > 0) {
      interpolation += 1
      cursor += 1
      continue
    }
    if (char === '}' && interpolation > 0) {
      interpolation -= 1
      cursor += 1
      continue
    }
    if (char === '"' || char === "'") {
      const string = skipString(source, cursor, end, errorName)
      if (interpolation > 0 || string.interpolated) computed.add(cursor)
      cursor = string.next
      continue
    }
    cursor += 1
  }
  return {
    comments,
    tokens: scanned.tokens
      .filter(token => !comments.some(comment => (
        token.quoteStart >= comment.start && token.quoteStart < comment.end
      )))
      .map(token => computed.has(token.quoteStart) ? { ...token, type: 'computed' } : token)
  }
}

function atRuleName(header) {
  const match = /^\s*@([\w-]+)/.exec(header)
  return match ? match[1].toLowerCase() : null
}

module.exports = {
  COMPUTED_AT_RULES,
  atRuleName,
  directTokens,
  readComment,
  skipString,
  syntaxError,
  topLevelColon
}
