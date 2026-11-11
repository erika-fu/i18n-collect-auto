const fs = require('fs')
const path = require('path')
const { upgradeCatalogMetadata } = require('../mycommon/catalog')
const { catalogFiles, identityFiles, loadConfig } = require('../mycommon/config')
const { commitFiles, recoverCommits } = require('../mycommon/output')
const { ReplacementPlanner } = require('../mycommon/replacement-planner')
const { assertReplacementRuntime } = require('../mycommon/replacement-runtime')
const { parseTemplate } = require('../myloader/template-parser')

const EXIT = {
  ok: 0,
  configuration: 1,
  storage: 6,
  replacement: 7
}
const REPLACEMENTS_NAME = 'replacements.json'
const RESERVED_CATALOG_NAMES = new Set(['catalog.meta.json', REPLACEMENTS_NAME, 'translation-state.json'])
const AMBIGUOUS = 'occurrence identity is ambiguous'
const ORPHANED = 'orphaned occurrence is outside the current collection'
const ADAPTERS = ['vue2', 'vue3', 'js']

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

function failure(error, json) {
  const kind = error && EXIT[error.kind] != null ? error.kind : 'configuration'
  const message = error && error.message ? error.message : String(error)
  const stdout = json ? jsonText({ command: 'replace', failure: kind, message, ok: false }) : ''
  return outcome(EXIT[kind] == null ? EXIT.configuration : EXIT[kind], stdout, `${kind}: ${message}\n`)
}

function take(args, index, flag) {
  const next = args[index + 1]
  if (next === undefined || next.startsWith('-')) throw commandError('configuration', `${flag} requires a value`)
  return next
}

function parseReplaceArgs(args) {
  const parsed = { adapter: null, cwd: null, json: false, strict: false, write: false }
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
    } else if (flag === '--strict') {
      if (inline !== null) throw commandError('configuration', 'unknown option "--strict"')
      parsed.strict = true
    } else if (flag === '--write') {
      if (inline !== null) throw commandError('configuration', 'unknown option "--write"')
      parsed.write = true
    } else if (flag === '--cwd') parsed.cwd = value('--cwd')
    else if (flag === '--adapter') parsed.adapter = value('--adapter')
    else if (flag.startsWith('-')) throw commandError('configuration', `unknown option "${flag}"`)
    else throw commandError('configuration', `unexpected argument "${arg}"`)
  }
  if (!parsed.adapter) throw commandError('configuration', 'replace requires --adapter')
  if (!ADAPTERS.includes(parsed.adapter)) {
    throw commandError('configuration', `unknown adapter "${parsed.adapter}"; expected vue2, vue3, or js`)
  }
  return parsed
}

function readMetadata(root, config) {
  const relative = catalogFiles(config).metadata
  const file = path.join(root, relative)
  if (!fs.existsSync(file)) throw commandError('configuration', 'source catalog metadata is missing')
  let metadata
  try {
    metadata = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw commandError('configuration', 'source catalog metadata could not be read')
  }
  try {
    const upgraded = upgradeCatalogMetadata(metadata)
    if (!upgraded || !upgraded.entries || typeof upgraded.entries !== 'object' || Array.isArray(upgraded.entries)) {
      throw commandError('configuration', 'source catalog metadata is not a supported catalog schema')
    }
    return upgraded
  } catch (error) {
    if (error && error.kind === 'configuration') throw error
    throw commandError('configuration', error && error.message ? error.message : 'source catalog metadata is not a supported catalog schema')
  }
}

function positionBefore(left, right) {
  return left.line < right.line || (left.line === right.line && left.column < right.column)
}

function rangesOverlap(left, right) {
  if (!left || !right || left.path !== right.path) return false
  return positionBefore(left.start, right.end) && positionBefore(right.start, left.end)
}

function skipDetail(item, reason) {
  return {
    path: item.location.path,
    key: item.key,
    kind: item.location.kind,
    source: item.source,
    start: item.location.start,
    end: item.location.end,
    reason
  }
}

