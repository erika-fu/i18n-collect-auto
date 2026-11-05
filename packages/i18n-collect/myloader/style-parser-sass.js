const {
  COMPUTED_AT_RULES,
  atRuleName,
  directTokens,
  readComment,
  syntaxError,
  topLevelColon
} = require('./style-parser-preprocessor')

const ERROR_NAME = 'SassSyntaxError'

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
  return cursor
}

function computedBlock(header) {
  if (header.startsWith('=')) return true
  const name = atRuleName(header)
  return name != null && COMPUTED_AT_RULES.has(name)
}

function skipSassString(source, start) {
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
        cursor = skipSassString(source, cursor)
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
      if (char === '#' && source[cursor + 1] === '{') {
        interpolation += 1
        cursor += 2
        continue
      }
      if (char === '{' && interpolation > 0) interpolation += 1
      else if (char === '}' && interpolation > 0) interpolation -= 1
      else if (char === '(') round += 1
      else if (char === ')') {
        if (round === 0) throw syntaxError(source, cursor, 'Unexpected closing parenthesis', ERROR_NAME)
        round -= 1
      } else if (char === '[') square += 1
      else if (char === ']') {
        if (square === 0) throw syntaxError(source, cursor, 'Unexpected closing bracket', ERROR_NAME)
        square -= 1
      } else if (char === '{' || char === '}' || char === ';') {
        throw syntaxError(source, cursor, 'Invalid indented Sass syntax', ERROR_NAME)
      }
      cursor += 1
    }

    if (round === 0 && square === 0 && interpolation === 0) {
      return { end: contentEnd(source, line), lineIndex }
    }
    lineIndex += 1
    if (lineIndex >= lines.length) {
      const message = round > 0
        ? 'Unclosed parenthesis'
        : square > 0
          ? 'Unclosed bracket'
          : 'Unclosed interpolation'
      throw syntaxError(source, source.length, message, ERROR_NAME)
    }
    cursor = lines[lineIndex].start
  }
}

function parseSassStyle(source, origin = 0) {
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
    const colon = topLevelColon(source, start, end, ERROR_NAME)
    if (colon !== -1 && !computed) {
      const property = source.slice(start, colon).trim()
      if (property && !property.startsWith('$') && !property.startsWith('@')) {
        const value = directTokens(source, colon + 1, end, ERROR_NAME)
        const declaration = {
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
        }
        declarations.push(declaration)
        ancestors.push({
          indent,
          childIndent: null,
          computed: computed || computedBlock(header),
          declaration
        })
        continue
      }
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

module.exports = { parseSassStyle }
