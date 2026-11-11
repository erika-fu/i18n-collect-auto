const fs = require('fs')
const path = require('path')
const { analyzeProject } = require('../mycommon/project-analysis')
const { clearCollectionOverrides, loadConfig, setCollectionOverrides } = require('../mycommon/config')
const { isResourceIncluded } = require('../myloader/resource')

const EXIT = {
  ok: 0,
  configuration: 1,
  incomplete: 2,
  collection: 2
}

const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
  '.vue', '.html', '.htm',
  '.css', '.scss', '.sass', '.less', '.styl', '.stylus'
])

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.cache'
])

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
    ? jsonText({ command: 'check', failure: kind, message, ok: false })
    : ''
  return outcome(EXIT[kind], stdout, `${kind}: ${message}\n`)
}

function take(args, index, flag) {
  const next = args[index + 1]
  if (next === undefined || next.startsWith('-')) throw commandError('configuration', `${flag} requires a value`)
  return next
}

function parseCheckArgs(args) {
  const parsed = {
    contextFilters: undefined,
    cwd: null,
    exclude: undefined,
    include: undefined,
    json: false
  }
  for (let index = 0; index < args.length; index++) {
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
    } else if (flag === '--cwd') parsed.cwd = value('--cwd')
    else if (flag === '--include') {
      if (!parsed.include) parsed.include = []
      parsed.include.push(value('--include'))
    } else if (flag === '--exclude') {
      if (!parsed.exclude) parsed.exclude = []
      parsed.exclude.push(value('--exclude'))
    } else if (flag === '--context-filter') {
      if (!parsed.contextFilters) parsed.contextFilters = []
      parsed.contextFilters.push(value('--context-filter'))
    } else if (flag.startsWith('-')) throw commandError('configuration', `unknown option "${flag}"`)
    else throw commandError('configuration', `unexpected argument "${arg}"`)
  }
  return parsed
}

function listSourceFiles(root, config) {
  const files = []
  const visit = directory => {
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      return
    }
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        visit(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const projectPath = path.relative(root, absolute).split(path.sep).join('/')
      const extension = path.posix.extname(projectPath).toLowerCase()
      if (!SOURCE_EXTENSIONS.has(extension)) continue
      if (!isResourceIncluded(projectPath, config)) continue
      files.push({ absolute, projectPath })
    }
  }
  visit(root)
  return files.sort((left, right) => left.projectPath.localeCompare(right.projectPath))
}

function check(args) {
  let parsed
  try {
    parsed = parseCheckArgs(args)
  } catch (error) {
    return failure(error, false)
  }
  const root = path.resolve(parsed.cwd || process.cwd())
  try {
    const overrides = {}
    if (parsed.include) overrides.include = parsed.include
    if (parsed.exclude) overrides.exclude = parsed.exclude
    if (parsed.contextFilters) overrides.contextFilters = parsed.contextFilters
    if (Object.keys(overrides).length) setCollectionOverrides(overrides)

    const config = loadConfig({ root })
    const sources = listSourceFiles(config.root, config).map(file => ({
      path: file.projectPath,
      absolutePath: file.absolute,
      source: fs.readFileSync(file.absolute, 'utf8')
    }))
    const analysis = analyzeProject({ files: sources, config })
    const unresolved = analysis.coverage.chineseSourceAudit.unresolved
    const needsReview = analysis.coverage.chineseSourceAudit.needsReview || 0
    const blocking = unresolved + needsReview
    const ok = blocking === 0
    const summary = {
      command: 'check',
      ok,
      scannedFiles: sources.length,
      coverage: analysis.coverage,
      chineseSourceAudit: analysis.coverage.chineseSourceAudit,
      auditFindings: analysis.auditFindings
    }
    if (!ok) {
      const parts = []
      if (unresolved > 0) parts.push(`${unresolved} unresolved`)
      if (needsReview > 0) parts.push(`${needsReview} needs-review`)
      const message =
        `project localization completeness failed: ${parts.join(', ')} Chinese source audit finding(s)`
      if (parsed.json) {
        return outcome(
          EXIT.incomplete,
          jsonText({ ...summary, failure: 'incomplete', message }),
          `incomplete: ${message}\n`
        )
      }
      return outcome(EXIT.incomplete, '', `incomplete: ${message}\n`)
    }
    if (parsed.json) return outcome(EXIT.ok, jsonText(summary), '')
    return outcome(
      EXIT.ok,
      `check: complete; source discovery ${analysis.coverage.sourceDiscovery.total}; unresolved audit ${unresolved}; needs-review ${needsReview}\n`,
      ''
    )
  } catch (error) {
    return failure(error, parsed.json)
  } finally {
    clearCollectionOverrides()
  }
}

module.exports = {
  EXIT,
  check,
  parseCheckArgs
}
