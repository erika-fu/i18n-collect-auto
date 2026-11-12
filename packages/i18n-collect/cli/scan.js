const fs = require('fs')
const path = require('path')
const {
  analysisReport,
  analyzeProject,
  buildSourceCatalog
} = require('../mycommon/project-analysis')
const { clearCollectionOverrides, loadConfig, setCollectionOverrides } = require('../mycommon/config')
const {
  ANALYSIS_REPORT_FILE,
  SOURCE_CATALOG_FILE,
  analysisReportPath,
  sourceCatalogPath
} = require('../mycommon/formal-outputs')
const { commitFiles, json } = require('../mycommon/output')
const { isResourceIncluded } = require('../myloader/resource')

const EXIT = {
  ok: 0,
  configuration: 1,
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
    ? jsonText({ command: 'scan', failure: kind, message, ok: false })
    : ''
  return outcome(EXIT[kind], stdout, `${kind}: ${message}\n`)
}

function take(args, index, flag) {
  const next = args[index + 1]
  if (next === undefined || next.startsWith('-')) throw commandError('configuration', `${flag} requires a value`)
  return next
}

function parseScanArgs(args) {
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

function scan(args) {
  let parsed
  try {
    parsed = parseScanArgs(args)
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
    if (analysis.explicitRequiredFindings.length > 0) {
      const sample = analysis.explicitRequiredFindings
        .slice(0, 5)
        .map(item => {
          const at = `${item.location.path}:${item.location.start.line}:${item.location.start.column}`
          return `  ${item.reason}: ${JSON.stringify(item.text)} at ${at}`
        })
        .join('\n')
      const more = analysis.explicitRequiredFindings.length > 5
        ? `\n  ... and ${analysis.explicitRequiredFindings.length - 5} more`
        : ''
      throw commandError(
        'collection',
        `scan rejected ${analysis.explicitRequiredFindings.length} explicit-required finding(s); migrate them to explicit-messages.json and static localized calls\n${sample}${more}`
      )
    }
    const catalog = buildSourceCatalog(analysis)
    const report = analysisReport(analysis)
    const sourceCatalog = sourceCatalogPath(config)
    const analysisReportFile = analysisReportPath(config)
    // Scan owns only the formal pair; dictionary dual-write stays on Webpack collect.
    // Same atomic journal path as collect via commitFiles.
    commitFiles([
      { file: path.resolve(config.root, sourceCatalog), content: json(catalog) },
      { file: path.resolve(config.root, analysisReportFile), content: json(report) }
    ])

    const summary = {
      command: 'scan',
      ok: true,
      sourceCatalog,
      analysisReport: analysisReportFile,
      scannedFiles: sources.length,
      coverage: analysis.coverage
    }
    if (parsed.json) return outcome(EXIT.ok, jsonText(summary), '')
    return outcome(
      EXIT.ok,
      `scan: ${sources.length} file(s); source discovery ${analysis.coverage.sourceDiscovery.total}; runtime localization ${analysis.coverage.runtimeLocalization.total}\n`,
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
  scan,
  parseScanArgs,
  ANALYSIS_REPORT_FILE,
  SOURCE_CATALOG_FILE
}
