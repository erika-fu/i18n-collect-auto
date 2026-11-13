const { normalizeExpressionForId } = require('./complete-static-copy-policy')
const { applyDynamicMessageDecisions } = require('./dynamic-message-decisions')

const STATUS_NEEDS_REVIEW = 'needs-review'
const STATUS_INTENTIONALLY_IGNORED = 'intentionally-ignored'
const STATUS_TRANSLATION_APPROVED = 'translation-approved'
const STATUS_MIGRATED = 'migrated'

const LISTABLE_STATUSES = new Set([
  STATUS_NEEDS_REVIEW,
  STATUS_INTENTIONALLY_IGNORED,
  STATUS_TRANSLATION_APPROVED,
  STATUS_MIGRATED
])

function lifecycleError(message) {
  const error = new Error(message)
  error.kind = 'configuration'
  return error
}

function withOccurrences(candidates) {
  const counts = new Map()
  return (candidates || []).map(candidate => {
    const fingerprint = [
      candidate.location && candidate.location.path,
      candidate.reason,
      normalizeExpressionForId(candidate.expression)
    ].join('\0')
    const occurrence = counts.get(fingerprint) || 0
    counts.set(fingerprint, occurrence + 1)
    return { ...candidate, occurrence }
  })
}

function filterCandidates(candidates, status) {
  if (!status) return [...(candidates || [])]
  if (!LISTABLE_STATUSES.has(status)) {
    throw lifecycleError(`unsupported review status "${status}"`)
  }
  if (status === STATUS_MIGRATED) return []
  return (candidates || []).filter(candidate => candidate.disposition === status)
}

function compatibleWith(primary, candidate) {
  if (!primary || !candidate) return false
  return primary.reason === candidate.reason
    && normalizeExpressionForId(primary.expression) === normalizeExpressionForId(candidate.expression)
}

function compatibleCandidates(primary, candidates) {
  return (candidates || []).filter(candidate => compatibleWith(primary, candidate))
}

function classifyDynamicCandidates(candidates) {
  const groups = {
    unreviewed: [],
    deferred: [],
    translationApproved: [],
    intentionallyIgnored: []
  }
  for (const candidate of candidates || []) {
    if (!candidate) continue
    if (candidate.disposition === STATUS_INTENTIONALLY_IGNORED) {
      groups.intentionallyIgnored.push(candidate)
    } else if (candidate.disposition === STATUS_TRANSLATION_APPROVED) {
      groups.translationApproved.push(candidate)
    } else if (candidate.decision === 'defer') {
      groups.deferred.push(candidate)
    } else if (candidate.disposition === STATUS_NEEDS_REVIEW || candidate.disposition == null) {
      groups.unreviewed.push(candidate)
    }
  }
  return groups
}

function coverageFor(candidates, groups, migrated) {
  return {
    total: candidates.length,
    needsReview: groups.unreviewed.length + groups.deferred.length,
    intentionallyIgnored: groups.intentionallyIgnored.length,
    translationApproved: groups.translationApproved.length,
    deferred: groups.deferred.length,
    migrated: migrated.length
  }
}

function evaluateDynamicMessageLifecycle({
  candidates = [],
  decisions,
  explicitMessages = [],
  calls = [],
  migrated = [],
  annotateOccurrences = true
} = {}) {
  const annotated = annotateOccurrences ? withOccurrences(candidates) : [...candidates]
  const migratedDecisions = decisions
    ? applyDynamicMessageDecisions(annotated, decisions, explicitMessages, calls)
    : [...migrated]
  const groups = classifyDynamicCandidates(annotated)
  return {
    candidates: annotated,
    groups,
    coverage: coverageFor(annotated, groups, migratedDecisions),
    migrated: migratedDecisions
  }
}

function markDecisionMigrated(decision) {
  if (!decision || (decision.decision !== 'translate' && decision.decision !== 'migrated')) {
    throw lifecycleError('review write requires a translate decision for the candidate')
  }
  return {
    ...decision,
    decision: STATUS_MIGRATED
  }
}

function selectReviewCandidates({
  candidates,
  id,
  status,
  bulk = false
} = {}) {
  const annotated = withOccurrences(candidates)
  if (id) {
    const primary = annotated.find(candidate => candidate.id === id)
    if (!primary) throw lifecycleError(`unknown dynamic candidate "${id}"`)
    if (status && primary.disposition !== status) {
      throw lifecycleError(
        `candidate "${id}" has disposition "${primary.disposition}", not "${status}"`
      )
    }
    if (!bulk) return [primary]
    const pool = filterCandidates(annotated, status || STATUS_NEEDS_REVIEW)
    const matched = compatibleCandidates(primary, pool)
    if (!matched.some(item => item.id === primary.id)) matched.unshift(primary)
    return matched
  }
  if (bulk) {
    throw lifecycleError('review --bulk requires a candidate id to define compatibility')
  }
  return filterCandidates(annotated, status || STATUS_NEEDS_REVIEW)
}

module.exports = {
  STATUS_MIGRATED,
  STATUS_NEEDS_REVIEW,
  STATUS_TRANSLATION_APPROVED,
  classifyDynamicCandidates,
  evaluateDynamicMessageLifecycle,
  markDecisionMigrated,
  selectReviewCandidates
}
