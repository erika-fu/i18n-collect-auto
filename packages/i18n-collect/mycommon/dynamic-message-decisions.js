const fs = require('fs')
const {
  discoverDynamicMessageCandidates,
  dynamicCandidateId,
  normalizeExpressionForId
} = require('./complete-static-copy-policy')

const DYNAMIC_MESSAGE_DECISIONS_VERSION = 1
const CANDIDATE_ID = /^dynamic\.[0-9a-f]{6}$/

function collectionFailure(message) {
  const error = new Error(
    message.startsWith('i18n-collect failed:') ? message : `i18n-collect failed: ${message}`
  )
  error.kind = 'collection'
  return error
}

function occurrenceOf(item, index) {
  if (!Object.prototype.hasOwnProperty.call(item, 'occurrence')) return 0
  if (!Number.isInteger(item.occurrence) || item.occurrence < 0) {
    throw collectionFailure(`dynamic message decision ${index} occurrence must be a non-negative integer`)
  }
  return item.occurrence
}

function requireString(item, field, index) {
  if (!item || typeof item[field] !== 'string' || item[field].length === 0) {
    throw collectionFailure(`dynamic message decision ${index} ${field} must be a non-empty string`)
  }
}

function normalizeDecision(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw collectionFailure(`dynamic message decision ${index} must be an object`)
  }
  requireString(item, 'id', index)
  requireString(item, 'path', index)
  requireString(item, 'expression', index)
  requireString(item, 'candidateReason', index)
  requireString(item, 'decision', index)
  if (!CANDIDATE_ID.test(item.id)) {
    throw collectionFailure(`dynamic message decision ${index} id is not a dynamic candidate id`)
  }
  const decision = {
    id: item.id,
    path: String(item.path).split('\\').join('/'),
    expression: item.expression,
    candidateReason: item.candidateReason,
    decision: item.decision,
    occurrence: occurrenceOf(item, index)
  }
  if (item.decision === 'ignore') {
    requireString(item, 'reason', index)
    decision.reason = item.reason
    return decision
  }
  if (item.decision === 'translate' || item.decision === 'migrated') {
    requireString(item, 'key', index)
    decision.key = item.key
    return decision
  }
  if (item.decision === 'defer') {
    if (Object.prototype.hasOwnProperty.call(item, 'reason')) requireString(item, 'reason', index)
    if (item.reason) decision.reason = item.reason
    return decision
  }
  throw collectionFailure(`dynamic message decision ${index} decision "${item.decision}" is unsupported`)
}

function readDynamicMessageDecisions(file) {
  if (!fs.existsSync(file)) return []
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw collectionFailure(`dynamic message decisions could not be read (${error.message})`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw collectionFailure('dynamic message decisions must be an object')
  }
  if (parsed.version !== DYNAMIC_MESSAGE_DECISIONS_VERSION) {
    throw collectionFailure(
      `dynamic message decisions version ${parsed.version} is unsupported; use version ${DYNAMIC_MESSAGE_DECISIONS_VERSION}`
    )
  }
  if (!Array.isArray(parsed.decisions)) {
    throw collectionFailure('dynamic message decisions must include a decisions array')
  }
  return parsed.decisions.map((item, index) => normalizeDecision(item, index))
}

function matchesDecision(candidate, decision) {
  return candidate.id === decision.id
    && candidate.location
    && candidate.location.path === decision.path
    && normalizeExpressionForId(candidate.expression) === normalizeExpressionForId(decision.expression)
}

function migratedRecord(decision) {
  return {
    id: decision.id,
    path: decision.path,
    expression: decision.expression,
    key: decision.key,
    disposition: 'migrated'
  }
}

function recordedCandidate(decision) {
  const found = discoverDynamicMessageCandidates([{
    path: decision.path,
    source: `const __candidate = ${decision.expression}\n`
  }])
  const normalized = normalizeExpressionForId(decision.expression)
  return found.find(item => (
    item.reason === decision.candidateReason
    && item.location
    && item.location.path === decision.path
    && normalizeExpressionForId(item.expression) === normalized
  )) || null
}

