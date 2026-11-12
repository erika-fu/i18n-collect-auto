const fs = require('fs')
const path = require('path')
const { loadConfig } = require('../mycommon/config')
const { commitFiles } = require('../mycommon/output')
const { ReplacementPlanner } = require('../mycommon/replacement-planner')
const { assertReplacementRuntime } = require('../mycommon/replacement-runtime')
const {
  prepareSourceReplacement
} = require('../mycommon/source-catalog-freshness')
const { parseTemplate } = require('../myloader/template-parser')

const EXIT = {
  ok: 0,
  configuration: 1,
  collection: 2,
  storage: 6,
  replacement: 7
}
const ADAPTERS = ['vue2', 'vue3', 'js']
const STALE_SOURCE = 'source changed between planning and write'

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

function sortDetails(items) {
  return [...items].sort((left, right) => {
    if (left.path !== right.path) return left.path < right.path ? -1 : 1
    if (left.start.line !== right.start.line) return left.start.line - right.start.line
    if (left.start.column !== right.start.column) return left.start.column - right.start.column
    return left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0
  })
}

function planReplacement(root, config, adapter, occurrences, runtime) {
  const sources = readSources(root, occurrences)
  const planner = new ReplacementPlanner({
    adapter,
    styleExtensions: config.styleExtensions,
    runtime
  })
  const planned = planner.plan({
    occurrences,
    resources: plannerResources(root, config, adapter, occurrences, sources)
  })
  planned.skipped = sortDetails(planned.skipped)
  planned.recognized = sortDetails(planned.recognized)
  planned.replacements = sortDetails(planned.replacements)
  return { planned, sources }
}

function previewFingerprint(planned) {
  return JSON.stringify({
    replacements: planned.replacements,
    skipped: planned.skipped,
    recognized: planned.recognized,
    previews: planned.previews
  })
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
    ? `Dry run (${report.adapter}). No source, catalog, audit, or metadata file was modified.`
    : report.written
      ? `Wrote source files (${report.adapter}). Catalogs and replacement metadata were not modified.`
      : `No source changes (${report.adapter}). No source, catalog, audit, or metadata file was modified.`
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
    const prepared = prepareSourceReplacement(config.root, config)
    const runtime = assertRuntime(config.root, parsed.adapter)
    const { planned } = planReplacement(
      config.root,
      config,
      parsed.adapter,
      prepared.occurrences,
      runtime
    )
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

    const refreshed = prepareSourceReplacement(config.root, config)
    const rechecked = planReplacement(
      config.root,
      config,
      parsed.adapter,
      refreshed.occurrences,
      runtime
    )
    if (previewFingerprint(rechecked.planned) !== previewFingerprint(planned)) {
      throw commandError('replacement', STALE_SOURCE)
    }
    const targets = sourceCommitTargets(config.root, rechecked.planned.previews)
    writeReplacement(targets)
    const report = reportOf(parsed, rechecked.planned, {
      written: true,
      files: targets.map(target => target.relative)
    })
    return outcome(EXIT.ok, parsed.json ? jsonText(report) : human(report), '')
  } catch (error) {
    return failure(error, parsed.json)
  }
}

module.exports = { EXIT, replace }
