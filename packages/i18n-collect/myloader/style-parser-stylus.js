const {
  directTokens,
  readComment,
  syntaxError,
  topLevelColon
} = require('./style-parser-preprocessor')

const ERROR_NAME = 'StylusSyntaxError'

function linesOf(source) {
  const lines = []
  let start = 0
  while (start < source.length) {
    let end = start
    while (end < source.length && source[end] !== '\n' && source[end] !== '\r') end += 1
    lines.push({ start, end })
    if (source[end] === '\r' && source[end + 1] === '\n') end += 1
    start = end + 1
  }
  if (source.length === 0 || source.endsWith('\n') || source.endsWith('\r')) {
    lines.push({ start: source.length, end: source.length })
  }
  return lines
}

function contentStart(source, line) {
  let cursor = line.start
  while (cursor < line.end && (source[cursor] === ' ' || source[cursor] === '\t')) cursor += 1
  return cursor
}

function contentEnd(source, line) {
  let cursor = line.end
  while (cursor > line.start && (source[cursor - 1] === ' ' || source[cursor - 1] === '\t')) cursor -= 1
  if (source[cursor - 1] === ';') cursor -= 1
  return cursor
}

function skipStylusString(source, start) {
  const quote = source[start]
  let cursor = start + 1
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      if (source[cursor + 1] === '\r' && source[cursor + 2] === '\n') cursor += 3
      else cursor += 2
      continue
    }
    if (source[cursor] === quote) return cursor + 1
    if (source[cursor] === '\n' || source[cursor] === '\r') {
      throw syntaxError(source, start, 'Unclosed string', ERROR_NAME)
    }
    cursor += 1
  }
  throw syntaxError(source, start, 'Unclosed string', ERROR_NAME)
}

function lineIndexAt(lines, index, offset) {
  while (index + 1 < lines.length && offset > lines[index].end) index += 1
  return index
}

function logicalStatement(source, lines, firstLine, start) {
  let cursor = start
  let lineIndex = firstLine
  let round = 0
  let square = 0
  let interpolation = 0

  for (;;) {
    let line = lines[lineIndex]
    while (cursor < line.end) {
      const char = source[cursor]
      if (char === '"' || char === "'") {
        cursor = skipStylusString(source, cursor)
        lineIndex = lineIndexAt(lines, lineIndex, cursor)
        line = lines[lineIndex]
        continue
      }
      if (char === '/' && source[cursor + 1] === '*') {
        cursor = readComment(source, cursor, source.length).next
        lineIndex = lineIndexAt(lines, lineIndex, cursor)
        line = lines[lineIndex]
        continue
      }
      if (char === '/' && source[cursor + 1] === '/') {
        cursor = line.end
        continue
      }
      if (char === '{' && /[#A-Za-z_$-]/.test(source[cursor + 1] || '')) {
        interpolation += 1
      } else if (char === '}' && interpolation > 0) {
        interpolation -= 1
      } else if (char === '(') round += 1
      else if (char === ')') {
        if (round === 0) throw syntaxError(source, cursor, 'Unexpected closing parenthesis', ERROR_NAME)
        round -= 1
      } else if (char === '[') square += 1
      else if (char === ']') {
        if (square === 0) throw syntaxError(source, cursor, 'Unexpected closing bracket', ERROR_NAME)
        square -= 1
      } else if (char === '{' || char === '}') {
        throw syntaxError(source, cursor, 'Invalid indented Stylus syntax', ERROR_NAME)
      }
      cursor += 1
    }

    if (round === 0 && square === 0 && interpolation === 0) {
      return { end: contentEnd(source, line), lineIndex }
    }
    lineIndex += 1
    if (lineIndex >= lines.length) {
      throw syntaxError(
        source,
        source.length,
        round > 0
          ? 'Unclosed parenthesis'
          : square > 0
            ? 'Unclosed bracket'
            : 'Unclosed interpolation',
        ERROR_NAME
      )
    }
    cursor = lines[lineIndex].start
  }
}

function computedBlock(header) {
  const trimmed = header.trim()
  if (/^(?:if|unless|for|each|while)\b/.test(trimmed)) return true
  if (/^@(?:import|require|extend|block|media|supports|keyframes)\b/i.test(trimmed)) return true
  return /^[A-Za-z_$][\w$-]*\s*\([^)]*\)\s*$/.test(trimmed)
}

