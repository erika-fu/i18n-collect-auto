const fs = require('fs')
const path = require('path')
const { CATALOG_VERSION } = require('../mycommon/catalog')
const { catalogFiles, loadConfig } = require('../mycommon/config')
const { commitFiles, recoverCommits } = require('../mycommon/output')
const { SCRIPT_EXTENSIONS, exportsLocalizationFunction, planPreview, runtimeCalls } = require('../mycommon/replace-preview')

const EXIT = {
  ok: 0,
  configuration: 1,
  storage: 6,
  replacement: 7
}
const REPLACEMENTS_NAME = 'replacements.json'
const RESERVED_CATALOG_NAMES = new Set(['catalog.meta.json', REPLACEMENTS_NAME, 'translation-state.json'])
const ADAPTERS = ['vue2', 'vue3', 'js']
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'coverage'])
const RUNTIME = {
  vue2: 'vue2 adapter requires vue-i18n 8 in package.json and an existing Vue.use(VueI18n) or new VueI18n(...) call. This command does not install dependencies or rewrite application bootstrap.',
  vue3: 'vue3 adapter requires vue-i18n 9 or newer in package.json and an existing createI18n(...) call. This command does not install dependencies or rewrite application bootstrap.',
  js: 'js adapter requires an existing module that exports a localization function named t. This command does not rewrite application bootstrap.'
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
  if (!metadata || metadata.version !== CATALOG_VERSION || !metadata.entries || typeof metadata.entries !== 'object' || Array.isArray(metadata.entries)) {
    throw commandError('configuration', 'source catalog metadata is not version 1')
  }
  return metadata
}

function catalogItems(metadata) {
  const items = []
  for (const key of Object.keys(metadata.entries).sort()) {
    const entry = metadata.entries[key]
    if (!entry || typeof entry.source !== 'string' || !Array.isArray(entry.locations)) continue
    for (const location of entry.locations) {
      if (!location || typeof location.path !== 'string') continue
      items.push({ key, source: entry.source, location })
    }
  }
  return items
}

function walkFiles(directory, files) {
  let names
  try {
    names = fs.readdirSync(directory)
  } catch (error) {
    return
  }
  for (const name of names) {
    if (SKIP_DIRECTORIES.has(name)) continue
    const full = path.join(directory, name)
    let stat
    try {
      stat = fs.statSync(full)
    } catch (error) {
      continue
    }
    if (stat.isDirectory()) walkFiles(full, files)
    else files.push(full)
  }
}

function majorVersion(spec) {
  const match = String(spec || '').match(/\d+/)
  return match ? Number(match[0]) : null
}

function packageVersion(root, name) {
  const file = path.join(root, 'package.json')
  if (!fs.existsSync(file)) return null
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }
    return deps[name] || null
  } catch (error) {
    return null
  }
}

function sourceText(file) {
  const extension = path.extname(file).toLowerCase()
  if (extension === '.vue') {
    const match = fs.readFileSync(file, 'utf8').match(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/i)
    return match ? match[2] : ''
  }
  if (SCRIPT_EXTENSIONS.has(extension)) return fs.readFileSync(file, 'utf8')
  return null
}

function projectRuntime(root) {
  const found = { vue2: false, vue3: false }
  const files = []
  walkFiles(root, files)
  for (const file of files) {
    const text = sourceText(file)
    if (!text || !text.trim()) continue
    const calls = runtimeCalls(text)
    found.vue2 = found.vue2 || calls.vue2
    found.vue3 = found.vue3 || calls.vue3
  }
  return found
}

function projectExportsT(root) {
  const files = []
  walkFiles(root, files)
  return files.some(file => {
    const text = sourceText(file)
    if (text == null || !/\bt\b/.test(text)) return false
    return exportsLocalizationFunction(text)
  })
}

function assertRuntime(root, adapter) {
  if (adapter === 'js') {
    if (!projectExportsT(root)) throw commandError('configuration', RUNTIME.js)
    return
  }
  const version = majorVersion(packageVersion(root, 'vue-i18n'))
  const runtime = projectRuntime(root)
  if (adapter === 'vue2') {
    if (version !== 8 || !runtime.vue2) throw commandError('configuration', RUNTIME.vue2)
    return
  }
  if (version == null || version < 9 || !runtime.vue3) throw commandError('configuration', RUNTIME.vue3)
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
    assertRuntime(config.root, parsed.adapter)
    const items = catalogItems(metadata)
    const sources = readSources(config.root, items)
    const recorded = readRecorded(config.root, config)
    const planned = reconcileRecorded(planPreview({
      adapter: parsed.adapter,
      items,
      sources,
      styleExtensions: new Set(config.styleExtensions.map(extension => String(extension).toLowerCase()))
    }), sources, recorded)
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
