const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { loadConfig } = require('../mycommon/config')
const {
  STATUS_MIGRATED,
  STATUS_NEEDS_REVIEW,
  STATUS_TRANSLATION_APPROVED,
  compatibleCandidates,
  filterCandidates,
  loadReviewArtifacts,
  planDecisionWrites,
  pruneMigratedDecisions,
  serializeDecisions,
  serializeExplicitMessages,
  withOccurrences,
  writeReviewArtifacts
} = require('../mycommon/dynamic-message-review')
const { commitFiles } = require('../mycommon/output')
const { analyzeProject } = require('../mycommon/project-analysis')
const { listProjectSources } = require('../mycommon/project-sources')
const {
  applyEdits,
  markDecisionMigrated,
  offsetAt,
  planProvenSafeMigration,
  simpleDiff
} = require('../mycommon/review-write-migration')

const WRITE_ADAPTERS = new Set(['js', 'vue2', 'vue3'])

const EXIT = {
  ok: 0,
  configuration: 1,
  collection: 2,
  storage: 6
}

function commandError(kind, message) {
  const error = new Error(message)
  error.kind = kind
  return error
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function outcome(code, stdout, stderr) {
  return { code, stdout, stderr }
}

function failure(error, jsonMode) {
  const kind = error && EXIT[error.kind] != null ? error.kind : 'configuration'
  const message = error && error.message ? error.message : String(error)
  const stdout = jsonMode
    ? jsonText({ command: 'review', failure: kind, message, ok: false })
    : ''
  return outcome(EXIT[kind] == null ? EXIT.configuration : EXIT[kind], stdout, `${kind}: ${message}\n`)
}

function take(args, index, flag) {
  const next = args[index + 1]
  if (next === undefined || next.startsWith('-')) throw commandError('configuration', `${flag} requires a value`)
  return next
}

function parseReviewArgs(args) {
  const parsed = {
    adapter: null,
    bulk: false,
    cwd: null,
    defer: false,
    id: null,
    ignore: false,
    json: false,
    key: null,
    prune: false,
    reason: null,
    source: null,
    status: null,
    translate: false,
    write: false,
    yes: false
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const eq = arg.indexOf('=')
    const flag = eq === -1 ? arg : arg.slice(0, eq)
    const inline = eq === -1 ? null : arg.slice(eq + 1)
    const value = name => {
      if (inline !== null) {
        if (!inline) throw commandError('configuration', `${name} requires a value`)
        return inline
      }
      const next = take(args, index, name)
      index += 1
      return next
    }
    if (flag === '--json') {
      if (inline !== null) throw commandError('configuration', 'unknown option "--json"')
      parsed.json = true
    } else if (flag === '--yes') {
      if (inline !== null) throw commandError('configuration', 'unknown option "--yes"')
      parsed.yes = true
    } else if (flag === '--bulk') {
      if (inline !== null) throw commandError('configuration', 'unknown option "--bulk"')
      parsed.bulk = true
    } else if (flag === '--prune') {
      if (inline !== null) throw commandError('configuration', 'unknown option "--prune"')
      parsed.prune = true
    } else if (flag === '--translate') {
      if (inline !== null) throw commandError('configuration', 'unknown option "--translate"')
      parsed.translate = true
    } else if (flag === '--ignore') {
      if (inline !== null) throw commandError('configuration', 'unknown option "--ignore"')
      parsed.ignore = true
    } else if (flag === '--defer') {
      if (inline !== null) throw commandError('configuration', 'unknown option "--defer"')
      parsed.defer = true
    } else if (flag === '--write') {
      if (inline !== null) throw commandError('configuration', 'unknown option "--write"')
      parsed.write = true
    } else if (flag === '--apply') {
      throw commandError(
        'configuration',
        'unknown option "--apply"; use --write for proven-safe source migrations'
      )
    } else if (flag === '--cwd') parsed.cwd = value('--cwd')
    else if (flag === '--status') parsed.status = value('--status')
    else if (flag === '--reason') parsed.reason = value('--reason')
    else if (flag === '--key') parsed.key = value('--key')
    else if (flag === '--source') parsed.source = value('--source')
    else if (flag === '--adapter') parsed.adapter = value('--adapter')
    else if (flag.startsWith('-')) throw commandError('configuration', `unknown option "${flag}"`)
    else if (!parsed.id) parsed.id = arg
    else throw commandError('configuration', `unexpected argument "${arg}"`)
  }
  const modes = [parsed.translate, parsed.ignore, parsed.defer, parsed.prune].filter(Boolean).length
  if (modes > 1) {
    throw commandError('configuration', 'review accepts only one of --translate, --ignore, --defer, or --prune')
  }
  if (parsed.write && (parsed.ignore || parsed.defer || parsed.prune)) {
    throw commandError('configuration', 'review --write cannot combine with --ignore, --defer, or --prune')
  }
  return parsed
}

function createTerminal({ input = process.stdin, output = process.stderr } = {}) {
  return {
    interactive: Boolean(input.isTTY) && !process.env.CI,
    async ask(prompt) {
      const rl = readline.createInterface({ input, output, terminal: false })
      try {
        return await new Promise(resolve => {
          rl.question(prompt, answer => resolve(answer))
        })
      } finally {
        rl.close()
      }
    }
  }
}

async function confirmDecision(parsed, terminal, summary, prompt = 'Record this review decision? [y/N] ') {
  if (parsed.yes) return
  if (terminal.interactive) {
    const answer = await terminal.ask(`${summary}\n${prompt}`)
    if (/^(y|yes)$/i.test(String(answer || '').trim())) return
  }
  throw commandError(
    'configuration',
    'review decision was not confirmed; rerun with --yes for non-interactive use'
  )
}

function readProjectFile(root, projectPath) {
  if (!projectPath || path.posix.isAbsolute(projectPath) || path.isAbsolute(projectPath)) {
    throw commandError('configuration', `unsafe review write path "${projectPath}"`)
  }
  const full = path.resolve(root, projectPath)
  const relative = path.relative(root, full)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw commandError('configuration', `unsafe review write path "${projectPath}"`)
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw commandError('configuration', `source file missing for review write: ${projectPath}`)
  }
  return { full, relative: projectPath.split('\\').join('/'), content: fs.readFileSync(full, 'utf8') }
}