function colonlessDeclaration(source, start, end) {
  const match = /^([-\w]+)(\s+)/.exec(source.slice(start, end))
  if (!match) return null
  const valueStart = start + match[0].length
  if (source[valueStart] === '=' || source[valueStart] === ':') return null
  return { property: match[1], valueStart }
}

function declarationOf(source, start, end) {
  const colon = topLevelColon(source, start, end, ERROR_NAME)
  if (colon !== -1) {
    const property = source.slice(start, colon).trim()
    if (!property || !/^[-\w]+$/.test(property)) return null
    return { property, valueStart: colon + 1 }
  }
  return colonlessDeclaration(source, start, end)
}

function hasInterpolation(source, token) {
  return /(?:#|\$)?\{[^}]+\}/.test(source.slice(token.start, token.end))
}

function functionArgumentQuotes(source, start, end) {
  const computed = new Set()
  const calls = []
  let cursor = start
  while (cursor < end) {
    const char = source[cursor]
    if (char === '"' || char === "'") {
      const quoteStart = cursor
      cursor = skipStylusString(source, cursor)
      if (calls.some(Boolean)) computed.add(quoteStart)
      continue
    }
    if (char === '/' && (source[cursor + 1] === '*' || source[cursor + 1] === '/')) {
      cursor = readComment(source, cursor, end).next
      continue
    }
    if (char === '(') {
      let previous = cursor - 1
      while (previous >= start && /\s/.test(source[previous])) previous -= 1
      calls.push(previous >= start && /[\w)$-]/.test(source[previous]))
    } else if (char === ')' && calls.length) {
      calls.pop()
    }
    cursor += 1
  }
  return computed
}