function coversFragments(source, fragments) {
  return Array.isArray(fragments)
    && fragments.length > 0
    && fragments.every(fragment => String(source).includes(fragment))
}

function applyDynamicMessageDecisions(candidates, decisions, explicitMessages = [], calls = []) {
  const explicitByKey = new Map(
    (explicitMessages || []).filter(item => item && item.key).map(item => [item.key, item])
  )
  const seen = new Set()
  const verifiedCalls = new Set()
  const migrated = []
  for (const decision of decisions) {
    if (seen.has(decision.id)) {
      throw collectionFailure(`dynamic message decision "${decision.id}" is duplicated`)
    }
    seen.add(decision.id)
    const expectedId = dynamicCandidateId({
      path: decision.path,
      expression: decision.expression,
      reason: decision.candidateReason,
      occurrence: decision.occurrence
    })
    if (expectedId !== decision.id) {
      throw collectionFailure(
        `dynamic message decision "${decision.id}" does not match its recorded candidate`
      )
    }
    const matches = candidates.filter(candidate => matchesDecision(candidate, decision))
    if (decision.decision === 'migrated') {
      if (matches.length > 0) {
        throw collectionFailure(
          `dynamic message decision "${decision.id}" is migrated but still matches a dynamic candidate`
        )
      }
      const declared = explicitByKey.get(decision.key)
      if (!declared) {
        throw collectionFailure(
          `dynamic message decision "${decision.id}" records "${decision.key}" but that explicit message is not declared`
        )
      }
      const recorded = recordedCandidate(decision)
      if (!recorded || !coversFragments(declared.source, recorded.staticFragments)) {
        throw collectionFailure(
          `dynamic message decision "${decision.id}" is migrated but "${decision.key}" does not preserve the recorded expression`
        )
      }
      const callsHere = calls.filter(call => (
        call && call.key === decision.key && call.location && call.location.path === decision.path
      ))
      if (callsHere.length === 0) {
        throw collectionFailure(
          `dynamic message decision "${decision.id}" is migrated but "${decision.key}" is not called from ${decision.path}`
        )
      }
      if (callsHere.length > 1) {
        throw collectionFailure(
          `dynamic message decision "${decision.id}" is migrated but "${decision.key}" is called ${callsHere.length} times from ${decision.path}`
        )
      }
      const callSlot = `${decision.path}\0${decision.key}`
      if (verifiedCalls.has(callSlot)) {
        throw collectionFailure(
          `dynamic message decision "${decision.id}" is ambiguous for "${decision.key}" in ${decision.path}`
        )
      }
      verifiedCalls.add(callSlot)
      migrated.push(migratedRecord(decision))
      continue
    }
    if (matches.length === 0) {
      throw collectionFailure(
        `dynamic message decision "${decision.id}" does not match a current candidate`
      )
    }
    if (matches.length > 1) {
      throw collectionFailure(
        `dynamic message decision "${decision.id}" matches ${matches.length} candidates`
      )
    }
    if (decision.decision === 'translate') {
      if (!explicitByKey.has(decision.key)) {
        throw collectionFailure(
          `dynamic message decision "${decision.id}" approves "${decision.key}" but that explicit message is not declared`
        )
      }
      matches[0].disposition = 'translation-approved'
      matches[0].key = decision.key
      continue
    }
    if (decision.decision === 'defer') {
      matches[0].disposition = 'needs-review'
      matches[0].decision = 'defer'
      if (decision.reason) matches[0].deferReason = decision.reason
      continue
    }
    if (decision.decision === 'ignore') {
      matches[0].disposition = 'intentionally-ignored'
      matches[0].ignoreReason = decision.reason
      continue
    }
    throw collectionFailure(
      `dynamic message decision "${decision.id}" decision "${decision.decision}" is unsupported`
    )
  }
  return migrated
}

module.exports = {
  DYNAMIC_MESSAGE_DECISIONS_VERSION,
  applyDynamicMessageDecisions,
  normalizeDecision,
  readDynamicMessageDecisions
}