function explicitSourceFor(artifacts, key) {
  const message = (artifacts.explicitMessages || []).find(item => item.key === key)
  if (!message || typeof message.source !== 'string') {
    throw commandError('configuration', `explicit message "${key}" is required before review --write`)
  }
  return message.source
}

function decisionForCandidate(artifacts, candidate) {
  const matches = (artifacts.decisions || []).filter(item => item.id === candidate.id)
  if (matches.length === 0) {
    throw commandError(
      'configuration',
      `candidate "${candidate.id}" has no translate decision; record --translate before --write`
    )
  }
  if (matches.length > 1) {
    throw commandError('configuration', `candidate "${candidate.id}" has ambiguous review decisions`)
  }
  return matches[0]
}

function planWriteMigrations({ root, adapter, candidates, artifacts, key, source }) {
  if (!WRITE_ADAPTERS.has(adapter)) {
    throw commandError('configuration', `unknown adapter "${adapter}"; expected js, vue2, or vue3`)
  }
  const byPath = new Map()
  const planned = []
  for (const candidate of candidates) {
    const decision = key
      ? { decision: 'translate', key, source }
      : decisionForCandidate(artifacts, candidate)
    if (decision.decision !== 'translate' && decision.decision !== 'migrated') {
      throw commandError(
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
      throw commandError(
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

function humanWritePreview(migrations) {
  const lines = [
    `Proven-safe review write preview for ${migrations.length} candidate(s):`
  ]
  for (const item of migrations) {
    lines.push(`  ${item.candidate.id} -> ${item.call}`)
    lines.push(item.diff.trimEnd())
  }
  lines.push('')
  return lines.join('\n')
}

function decisionFromParsed(parsed) {
  if (parsed.translate) {
    return { decision: 'translate', key: parsed.key, source: parsed.source }
  }
  if (parsed.ignore) return { decision: 'ignore', reason: parsed.reason }
  if (parsed.defer) {
    const decision = { decision: 'defer' }
    if (parsed.reason != null) decision.reason = parsed.reason
    return decision
  }
  return null
}

function decisionSummary(decision, count) {
  if (decision.decision === 'translate') {
    return `Translate ${count} candidate(s) through "${decision.key}" with source ${JSON.stringify(decision.source)}.`
  }
  if (decision.decision === 'ignore') {
    return `Intentionally ignore ${count} candidate(s): ${decision.reason}`
  }
  return `Defer ${count} candidate(s)${decision.reason ? `: ${decision.reason}` : '.'}`
}

async function promptInteractiveDecision(terminal, candidate) {
  const where = candidate.location
    ? `${candidate.location.path}:${candidate.location.start.line}:${candidate.location.start.column}`
    : '(unknown location)'
  const choice = await terminal.ask(
    [
      `Inspect ${candidate.id} at ${where}`,
      `  ${candidate.expression}`,
      `  ${candidate.disposition}: ${candidate.diagnostic}`,
      'Choose [t]ranslate, [i]gnore, [d]efer, or [q]uit: '
    ].join('\n')
  )
  const normalized = String(choice || '').trim().toLowerCase()
  if (normalized === 'q' || normalized === 'quit') {
    throw commandError('configuration', 'review decision was cancelled')
  }
  if (normalized === 't' || normalized === 'translate') {
    const key = String(await terminal.ask('Explicit key: ') || '').trim()
    const source = String(await terminal.ask('Canonical source: ') || '').trim()
    return { decision: 'translate', key, source }
  }
  if (normalized === 'i' || normalized === 'ignore') {
    const reason = String(await terminal.ask('Ignore reason: ') || '').trim()
    return { decision: 'ignore', reason }
  }
  if (normalized === 'd' || normalized === 'defer') {
    const reason = String(await terminal.ask('Defer reason (optional): ') || '').trim()
    const decision = { decision: 'defer' }
    if (reason) decision.reason = reason
    return decision
  }
  throw commandError('configuration', 'review decision choice must be translate, ignore, defer, or quit')
}

function publicCandidate(candidate) {
  return {
    id: candidate.id,
    expression: candidate.expression,
    staticFragments: candidate.staticFragments,
    location: candidate.location,
    sourceSurface: candidate.sourceSurface,
    semanticRole: candidate.semanticRole,
    reason: candidate.reason,
    capability: candidate.capability,
    disposition: candidate.disposition,
    diagnostic: candidate.diagnostic,
    ...(candidate.key ? { key: candidate.key } : {}),
    ...(candidate.ignoreReason ? { ignoreReason: candidate.ignoreReason } : {}),
    ...(candidate.deferReason ? { deferReason: candidate.deferReason } : {})
  }
}

function humanList(candidates, status) {
  const label = status || 'all'
  if (candidates.length === 0) return `No dynamic message candidates with status ${label}.\n`
  const lines = [`${candidates.length} dynamic message candidate(s) with status ${label}:`]
  for (const candidate of candidates) {
    const location = candidate.location
    const where = !location
      ? '(unknown location)'
      : location.start
        ? `${location.path}:${location.start.line}:${location.start.column}`
        : location.path
    lines.push(`  ${candidate.id}  ${where}`)
    if (candidate.expression) lines.push(`    ${candidate.expression}`)
    lines.push(`    ${candidate.disposition}: ${candidate.diagnostic}`)
  }
  lines.push('')
  return lines.join('\n')
}

function selectCandidates(parsed, analysis) {
  const annotated = withOccurrences(analysis.dynamicMessageCandidates || [])
  if (parsed.id) {
    const primary = annotated.find(candidate => candidate.id === parsed.id)
    if (!primary) throw commandError('configuration', `unknown dynamic candidate "${parsed.id}"`)
    if (parsed.status && primary.disposition !== parsed.status) {
      throw commandError(
        'configuration',
        `candidate "${parsed.id}" has disposition "${primary.disposition}", not "${parsed.status}"`
      )
    }
    if (parsed.bulk) {
      const pool = filterCandidates(annotated, parsed.status || STATUS_NEEDS_REVIEW)
      const matched = compatibleCandidates(primary, pool)
      if (!matched.some(item => item.id === primary.id)) matched.unshift(primary)
      return matched
    }
    return [primary]
  }
  if (parsed.bulk) {
    throw commandError('configuration', 'review --bulk requires a candidate id to define compatibility')
  }
  return filterCandidates(annotated, parsed.status || STATUS_NEEDS_REVIEW)
}

async function execute(parsed, terminal) {
  const root = path.resolve(parsed.cwd || process.cwd())
  const config = loadConfig({ root })
  const sources = listProjectSources(config.root, config)
  const analysis = analyzeProject({ files: sources, config })
  const artifacts = loadReviewArtifacts(config)

  if (parsed.prune) {
    await confirmDecision(parsed, terminal, 'Prune eligible migrated dynamic message decisions.')
    const { decisions, pruned } = pruneMigratedDecisions(artifacts.decisions)
    if (pruned.length === 0) {
      const report = {
        command: 'review',
        ok: true,
        action: 'prune',
        pruned: []
      }
      if (parsed.json) return outcome(EXIT.ok, jsonText(report), '')
      return outcome(EXIT.ok, 'No migrated decisions were eligible to prune.\n', '')
    }
    writeReviewArtifacts({
      decisionsFile: artifacts.decisionsFile,
      explicitFile: artifacts.explicitFile,
      decisions,
      explicitMessages: artifacts.explicitMessages,
      writeExplicit: false
    })
    const report = {
      command: 'review',
      ok: true,
      action: 'prune',
      pruned: pruned.map(item => item.id)
    }
    if (parsed.json) return outcome(EXIT.ok, jsonText(report), '')
    return outcome(
      EXIT.ok,
      `Pruned ${pruned.length} migrated decision(s): ${pruned.map(item => item.id).join(', ')}\n`,
      ''
    )
  }

  if (parsed.write && !parsed.translate && !parsed.ignore && !parsed.defer && !parsed.prune) {
    if (!parsed.id) throw commandError('configuration', 'review --write requires a candidate id')
    if (!parsed.adapter) throw commandError('configuration', 'review --write requires --adapter')
    const selected = selectCandidates({ ...parsed, status: null }, analysis)
    for (const candidate of selected) {
      if (candidate.disposition !== STATUS_TRANSLATION_APPROVED) {
        throw commandError(
          'configuration',
          `candidate "${candidate.id}" must be translation-approved before review --write`
        )
      }
    }
    const plannedWrite = planWriteMigrations({
      root: config.root,
      adapter: parsed.adapter,
      candidates: selected,
      artifacts
    })
    const preview = humanWritePreview(plannedWrite.migrations)
    await confirmDecision(
      parsed,
      terminal,
      preview,
      'Write these proven-safe source migrations? [y/N] '
    )
    const decisions = [...artifacts.decisions]
    for (const item of plannedWrite.migrations) {
      const current = decisionForCandidate({ decisions }, item.candidate)
      const migrated = markDecisionMigrated(current)
      const index = decisions.findIndex(entry => entry.id === migrated.id)
      if (index === -1) decisions.push(migrated)
      else decisions[index] = migrated
    }
    const targets = [
      ...plannedWrite.files.map(file => ({ file: file.full, content: file.content })),
      {
        file: artifacts.decisionsFile,
        content: serializeDecisions(
          decisions.sort((left, right) => left.id.localeCompare(right.id))
        )
      }
    ]
    try {
      commitFiles(targets)
    } catch (error) {
      throw commandError('storage', error.message || String(error))
    }
    const report = {
      command: 'review',
      ok: true,
      action: 'write',
      written: plannedWrite.migrations.map(item => item.candidate.id),
      files: plannedWrite.files.map(file => file.relative),
      previews: plannedWrite.files.map(file => ({
        path: file.relative,
        content: file.content,
        diff: file.diff
      }))
    }
    if (parsed.json) return outcome(EXIT.ok, jsonText(report), '')
    return outcome(
      EXIT.ok,
      `${preview}Wrote proven-safe migrations for ${report.written.length} candidate(s).\n`,
      ''
    )
  }

  let decision = decisionFromParsed(parsed)
  if (!decision) {
    if (parsed.id && terminal.interactive && !parsed.json) {
      const [primary] = selectCandidates(parsed, analysis)
      decision = await promptInteractiveDecision(terminal, primary)
    } else {
      const status = parsed.status || STATUS_NEEDS_REVIEW
      let candidates
      if (status === STATUS_MIGRATED) {
        candidates = (analysis.migratedDynamicDecisions || []).map(item => ({
          id: item.id,
          expression: item.expression,
          location: { path: item.path },
          disposition: STATUS_MIGRATED,
          diagnostic: `Migrated to explicit key ${item.key}`,
          key: item.key
        }))
      } else {
        candidates = selectCandidates({ ...parsed, status }, analysis).map(publicCandidate)
      }
      const report = {
        command: 'review',
        ok: true,
        action: 'list',
        status,
        candidates
      }
      if (parsed.json) return outcome(EXIT.ok, jsonText(report), '')
      return outcome(EXIT.ok, humanList(candidates, status), '')
    }
  }

  const selected = selectCandidates(parsed, analysis)
  const unresolved = selected.filter(candidate => candidate.disposition === STATUS_NEEDS_REVIEW)
  if (unresolved.length !== selected.length) {
    const blocked = selected.find(candidate => candidate.disposition !== STATUS_NEEDS_REVIEW)
    throw commandError(
      'configuration',
      `candidate "${blocked.id}" is already "${blocked.disposition}" and cannot receive a new review decision`
    )
  }

  const planned = planDecisionWrites({
    candidates: selected,
    existingDecisions: artifacts.decisions,
    existingExplicitMessages: artifacts.explicitMessages,
    decision
  })

  if (parsed.write) {
    if (decision.decision !== 'translate') {
      throw commandError('configuration', 'review --write requires a Translate decision')
    }
    if (!parsed.adapter) throw commandError('configuration', 'review --write requires --adapter')
    const plannedWrite = planWriteMigrations({
      root: config.root,
      adapter: parsed.adapter,
      candidates: selected,
      artifacts: {
        ...artifacts,
        decisions: planned.decisions,
        explicitMessages: planned.explicitMessages
      },
      key: decision.key,
      source: decision.source
    })
    const preview = humanWritePreview(plannedWrite.migrations)
    await confirmDecision(
      parsed,
      terminal,
      `${decisionSummary(decision, planned.recorded.length)}\n${preview}`,
      'Record the Translate decision and write these proven-safe source migrations? [y/N] '
    )
    const migratedDecisions = planned.decisions.map(item => (
      planned.recorded.some(recorded => recorded.id === item.id)
        ? markDecisionMigrated(item)
        : item
    ))
    const targets = [
      ...plannedWrite.files.map(file => ({ file: file.full, content: file.content })),
      { file: artifacts.decisionsFile, content: serializeDecisions(migratedDecisions) },
      { file: artifacts.explicitFile, content: serializeExplicitMessages(planned.explicitMessages) }
    ]
    try {
      commitFiles(targets)
    } catch (error) {
      throw commandError('storage', error.message || String(error))
    }
    const report = {
      command: 'review',
      ok: true,
      action: 'write',
      written: plannedWrite.migrations.map(item => item.candidate.id),
      key: decision.key,
      source: decision.source,
      files: plannedWrite.files.map(file => file.relative)
    }
    if (parsed.json) return outcome(EXIT.ok, jsonText(report), '')
    return outcome(
      EXIT.ok,
      `${preview}Recorded translate and wrote proven-safe migrations for ${report.written.length} candidate(s).\n`,
      ''
    )
  }

  await confirmDecision(parsed, terminal, decisionSummary(decision, planned.recorded.length))
  writeReviewArtifacts({
    decisionsFile: artifacts.decisionsFile,
    explicitFile: artifacts.explicitFile,
    decisions: planned.decisions,
    explicitMessages: planned.explicitMessages,
    writeExplicit: decision.decision === 'translate'
  })

  const report = {
    command: 'review',
    ok: true,
    action: decision.decision,
    recorded: planned.recorded.map(item => item.id),
    ...(decision.decision === 'translate'
      ? { key: decision.key, source: decision.source }
      : {}),
    ...(decision.reason ? { reason: decision.reason } : {})
  }
  if (parsed.json) return outcome(EXIT.ok, jsonText(report), '')
  return outcome(
    EXIT.ok,
    `Recorded ${decision.decision} for ${planned.recorded.length} candidate(s): ${planned.recorded.map(item => item.id).join(', ')}\n`,
    ''
  )
}

async function review(args, terminal = createTerminal()) {
  let parsed
  try {
    parsed = parseReviewArgs(args)
  } catch (error) {
    return failure(error, false)
  }
  try {
    return await execute(parsed, terminal)
  } catch (error) {
    return failure(error, parsed.json)
  }
}

module.exports = {
  EXIT,
  createTerminal,
  parseReviewArgs,
  review
}
