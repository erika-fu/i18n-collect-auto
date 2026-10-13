const KEY_DIRECTIVE = /^i18n-key(?![A-Za-z0-9_-])/
const KEY_DIRECTIVE_SHAPE = /^i18n-key:\s*(\S+)$/
const KEY_SHAPE = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/

function isExclusionDirective(text) {
  return String(text == null ? '' : text).trim() === 'no-i18n-auto'
}

function isLocalizationKey(value) {
  return typeof value === 'string' && KEY_SHAPE.test(value)
}

function keyDirective(text) {
  const trimmed = String(text == null ? '' : text).trim()
  if (!KEY_DIRECTIVE.test(trimmed)) return null
  const match = KEY_DIRECTIVE_SHAPE.exec(trimmed)
  if (!match || !isLocalizationKey(match[1])) return { malformed: trimmed }
  return { key: match[1] }
}

function keyConflict(first, second) {
  return `conflicting i18n-key directives "${first}" and "${second}"`
}

function whitespaceGap(source, from, to) {
  return from <= to && /^\s*$/.test(source.slice(from, to))
}

// comments: [{ start, end, text }] with offsets into the same source later passed to directivesBefore.
function scanDirectives(comments, fail) {
  const directives = []
  for (const comment of comments || []) {
    if (!Number.isInteger(comment.start) || !Number.isInteger(comment.end)) continue
    if (isExclusionDirective(comment.text)) {
      directives.push({ start: comment.start, end: comment.end, exclude: true, key: null })
      continue
    }
    const parsed = keyDirective(comment.text)
    if (!parsed) continue
    if (parsed.malformed) {
      fail(comment.start, `malformed i18n-key directive "${parsed.malformed}": expected "i18n-key: <key>" where the key looks like "home.title"`)
    }
    directives.push({ start: comment.start, end: comment.end, exclude: false, key: parsed.key })
  }
  return directives
}

function babelComments(comments) {
  return comments.map(comment => ({ start: comment.start, end: comment.end, text: comment.value }))
}

function directivesBefore(source, directives, constructStart, fail) {
  let cursor = constructStart
  let exclude = false
  let key = null
  for (;;) {
    const found = directives.find(directive => whitespaceGap(source, directive.end, cursor))
    if (!found) break
    if (found.exclude) exclude = true
    else if (key === null) key = found.key
    else if (key !== found.key) fail(constructStart, keyConflict(found.key, key))
    cursor = found.start
  }
  return { exclude, key }
}

module.exports = {
  babelComments,
  directivesBefore,
  isExclusionDirective,
  isLocalizationKey,
  keyConflict,
  keyDirective,
  scanDirectives,
  whitespaceGap
}
