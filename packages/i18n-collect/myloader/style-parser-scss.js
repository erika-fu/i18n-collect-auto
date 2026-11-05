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

function syntaxError(source, offset, message) {
  const error = new Error(message)
  error.name = 'ScssSyntaxError'
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

function skipString(source, start, limit) {
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
  throw syntaxError(source, start, 'Unclosed string')
}

function topLevelColon(source, start, end) {
  let cursor = start
  let round = 0
  let square = 0
  let interpolation = 0
  while (cursor < end) {
    const char = source[cursor]
    if (char === '"' || char === "'") {
      cursor = skipString(source, cursor, end).next
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

function directTokens(source, start, end) {
  const scanned = scanStyleValue(source, start, end)
  const computed = new Set()
  let cursor = start
  let interpolation = 0
  while (cursor < end) {
    const char = source[cursor]
    if (char === '/' && (source[cursor + 1] === '*' || source[cursor + 1] === '/')) {
      cursor = readComment(source, cursor, end).next
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
      const string = skipString(source, cursor, end)
      if (interpolation > 0 || string.interpolated) computed.add(cursor)
      cursor = string.next
      continue
    }
    cursor += 1
  }
  return {
    comments: scanned.comments,
    tokens: scanned.tokens.map(token => {
      return computed.has(token.quoteStart) ? { ...token, type: 'computed' } : token
    })
  }
}

function atRuleName(header) {
  const match = /^\s*@([\w-]+)/.exec(header)
  return match ? match[1].toLowerCase() : null
}

function declarationStart(source, start, end) {
  let cursor = start
  while (cursor < end) {
    if (/\s/.test(source[cursor])) {
      cursor += 1
      continue
    }
    if (source[cursor] === '/' && (source[cursor + 1] === '*' || source[cursor + 1] === '/')) {
      cursor = readComment(source, cursor, end).next
      continue
    }
    break
  }
  return cursor
}

function parseScssStyle(source, origin = 0) {
  const declarations = []
  const comments = []

  function parseContainer(start, limit, computed, expectsClose) {
    let statementStart = start
    let cursor = start
    let round = 0
    let square = 0
    let interpolation = 0

    const addDeclaration = end => {
      const start = declarationStart(source, statementStart, end)
      const colon = topLevelColon(source, start, end)
      if (colon === -1 || computed) return
      const property = source.slice(start, colon).trim()
      if (!property || property.startsWith('$') || property.startsWith('@')) return
      const value = directTokens(source, colon + 1, end)
      declarations.push({
        property,
        start: origin + start,
        value: {
          start: origin + colon + 1,
          end: origin + end,
          comments: value.comments.map(comment => ({
            ...comment,
            start: origin + comment.start,
            end: origin + comment.end
          })),
          tokens: value.tokens.map(token => ({
            ...token,
            quoteStart: origin + token.quoteStart,
            start: origin + token.start,
            end: origin + token.end
          }))
        }
      })
    }

    while (cursor < limit) {
      const char = source[cursor]
      if (char === '"' || char === "'") {
        cursor = skipString(source, cursor, limit).next
        continue
      }
      if (char === '/' && (source[cursor + 1] === '*' || source[cursor + 1] === '/')) {
        const parsed = readComment(source, cursor, limit)
        comments.push(parsed.comment)
        cursor = parsed.next
        continue
      }
      if (char === '#' && source[cursor + 1] === '{') {
        interpolation += 1
        cursor += 2
        continue
      }
      if (char === '}' && interpolation > 0) {
        interpolation -= 1
        cursor += 1
        continue
      }
      if (char === '(') round += 1
      else if (char === ')') {
        round -= 1
        if (round < 0) throw syntaxError(source, cursor, 'Unexpected closing parenthesis')
      } else if (char === '[') square += 1
      else if (char === ']') {
        square -= 1
        if (square < 0) throw syntaxError(source, cursor, 'Unexpected closing bracket')
      } else if (round === 0 && square === 0 && interpolation === 0 && char === '{') {
        const header = source.slice(statementStart, cursor)
        const name = atRuleName(header)
        const blockComputed = computed || (name != null && COMPUTED_AT_RULES.has(name))
        cursor = parseContainer(cursor + 1, limit, blockComputed, true)
        statementStart = cursor
        continue
      } else if (round === 0 && square === 0 && interpolation === 0 && char === ';') {
        addDeclaration(cursor)
        statementStart = cursor + 1
      } else if (round === 0 && square === 0 && interpolation === 0 && char === '}') {
        if (!expectsClose) throw syntaxError(source, cursor, 'Unexpected closing brace')
        addDeclaration(cursor)
        return cursor + 1
      }
      cursor += 1
    }

    if (expectsClose) throw syntaxError(source, Math.max(start - 1, 0), 'Unclosed block')
    if (round > 0) throw syntaxError(source, limit, 'Unclosed parenthesis')
    if (square > 0) throw syntaxError(source, limit, 'Unclosed bracket')
    if (interpolation > 0) throw syntaxError(source, limit, 'Unclosed interpolation')
    addDeclaration(limit)
    return limit
  }

  parseContainer(0, source.length, false, false)
  return {
    comments: comments.map(comment => ({
      ...comment,
      start: origin + comment.start,
      end: origin + comment.end
    })),
    declarations,
    warnings: []
  }
}

module.exports = { parseScssStyle }