function stylusTokens(source, start, end) {
  const value = directTokens(source, start, end, ERROR_NAME)
  const computedQuotes = functionArgumentQuotes(source, start, end)
  return {
    comments: value.comments,
    tokens: value.tokens.map(token => (
      computedQuotes.has(token.quoteStart) || hasInterpolation(source, token)
        ? { ...token, type: 'computed' }
        : token
    ))
  }
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

function structuralBraces(source) {
  let cursor = 0
  while (cursor < source.length) {
    if (source[cursor] === '"' || source[cursor] === "'") {
      cursor = skipStylusString(source, cursor)
      continue
    }
    if (source[cursor] === '/' && (source[cursor + 1] === '*' || source[cursor + 1] === '/')) {
      cursor = readComment(source, cursor, source.length).next
      continue
    }
    if (source[cursor] === '{') {
      const close = source.indexOf('}', cursor + 1)
      if (close === -1 || !/^[#A-Za-z_$][\w$.-]*$/.test(source.slice(cursor + 1, close))) {
        return true
      }
    }
    cursor += 1
  }
  return false
}

function parseBracedStyle(source, origin) {
  const declarations = []
  const comments = []

  function parseContainer(start, computed, expectsClose) {
    let statementStart = start
    let cursor = start
    let round = 0
    let square = 0

    const addDeclaration = end => {
      const start = declarationStart(source, statementStart, end)
      const parsed = declarationOf(source, start, end)
      if (!parsed || computed) return
      const value = stylusTokens(source, parsed.valueStart, end)
      declarations.push({
        property: parsed.property,
        start: origin + start,
        value: {
          start: origin + parsed.valueStart,
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

    while (cursor < source.length) {
      const char = source[cursor]
      if (char === '"' || char === "'") {
        cursor = skipStylusString(source, cursor)
        continue
      }
      if (char === '/' && (source[cursor + 1] === '*' || source[cursor + 1] === '/')) {
        const parsed = readComment(source, cursor, source.length)
        comments.push(parsed.comment)
        cursor = parsed.next
        continue
      }
      if (char === '(') round += 1
      else if (char === ')') {
        round -= 1
        if (round < 0) throw syntaxError(source, cursor, 'Unexpected closing parenthesis', ERROR_NAME)
      } else if (char === '[') square += 1
      else if (char === ']') {
        square -= 1
        if (square < 0) throw syntaxError(source, cursor, 'Unexpected closing bracket', ERROR_NAME)
      } else if (round === 0 && square === 0 && char === '{') {
        const close = source.indexOf('}', cursor + 1)
        const interpolation = close !== -1 &&
          /^[#A-Za-z_$][\w$.-]*$/.test(source.slice(cursor + 1, close))
        if (interpolation) {
          cursor = close + 1
          continue
        }
        const header = source.slice(statementStart, cursor)
        cursor = parseContainer(cursor + 1, computed || computedBlock(header), true)
        statementStart = cursor
        continue
      } else if (round === 0 && square === 0 && char === ';') {
        addDeclaration(cursor)
        statementStart = cursor + 1
      } else if (round === 0 && square === 0 && char === '}') {
        if (!expectsClose) throw syntaxError(source, cursor, 'Unexpected closing brace', ERROR_NAME)
        addDeclaration(cursor)
        return cursor + 1
      }
      cursor += 1
    }

    if (expectsClose) throw syntaxError(source, Math.max(start - 1, 0), 'Unclosed block', ERROR_NAME)
    if (round > 0) throw syntaxError(source, source.length, 'Unclosed parenthesis', ERROR_NAME)
    if (square > 0) throw syntaxError(source, source.length, 'Unclosed bracket', ERROR_NAME)
    addDeclaration(source.length)
    return source.length
  }

  parseContainer(0, false, false)
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

function parseStylusStyle(source, origin = 0) {
  if (structuralBraces(source)) return parseBracedStyle(source, origin)

  const declarations = []
  const comments = []
  const ancestors = []
  const lines = linesOf(source)

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const start = contentStart(source, line)
    const physicalEnd = contentEnd(source, line)
    if (start === physicalEnd) continue
    const indent = source.slice(line.start, start)

    while (ancestors.length && indent.length <= ancestors[ancestors.length - 1].indent.length) {
      ancestors.pop()
    }
    const parent = ancestors[ancestors.length - 1]
    if (!parent && indent.length > 0) {
      throw syntaxError(source, start, 'Unexpected indentation', ERROR_NAME)
    }
    if (parent && (
      !indent.startsWith(parent.indent) ||
      (parent.childIndent != null && parent.childIndent !== indent)
    )) {
      throw syntaxError(source, start, 'Inconsistent indentation', ERROR_NAME)
    }
    if (parent && parent.childIndent == null) {
      parent.childIndent = indent
      if (parent.declaration) parent.declaration.omit = true
    }
    const computed = Boolean(parent && parent.computed)
    const physicalHeader = source.slice(start, physicalEnd)

    if (physicalHeader.startsWith('//')) {
      const parsed = readComment(source, start, line.end)
      comments.push(parsed.comment)
      ancestors.push({ indent, childIndent: null, computed: true })
      continue
    }
    if (physicalHeader.startsWith('/*')) {
      const parsed = readComment(source, start, source.length)
      comments.push(parsed.comment)
      lineIndex = lineIndexAt(lines, lineIndex, parsed.next)
      ancestors.push({ indent, childIndent: null, computed: true })
      continue
    }

    const statement = logicalStatement(source, lines, lineIndex, start)
    const end = statement.end
    lineIndex = statement.lineIndex
    const header = source.slice(start, end)
    const parsed = declarationOf(source, start, end)

    if (parsed && !computed) {
      const value = stylusTokens(source, parsed.valueStart, end)
      const declaration = {
        property: parsed.property,
        start: origin + start,
        value: {
          start: origin + parsed.valueStart,
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
      }
      declarations.push(declaration)
      ancestors.push({
        indent,
        childIndent: null,
        computed: computedBlock(header),
        declaration
      })
      continue
    }

    ancestors.push({
      indent,
      childIndent: null,
      computed: computed || computedBlock(header)
    })
  }

  return {
    comments: comments.map(comment => ({
      ...comment,
      start: origin + comment.start,
      end: origin + comment.end
    })),
    declarations: declarations.filter(declaration => !declaration.omit),
    warnings: []
  }
}

module.exports = { parseStylusStyle }
