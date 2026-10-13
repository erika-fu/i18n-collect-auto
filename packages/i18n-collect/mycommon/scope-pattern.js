function isGlobPattern(pattern) {
  return /[*?[{}]/.test(pattern)
}

function readClass(source, start) {
  let index = start + 1
  let negate = false
  if (source[index] === '!' || source[index] === '^') {
    negate = true
    index += 1
  }
  const contentStart = index
  const members = []
  if (source[index] === ']') {
    members.push(source[index])
    index += 1
  }
  while (index < source.length && source[index] !== ']') {
    if (source[index + 1] === '-' && source[index + 2] && source[index + 2] !== ']') {
      if (source[index] > source[index + 2]) return null
      members.push({ start: source[index], end: source[index + 2] })
      index += 3
      continue
    }
    members.push(source[index])
    index += 1
  }
  if (index >= source.length || source[index] !== ']' || index === contentStart) return null
  return { negate, members, next: index + 1 }
}

function validateGlobSegment(segment, pattern, field) {
  if (segment.includes('**') && segment !== '**') {
    throw new Error(`${field} pattern "${pattern}" is ambiguous: "**" must be its own path segment`)
  }
  let index = 0
  while (index < segment.length) {
    if (segment[index] === ']') {
      throw new Error(`${field} pattern "${pattern}" is invalid: stray "]"`)
    }
    if (segment[index] !== '[') {
      index += 1
      continue
    }
    const charClass = readClass(segment, index)
    if (!charClass) {
      throw new Error(`${field} pattern "${pattern}" is invalid: unclosed or empty character class`)
    }
    index = charClass.next
  }
}

function normalizeGlobPattern(pattern, field) {
  if (pattern.endsWith('/')) {
    throw new Error(`${field} pattern "${pattern}" is ambiguous: a glob cannot end with /`)
  }
  if (pattern.includes('{') || pattern.includes('}')) {
    throw new Error(`${field} pattern "${pattern}" is ambiguous: brace expansion is not supported`)
  }
  const rawSegments = pattern.split('/')
  if (rawSegments.some(segment => segment.length === 0)) {
    throw new Error(`${field} pattern "${pattern}" is invalid: empty path segment`)
  }
  const normalized = []
  let crossedGlob = false
  for (const segment of rawSegments) {
    if (segment === '.') continue
    if (segment === '..') {
      if (crossedGlob) {
        throw new Error(`${field} pattern "${pattern}" is ambiguous: ".." cannot follow a glob segment`)
      }
      if (normalized.length === 0) {
        throw new Error(`${field} must stay inside the project root`)
      }
      normalized.pop()
      continue
    }
    validateGlobSegment(segment, pattern, field)
    if (segment.includes('*') || segment.includes('?') || segment.includes('[')) crossedGlob = true
    if (segment === '**' && normalized[normalized.length - 1] === '**') continue
    normalized.push(segment)
  }
  if (normalized.length === 0) {
    throw new Error(`${field} must not be empty or the project root`)
  }
  return normalized.join('/')
}

function boundaryMatch(candidate, pattern) {
  return candidate === pattern || candidate.startsWith(`${pattern}/`)
}

function classMatches(textChar, source, start) {
  const charClass = readClass(source, start)
  if (!charClass) return null
  let matched = false
  for (const member of charClass.members) {
    if (typeof member === 'string') matched = matched || textChar === member
    else matched = matched || (textChar >= member.start && textChar <= member.end)
  }
  return { matched: charClass.negate ? !matched : matched, next: charClass.next }
}

function segmentMatches(segment, text) {
  function matchAt(segmentIndex, textIndex) {
    while (segmentIndex < segment.length) {
      if (segment[segmentIndex] === '*') {
        for (let next = textIndex; next <= text.length; next++) {
          if (matchAt(segmentIndex + 1, next)) return true
        }
        return false
      }
      if (textIndex >= text.length) return false
      if (segment[segmentIndex] === '?') {
        segmentIndex += 1
        textIndex += 1
        continue
      }
      if (segment[segmentIndex] === '[') {
        const charClass = classMatches(text[textIndex], segment, segmentIndex)
        if (!charClass || !charClass.matched) return false
        segmentIndex = charClass.next
        textIndex += 1
        continue
      }
      if (segment[segmentIndex] !== text[textIndex]) return false
      segmentIndex += 1
      textIndex += 1
    }
    return textIndex === text.length
  }
  return matchAt(0, 0)
}

function globMatch(candidate, pattern) {
  const parts = candidate.split('/')
  const segments = pattern.split('/')
  function walk(partIndex, segmentIndex) {
    if (segmentIndex === segments.length) return partIndex === parts.length
    if (segments[segmentIndex] === '**') {
      for (let next = partIndex; next <= parts.length; next++) {
        if (walk(next, segmentIndex + 1)) return true
      }
      return false
    }
    if (partIndex >= parts.length) return false
    if (!segmentMatches(segments[segmentIndex], parts[partIndex])) return false
    return walk(partIndex + 1, segmentIndex + 1)
  }
  return walk(0, 0)
}

function scopeMatches(candidate, pattern) {
  if (isGlobPattern(pattern)) return globMatch(candidate, pattern)
  return boundaryMatch(candidate, pattern)
}

module.exports = { isGlobPattern, normalizeGlobPattern, scopeMatches }