function readAmbiguities(root, config) {
  const file = path.join(root, identityFiles(config).ambiguities)
  if (!fs.existsSync(file)) return []
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw commandError('configuration', 'occurrence identity ambiguity report could not be read')
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.ambiguities)) {
    throw commandError('configuration', 'occurrence identity ambiguity report is not version 1')
  }
  return parsed.ambiguities.map(item => {
    const location = item && item.location
    if (!item || typeof item.source !== 'string' || typeof item.proposedKey !== 'string' || !location || typeof location.path !== 'string' || typeof location.kind !== 'string' || !location.start || !location.end) {
      throw commandError('configuration', 'occurrence identity ambiguity report is not version 1')
    }
    return item
  })
}

function withReportedAmbiguities(items, ambiguities) {
  return items.map(item => ({
    ...item,
    reportedAmbiguity: ambiguities.some(report => rangesOverlap(item.location, report.location))
  }))
}

function unrepresentedAmbiguities(items, ambiguities) {
  return ambiguities
    .filter(report => !items.some(item => rangesOverlap(item.location, report.location)))
    .map(report => skipDetail({
      key: report.proposedKey,
      source: report.source,
      location: report.location
    }, AMBIGUOUS))
}

function catalogItems(metadata) {
  const items = []
  for (const key of Object.keys(metadata.entries).sort()) {
    const entry = metadata.entries[key]
    if (!entry || typeof entry.source !== 'string' || !Array.isArray(entry.occurrences)) continue
    for (const occurrence of entry.occurrences) {
      const location = occurrence && occurrence.location
      if (!location || typeof location.path !== 'string') continue
      items.push({
        key,
        source: entry.source,
        location,
        status: entry.status === 'orphaned' ? 'orphaned' : 'active'
      })
    }
  }
  return items
}

function withoutOrphaned(items) {
  const held = []
  const open = []
  for (const item of items) {
    if (item.status === 'orphaned') held.push(skipDetail(item, ORPHANED))
    else open.push(item)
  }
  return { open, held }
}

function assertRuntime(root, adapter) {
  try {
    return assertReplacementRuntime(root, adapter)
  } catch (error) {
    throw commandError('configuration', error.message)
  }
}

function insideRoot(root, projectPath) {
  if (!projectPath || path.posix.isAbsolute(projectPath)) return null
  const full = path.resolve(root, projectPath)
  const relative = path.relative(root, full)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return full
}

function readSources(root, items) {
  const sources = new Map()
  for (const item of items) {
    const projectPath = item.location.path
    if (sources.has(projectPath)) continue
    const full = insideRoot(root, projectPath)
    if (!full || !fs.existsSync(full)) {
      sources.set(projectPath, null)
      continue
    }
    const stat = fs.statSync(full)
    sources.set(projectPath, stat.isFile() ? fs.readFileSync(full, 'utf8') : null)
  }
  return sources
}

function plannerResources(root, config, adapter, items, sources) {
  const templatePaths = new Set(items
    .filter(item => (
      item.location.kind === 'html-text' ||
      item.location.kind === 'html-attribute' ||
      item.location.kind === 'template-expression'
    ))
    .map(item => item.location.path))
  return new Map([...sources].map(([projectPath, source]) => {
    if (adapter === 'js' || source == null || !templatePaths.has(projectPath) || path.posix.extname(projectPath).toLowerCase() !== '.vue') {
      return [projectPath, source]
    }
    return [projectPath, {
      source,
      template: parseTemplate({
        source,
        resource: {
          absolutePath: path.resolve(root, projectPath),
          projectPath
        },
        standalone: false,
        config: { vueVersion: config.vueVersion }
      })
    }]
  }))
}

function recordedId(item) {
  return `${item.path}\0${item.key}\0${item.kind}\0${item.start.line}:${item.start.column}`
}

function replacementRelative(config) {
  return path.posix.join(config.catalogDir, REPLACEMENTS_NAME)
}

function sortDetails(items) {
  return [...items].sort((left, right) => {
    if (left.path !== right.path) return left.path < right.path ? -1 : 1
    if (left.start.line !== right.start.line) return left.start.line - right.start.line
    if (left.start.column !== right.start.column) return left.start.column - right.start.column
    return left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0
  })
}

