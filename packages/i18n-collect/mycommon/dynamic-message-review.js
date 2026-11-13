const fs = require('fs')
const path = require('path')
const { readExplicitMessages, EXPLICIT_MESSAGES_VERSION } = require('./catalog')
const {
  DYNAMIC_MESSAGE_DECISIONS_VERSION,
  normalizeDecision,
  readDynamicMessageDecisions
} = require('./dynamic-message-decisions')
const { normalizeExpressionForId } = require('./complete-static-copy-policy')
const { identityFiles } = require('./config')
const { commitFiles, json, recoverCommits } = require('./output')

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

function reviewError(kind, message) {
  const error = new Error(message)
  error.kind = kind
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
    throw reviewError('configuration', `unsupported review status "${status}"`)
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

function coversFragments(source, fragments) {
  return Array.isArray(fragments)
    && fragments.length > 0
    && fragments.every(fragment => String(source).includes(fragment))
}

function decisionRecord(candidate, decision) {
  if (!candidate || !candidate.id || !candidate.location || !candidate.reason) {
    throw reviewError('configuration', 'review candidate is missing identity fields')
  }
  const entry = {
    id: candidate.id,
    path: candidate.location.path,
    expression: candidate.expression,
    candidateReason: candidate.reason,
    decision: decision.decision
  }
  if (candidate.occurrence) entry.occurrence = candidate.occurrence
  if (decision.decision === 'ignore') {
    if (typeof decision.reason !== 'string' || decision.reason.trim().length === 0) {
      throw reviewError('configuration', 'ignore requires a non-empty --reason')
    }
    entry.reason = decision.reason.trim()
    return entry
  }
  if (decision.decision === 'defer') {
    if (Object.prototype.hasOwnProperty.call(decision, 'reason') && decision.reason != null) {
      if (typeof decision.reason !== 'string' || decision.reason.trim().length === 0) {
        throw reviewError('configuration', 'defer reason must be a non-empty string when provided')
      }
      entry.reason = decision.reason.trim()
    }
    return entry
  }
  if (decision.decision === 'translate') {
    if (typeof decision.key !== 'string' || decision.key.length === 0) {
      throw reviewError('configuration', 'translate requires a non-empty --key')
    }
    if (typeof decision.source !== 'string' || decision.source.length === 0) {
      throw reviewError('configuration', 'translate requires a non-empty --source')
    }
    if (!coversFragments(decision.source, candidate.staticFragments)) {
      throw reviewError(
        'configuration',
        `translate source does not preserve static fragments for "${candidate.id}"`
      )
    }
    entry.key = decision.key
    return entry
  }
  throw reviewError('configuration', `unsupported review decision "${decision.decision}"`)
}

function replaceDecision(existing, next) {
  const decisions = (existing || []).filter(item => item.id !== next.id)
  decisions.push(normalizeDecision(next, decisions.length))
  return decisions.sort((left, right) => left.id.localeCompare(right.id))
}

function mergeExplicitMessage(messages, key, source) {
  const list = [...(messages || [])]
  const index = list.findIndex(item => item.key === key)
  if (index === -1) {
    list.push({ key, source })
    return list.sort((left, right) => left.key.localeCompare(right.key))
  }
  if (list[index].source !== source) {
    throw reviewError(
      'configuration',
      `explicit message "${key}" already declares a different source`
    )
  }
  return list
}

function planDecisionWrites({
  candidates,
  existingDecisions,
  existingExplicitMessages,
  decision
}) {
  if (!candidates || candidates.length === 0) {
    throw reviewError('configuration', 'no review candidates matched the request')
  }
  let decisions = [...(existingDecisions || [])]
  let explicitMessages = [...(existingExplicitMessages || [])]
  const recorded = []
  for (const candidate of candidates) {
    const entry = decisionRecord(candidate, decision)
    decisions = replaceDecision(decisions, entry)
    recorded.push(entry)
  }
  if (decision.decision === 'translate') {
    explicitMessages = mergeExplicitMessage(explicitMessages, decision.key, decision.source)
  }
  return { decisions, explicitMessages, recorded }
}

function pruneMigratedDecisions(decisions) {
  const kept = []
  const pruned = []
  for (const decision of decisions || []) {
    if (decision.decision === 'migrated') pruned.push(decision)
    else kept.push(decision)
  }
  return { decisions: kept, pruned }
}

function serializeDecisions(decisions) {
  return json({
    version: DYNAMIC_MESSAGE_DECISIONS_VERSION,
    decisions: decisions || []
  })
}

function serializeExplicitMessages(messages) {
  return json({
    version: EXPLICIT_MESSAGES_VERSION,
    messages: messages || []
  })
}

function loadReviewArtifacts(config) {
  const files = identityFiles(config)
  const decisionsFile = path.resolve(config.root, files.dynamicMessageDecisions)
  const explicitFile = path.resolve(config.root, files.explicitMessages)
  recoverCommits(path.dirname(decisionsFile))
  recoverCommits(path.dirname(explicitFile))
  return {
    decisionsFile,
    explicitFile,
    decisions: readDynamicMessageDecisions(decisionsFile),
    explicitMessages: readExplicitMessages(explicitFile)
  }
}

function writeReviewArtifacts({
  decisionsFile,
  explicitFile,
  decisions,
  explicitMessages,
  writeExplicit,
  fsImpl = fs
}) {
  const targets = [
    { file: decisionsFile, content: serializeDecisions(decisions) }
  ]
  if (writeExplicit) {
    targets.push({ file: explicitFile, content: serializeExplicitMessages(explicitMessages) })
  }
  try {
    commitFiles(targets, fsImpl)
  } catch (error) {
    const failure = reviewError('storage', error.message || String(error))
    failure.cause = error
    throw failure
  }
}

module.exports = {
  LISTABLE_STATUSES,
  STATUS_MIGRATED,
  STATUS_NEEDS_REVIEW,
  STATUS_INTENTIONALLY_IGNORED,
  STATUS_TRANSLATION_APPROVED,
  compatibleCandidates,
  compatibleWith,
  filterCandidates,
  loadReviewArtifacts,
  planDecisionWrites,
  pruneMigratedDecisions,
  serializeDecisions,
  serializeExplicitMessages,
  withOccurrences,
  writeReviewArtifacts
}
