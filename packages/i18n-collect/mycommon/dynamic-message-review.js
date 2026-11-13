const fs = require('fs')
const path = require('path')
const { readExplicitMessages, EXPLICIT_MESSAGES_VERSION } = require('./catalog')
const {
  DYNAMIC_MESSAGE_DECISIONS_VERSION,
  normalizeDecision,
  readDynamicMessageDecisions
} = require('./dynamic-message-decisions')
const { identityFiles } = require('./config')
const { commitFiles, json, recoverCommits } = require('./output')
const {
  applyEdits,
  offsetAt,
  planProvenSafeMigration,
  simpleDiff
} = require('./review-write-migration')

const WRITE_ADAPTERS = new Set(['js', 'vue2', 'vue3'])

function reviewError(kind, message) {
  const error = new Error(message)
  error.kind = kind
  return error
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

function readProjectFile(root, projectPath) {
  if (!projectPath || path.posix.isAbsolute(projectPath) || path.isAbsolute(projectPath)) {
    throw reviewError('configuration', `unsafe review write path "${projectPath}"`)
  }
  const full = path.resolve(root, projectPath)
  const relative = path.relative(root, full)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw reviewError('configuration', `unsafe review write path "${projectPath}"`)
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw reviewError('configuration', `source file missing for review write: ${projectPath}`)
  }
  return {
    full,
    relative: projectPath.split('\\').join('/'),
    content: fs.readFileSync(full, 'utf8')
  }
}

function explicitSourceFor(artifacts, key) {
  const message = (artifacts.explicitMessages || []).find(item => item.key === key)
  if (!message || typeof message.source !== 'string') {
    throw reviewError('configuration', `explicit message "${key}" is required before review --write`)
  }
  return message.source
}

function decisionForCandidate(artifacts, candidate) {
  const matches = (artifacts.decisions || []).filter(item => item.id === candidate.id)
  if (matches.length === 0) {
    throw reviewError(
      'configuration',
      `candidate "${candidate.id}" has no translate decision; record --translate before --write`
    )
  }
  if (matches.length > 1) {
    throw reviewError('configuration', `candidate "${candidate.id}" has ambiguous review decisions`)
  }
  return matches[0]
}

function planWriteMigrations({ root, adapter, candidates, artifacts, key, source }) {
  if (!WRITE_ADAPTERS.has(adapter)) {
    throw reviewError('configuration', `unknown adapter "${adapter}"; expected js, vue2, or vue3`)
  }
  const byPath = new Map()
  const planned = []
  for (const candidate of candidates) {
    const decision = key
      ? { decision: 'translate', key, source }
      : decisionForCandidate(artifacts, candidate)
    if (decision.decision !== 'translate' && decision.decision !== 'migrated') {
      throw reviewError(
        'configuration',
        `candidate "${candidate.id}" decision "${decision.decision}" cannot be written`
      )
    }
    const explicitKey = key || decision.key
    const explicitSource = source || explicitSourceFor(artifacts, explicitKey)
    const file = readProjectFile(root, candidate.location.path)
    if (!byPath.has(file.relative)) {
      byPath.set(file.relative, {
        full: file.full,
        relative: file.relative,
        original: file.content,
        edits: []
      })
    }
    const bucket = byPath.get(file.relative)
    const migration = planProvenSafeMigration({
      candidate,
      key: explicitKey,
      source: explicitSource,
      fileSource: bucket.original,
      adapter
    })
    if (!migration.ok) {
      throw reviewError(
        'configuration',
        `review --write refused for "${candidate.id}": ${migration.reason}`
      )
    }
    const start = offsetAt(bucket.original, candidate.location.start)
    const end = offsetAt(bucket.original, candidate.location.end)
    bucket.edits.push({ start, end, text: migration.call })
    planned.push({
      candidate,
      key: explicitKey,
      source: explicitSource,
      call: migration.call,
      path: file.relative
    })
  }
  const files = [...byPath.values()].map(bucket => {
    const content = applyEdits(bucket.original, bucket.edits)
    return {
      full: bucket.full,
      relative: bucket.relative,
      original: bucket.original,
      content,
      diff: simpleDiff(bucket.relative, bucket.original, content)
    }
  })
  const diffs = new Map(files.map(file => [file.relative, file.diff]))
  for (const item of planned) item.diff = diffs.get(item.path)
  return { migrations: planned, files }
}

function commitReviewTargets(targets, fsImpl) {
  try {
    commitFiles(targets, fsImpl)
  } catch (error) {
    const failure = reviewError('storage', error.message || String(error))
    failure.cause = error
    throw failure
  }
}

function writeReviewMigration({
  files,
  decisionsFile,
  decisions,
  explicitFile,
  explicitMessages,
  writeExplicit = false,
  fsImpl = fs
}) {
  const targets = [
    ...(files || []).map(file => ({ file: file.full, content: file.content })),
    { file: decisionsFile, content: serializeDecisions(decisions) }
  ]
  if (writeExplicit) {
    targets.push({ file: explicitFile, content: serializeExplicitMessages(explicitMessages) })
  }
  commitReviewTargets(targets, fsImpl)
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
  commitReviewTargets(targets, fsImpl)
}

module.exports = {
  loadReviewArtifacts,
  decisionForCandidate,
  planDecisionWrites,
  planWriteMigrations,
  pruneMigratedDecisions,
  serializeDecisions,
  serializeExplicitMessages,
  writeReviewArtifacts,
  writeReviewMigration
}