function readRecorded(root, config) {
  const file = path.join(root, replacementRelative(config))
  if (!fs.existsSync(file)) return []
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw commandError('configuration', 'replacement metadata could not be read')
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.replacements)) {
    throw commandError('configuration', 'replacement metadata is not version 1')
  }
  return parsed.replacements
}

function reconcileRecorded(planned, sources, recorded) {
  const byId = new Map(recorded.map(item => [recordedId(item), item]))
  const skipped = []
  const recognized = [...planned.recognized]
  for (const item of planned.skipped) {
    const prior = byId.get(recordedId(item))
    const source = sources.get(item.path)
    if (prior && typeof source === 'string' && source.includes(prior.call)) {
      recognized.push({
        path: item.path,
        key: item.key,
        kind: item.kind,
        source: item.source,
        call: prior.call,
        start: item.start,
        end: item.end
      })
    } else skipped.push(item)
  }
  return { ...planned, skipped, recognized: sortDetails(recognized) }
}

function replacementEntry(item) {
  return {
    path: item.path,
    key: item.key,
    kind: item.kind,
    source: item.source,
    call: item.call,
    start: item.start,
    end: item.end
  }
}

function mergeRecorded(recorded, replacements, adapter) {
  const next = recorded.map(replacementEntry)
  const seen = new Set(next.map(recordedId))
  for (const item of replacements) {
    const entry = replacementEntry(item)
    const id = recordedId(entry)
    if (seen.has(id)) continue
    next.push(entry)
    seen.add(id)
  }
  next.sort((left, right) => {
    if (left.path !== right.path) return left.path < right.path ? -1 : 1
    if (left.start.line !== right.start.line) return left.start.line - right.start.line
    if (left.start.column !== right.start.column) return left.start.column - right.start.column
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  })
  return { version: 1, adapter, replacements: next }
}

function readRequired(file, label) {
  if (!fs.existsSync(file)) throw commandError('configuration', `${label} is missing`)
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw commandError('configuration', `${label} could not be read`)
  }
}

function catalogCommitTargets(root, config, replacementDocument) {
  const files = catalogFiles(config)
  const dir = path.join(root, config.catalogDir)
  let names
  try {
    names = fs.readdirSync(dir)
  } catch (error) {
    throw commandError('configuration', 'source catalog is missing')
  }
  const sourceName = path.posix.basename(files.messages)
  const extras = names
    .filter(name => name.endsWith('.json') && !RESERVED_CATALOG_NAMES.has(name) && name !== sourceName)
    .sort()
  const relatives = [
    files.messages,
    ...extras.map(name => path.posix.join(config.catalogDir, name)),
    files.metadata,
    replacementRelative(config)
  ]
  const replacementPath = replacementRelative(config)
  return relatives.map(relative => ({
    file: path.join(root, relative),
    relative,
    content: relative === replacementPath ? jsonText(replacementDocument) : readRequired(path.join(root, relative), relative)
  }))
}

function sourceCommitTargets(root, previews) {
  return [...previews]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map(preview => ({
      file: path.join(root, preview.path),
      relative: preview.path,
      content: preview.content
    }))
}

function writeReplacement(targets) {
  try {
    commitFiles(targets.map(target => ({ file: target.file, content: target.content })))
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    const code = error && error.code ? `${error.code}: ` : ''
    const lead = error && error.restored === false
      ? 'replacement files could not be restored after a write failure'
      : 'replacement files were restored after a write failure'
    throw commandError('storage', `${lead}: ${code}${message}`)
  }
}

function reportOf(parsed, planned, extra = {}) {
  return {
    command: 'replace',
    adapter: parsed.adapter,
    dryRun: !parsed.write,
    written: false,
    files: [],
    ok: true,
    strict: parsed.strict,
    replacements: planned.replacements,
    skipped: planned.skipped,
    recognized: planned.recognized,
    previews: planned.previews,
    ...extra
  }
}

