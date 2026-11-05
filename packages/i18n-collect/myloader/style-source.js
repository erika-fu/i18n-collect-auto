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

function consumeEscape(source, backslash, decode) {
  const next = backslash + 1
  if (next >= source.length) return { value: decode ? '\uFFFD' : '', next }
  if (isNewline(source, next)) return { value: '', next: skipNewline(source, next) }
  const hex = /^[0-9a-fA-F]{1,6}/.exec(source.slice(next))
  if (hex) {
    let cursor = next + hex[0].length
    if (cursor < source.length && isNewline(source, cursor)) cursor = skipNewline(source, cursor)
    else if (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1
    return {
      value: decode ? decodeCodePoint(parseInt(hex[0], 16)) : '',
      next: cursor
    }
  }
  return { value: decode ? source[next] : '', next: next + 1 }
}

function readStringToken(source, quoteStart, limit) {
  const quote = source[quoteStart]
  let index = quoteStart + 1
  while (index < limit) {
    if (source[index] === quote) {
      return {
        type: 'static-string',
        quoteStart,
        start: quoteStart + 1,
        end: index
      }
    }
    if (source[index] === '\\') {
      index = consumeEscape(source, index, false).next
      continue
    }
    index += 1
  }
  return {
    type: 'static-string',
    quoteStart,
    start: quoteStart + 1,
    end: limit
  }
}

function scanStyleValue(source, start, end) {
  const tokens = []
  const comments = []
  let index = start
  while (index < end) {
    if (source[index] === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2)
      if (close === -1 || close >= end) break
      comments.push({ start: index, end: close + 2, text: source.slice(index + 2, close) })
      index = close + 2
      continue
    }
    if (source[index] === '"' || source[index] === "'") {
      const token = readStringToken(source, index, end)
      tokens.push(token)
      index = token.end < end ? token.end + 1 : end
      continue
    }
    index += 1
  }
  return { tokens, comments }
}

function decodeStyleString(source, start, end) {
  let value = ''
  let index = start
  while (index < end) {
    if (source[index] === '\\') {
      const escaped = consumeEscape(source, index, true)
      value += escaped.value
      index = escaped.next
      continue
    }
    value += source[index]
    index += 1
  }
  return value
}

module.exports = { decodeStyleString, scanStyleValue }
