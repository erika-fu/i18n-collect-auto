const { directivesBefore, keyConflict, scanDirectives } = require('./directives')
const { containsHan, offsetToPosition } = require('./resource')
const { decodeStyleString } = require('./style-source')

function failAt(source, offset, message) {
  const bounded = Math.max(0, Math.min(offset, source.length))
  const error = new Error(message)
  error.loc = offsetToPosition(source, bounded)
  return error
}

function collectStyle({ source, projectPath, style }) {
  if (typeof source !== 'string') throw new TypeError('Style collector requires source text')
  if (typeof projectPath !== 'string' || !projectPath) {
    throw new TypeError('Style collector requires a project path')
  }
  if (!style || !Array.isArray(style.declarations)) {
    throw new TypeError('Style collector requires parsed declarations')
  }

  const entries = []
  const fail = (offset, message) => {
    throw failAt(source, offset, message)
  }
  const declarationDirectives = scanDirectives(style.comments, fail)

  for (const declaration of style.declarations) {
    if (String(declaration.property).toLowerCase() !== 'content') continue
    const value = declaration.value || {}
    const valueDirectives = scanDirectives(value.comments, fail)
    const inherited = directivesBefore(source, declarationDirectives, declaration.start, fail)
    const strings = (value.tokens || [])
      .filter(token => token.type === 'static-string')
      .map(token => ({ token, value: decodeStyleString(source, token.start, token.end) }))
      .filter(item => item.value.trim() && containsHan(item.value))

    strings.forEach((item, index) => {
      const own = directivesBefore(source, valueDirectives, item.token.quoteStart, fail)
      const declarationDirective = index === 0 ? inherited : { exclude: false, key: null }
      if (own.exclude || declarationDirective.exclude) return
      if (own.key && declarationDirective.key && own.key !== declarationDirective.key) {
        fail(item.token.quoteStart, keyConflict(declarationDirective.key, own.key))
      }
      const key = own.key || declarationDirective.key
      const location = {
        path: projectPath,
        kind: 'css-generated-content',
        start: offsetToPosition(source, item.token.start),
        end: offsetToPosition(source, item.token.end)
      }
      entries.push(key
        ? { value: item.value, key, locations: [location] }
        : { value: item.value, locations: [location] })
    })
  }

  return { entries, warnings: Array.isArray(style.warnings) ? style.warnings : [] }
}

module.exports = { collectStyle }
