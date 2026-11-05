const postcss = require('postcss')
const { scanStyleValue } = require('./style-source')

function declarationValue(source, declaration) {
  const start = declaration.source.start.offset
  const end = declaration.source.end.offset + 1
  const text = source.slice(start, Math.max(start, end))
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
      return { start: start + index + 1, end }
    }
    index += 1
  }
  return { start: end, end }
}

function parserComments(root, origin) {
  const comments = []
  root.walkComments(comment => {
    if (!comment.source || !comment.source.start || !comment.source.end) return
    comments.push({
      start: origin + comment.source.start.offset,
      end: origin + comment.source.end.offset + 1,
      text: comment.text
    })
  })
  return comments
}

function parseCssStyle(source, origin = 0) {
  const root = postcss.parse(source)
  const declarations = []
  root.walkDecls(declaration => {
    if (!declaration.source || !declaration.source.start || !declaration.source.end) return
    const value = declarationValue(source, declaration)
    const scanned = scanStyleValue(source, value.start, value.end)
    declarations.push({
      property: String(declaration.prop),
      start: origin + declaration.source.start.offset,
      value: {
        start: origin + value.start,
        end: origin + value.end,
        comments: scanned.comments.map(comment => ({
          ...comment,
          start: origin + comment.start,
          end: origin + comment.end
        })),
        tokens: scanned.tokens.map(token => ({
          ...token,
          quoteStart: origin + token.quoteStart,
          start: origin + token.start,
          end: origin + token.end
        }))
      }
    })
  })
  return {
    comments: parserComments(root, origin),
    declarations,
    warnings: []
  }
}

module.exports = { parseCssStyle }
