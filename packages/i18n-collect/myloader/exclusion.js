function isExclusionDirective(text) {
  return String(text == null ? '' : text).trim() === 'no-i18n-auto'
}

function whitespaceGap(source, from, to) {
  return from <= to && /^\s*$/.test(source.slice(from, to))
}

function directiveEnds(comments) {
  const ends = []
  for (const comment of comments || []) {
    if (!isExclusionDirective(comment.value)) continue
    if (Number.isInteger(comment.end)) ends.push(comment.end)
  }
  return ends
}

function followsDirective(source, ends, constructStart) {
  return ends.some(end => whitespaceGap(source, end, constructStart))
}

module.exports = {
  isExclusionDirective,
  whitespaceGap,
  directiveEnds,
  followsDirective
}