function human(report) {
  const lead = report.dryRun
    ? `Dry run (${report.adapter}). No source or catalog file was modified.`
    : report.written
      ? `Wrote source, catalog, and replacement metadata (${report.adapter}).`
      : `No source changes (${report.adapter}). No source or catalog file was modified.`
  const lines = [
    lead,
    `Replacements: ${report.replacements.length}. Skipped: ${report.skipped.length}. Already localized: ${report.recognized.length}.`
  ]
  const paths = [...new Set([
    ...report.replacements.map(item => item.path),
    ...report.skipped.map(item => item.path),
    ...report.recognized.map(item => item.path),
    ...report.previews.map(item => item.path)
  ])].sort()
  for (const file of paths) {
    lines.push('')
    lines.push(file)
    const events = [
      ...report.replacements.filter(item => item.path === file).map(item => ({ ...item, type: 'replace' })),
      ...report.skipped.filter(item => item.path === file).map(item => ({ ...item, type: 'skip' })),
      ...report.recognized.filter(item => item.path === file).map(item => ({ ...item, type: 'keep' }))
    ].sort((left, right) => left.start.line - right.start.line || left.start.column - right.start.column || (left.type < right.type ? -1 : 1))
    for (const event of events) {
      const at = `${event.start.line}:${event.start.column}`
      if (event.type === 'replace') lines.push(`  replace ${at} ${event.kind} ${JSON.stringify(event.source)} with ${event.call}`)
      else if (event.type === 'skip') lines.push(`  skip ${at} ${event.kind} ${JSON.stringify(event.source)}: ${event.reason}`)
      else lines.push(`  keep ${at} ${event.kind} ${JSON.stringify(event.source)}: already localized`)
    }
    const preview = report.previews.find(item => item.path === file)
    if (preview) {
      lines.push('  ---')
      lines.push(preview.content.endsWith('\n') ? preview.content.slice(0, -1) : preview.content)
    }
  }
  lines.push('')
  return lines.join('\n')
}

function replace(args) {
  const json = args.includes('--json')
  let parsed
  try {
    parsed = parseReplaceArgs(args)
  } catch (error) {
    return failure(error, json)
  }
  const root = path.resolve(parsed.cwd || process.cwd())
  try {
    const config = loadConfig({ root })
    recoverCommits(path.join(config.root, config.catalogDir))
    const metadata = readMetadata(config.root, config)
    const items = catalogItems(metadata)
    const active = withoutOrphaned(items)
    const ambiguities = readAmbiguities(config.root, config)
    const sources = readSources(config.root, items)
    const recorded = readRecorded(config.root, config)
    const occurrences = withReportedAmbiguities(active.open, ambiguities)
    const planner = new ReplacementPlanner({
      adapter: parsed.adapter,
      styleExtensions: config.styleExtensions,
      runtime: assertRuntime(config.root, parsed.adapter)
    })
    const planned = reconcileRecorded(planner.plan({
      occurrences,
      resources: plannerResources(config.root, config, parsed.adapter, occurrences, sources)
    }), sources, recorded)
    planned.skipped = sortDetails([
      ...planned.skipped,
      ...active.held,
      ...unrepresentedAmbiguities(active.open, ambiguities)
    ])
    if (parsed.strict && planned.skipped.length > 0) {
      const report = reportOf(parsed, planned, {
        ok: false,
        failure: 'replacement',
        message: 'skipped candidates fail strict mode'
      })
      const stdout = parsed.json ? jsonText(report) : human(report)
      return outcome(EXIT.replacement, stdout, 'replacement: skipped candidates fail strict mode\n')
    }
    if (!parsed.write || planned.replacements.length === 0) {
      const report = reportOf(parsed, planned)
      return outcome(EXIT.ok, parsed.json ? jsonText(report) : human(report), '')
    }
    const targets = [
      ...catalogCommitTargets(config.root, config, mergeRecorded(recorded, planned.replacements, parsed.adapter)),
      ...sourceCommitTargets(config.root, planned.previews)
    ]
    writeReplacement(targets)
    const report = reportOf(parsed, planned, { written: true, files: targets.map(target => target.relative) })
    return outcome(EXIT.ok, parsed.json ? jsonText(report) : human(report), '')
  } catch (error) {
    return failure(error, parsed.json)
  }
}

module.exports = { EXIT, replace }
