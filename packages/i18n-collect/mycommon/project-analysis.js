const path = require('path')
const { REPRESENTATION_LOCALIZED_CALL } = require('./localized-call')
const { keyFor } = require('./store')
const { extractScript } = require('../myloader/extract-script')
const { extractHtml } = require('../myloader/extract-html')
const { extractVueScript } = require('../myloader/extract-vue-compat')

const ANALYSIS_REPORT_VERSION = 1

const SCRIPT_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'
])
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

const CAPABILITY_AUTOMATIC = 'automatically-runtime-localizable'
const CAPABILITY_LOCALIZED = 'already-localized'

function emptyAnalysis() {
  return {
    runtimeMessages: [],
    auditFindings: [],
    explicitRequiredFindings: [],
    localizedCallFindings: [],
    coverage: {
      sourceDiscovery: { total: 0 },
      runtimeLocalization: {
        total: 0,
        automaticallyRuntimeLocalizable: 0,
        alreadyLocalized: 0
      }
    }
  }
}

function extensionOf(projectPath) {
  return path.posix.extname(String(projectPath).split('\\').join('/')).toLowerCase()
}

function sourceSurfaceFor(projectPath, block) {
  const ext = extensionOf(projectPath)
  if (ext === '.vue') return block === 'template' ? 'vue-template' : 'vue-script'
  if (TYPESCRIPT_EXTENSIONS.has(ext)) return 'typescript'
  return 'javascript'
}

function findingFrom(entry, location, capability, sourceSurface) {
  const finding = {
    text: entry.value || entry.key || '',
    location: {
      path: location.path,
      start: { line: location.start.line, column: location.start.column },
      end: { line: location.end.line, column: location.end.column }
    },
    sourceSurface,
    semanticRole: location.kind,
    capability
  }
  if (entry.key) finding.key = entry.key
  return finding
}

function collectScriptEntries(file, config) {
  const resource = {
    projectPath: file.path,
    absolutePath: file.absolutePath || path.resolve(file.path),
    block: 'script',
    identity: `${file.path}::script`
  }
  return extractScript({ source: file.source, resource, config }).map(entry => ({
    entry,
    sourceSurface: sourceSurfaceFor(file.path, 'script')
  }))
}

function collectVueEntries(file, config) {
  const absolutePath = file.absolutePath || path.resolve(file.path)
  const scriptResource = {
    projectPath: file.path,
    absolutePath,
    block: 'script',
    lang: 'js',
    identity: `${file.path}::script[lang=js]`
  }
  const templateResource = {
    projectPath: file.path,
    absolutePath,
    block: 'template',
    lang: 'html',
    identity: `${file.path}::template[lang=html]`
  }
  const script = extractVueScript({ source: file.source, resource: scriptResource, config }).map(entry => ({
    entry,
    sourceSurface: sourceSurfaceFor(file.path, 'script')
  }))
  const template = extractHtml({ source: file.source, resource: templateResource, config }).entries.map(entry => ({
    entry,
    sourceSurface: sourceSurfaceFor(file.path, 'template')
  }))
  return script.concat(template)
}

function entriesForFile(file, config) {
  const ext = extensionOf(file.path)
  if (SCRIPT_EXTENSIONS.has(ext)) return collectScriptEntries(file, config)
  if (ext === '.vue') return collectVueEntries(file, config)
  return []
}

function classifyCollected(collected) {
  const analysis = emptyAnalysis()
  for (const item of collected) {
    const { entry, sourceSurface } = item
    const locations = entry.locations || []
    for (const location of locations) {
      if (entry.representation === REPRESENTATION_LOCALIZED_CALL) {
        analysis.localizedCallFindings.push(
          findingFrom(entry, location, CAPABILITY_LOCALIZED, sourceSurface)
        )
        continue
      }
      if (!entry.value) continue
      analysis.runtimeMessages.push(
        findingFrom(entry, location, CAPABILITY_AUTOMATIC, sourceSurface)
      )
    }
  }
  const automatic = analysis.runtimeMessages.length
  const already = analysis.localizedCallFindings.length
  const audit = analysis.auditFindings.length
  const explicit = analysis.explicitRequiredFindings.length
  analysis.coverage = {
    sourceDiscovery: { total: automatic + already + audit + explicit },
    runtimeLocalization: {
      total: automatic + already,
      automaticallyRuntimeLocalizable: automatic,
      alreadyLocalized: already
    }
  }
  return analysis
}

function compareFindings(left, right) {
  return left.location.path.localeCompare(right.location.path)
    || left.location.start.line - right.location.start.line
    || left.location.start.column - right.location.start.column
    || left.semanticRole.localeCompare(right.semanticRole)
    || left.text.localeCompare(right.text)
    || String(left.key || '').localeCompare(String(right.key || ''))
}

function sortFindings(findings) {
  return [...findings].sort(compareFindings)
}

function analyzeProject(input = {}) {
  if (!input || !Array.isArray(input.files)) {
    throw new TypeError('analyzeProject requires a files array')
  }
  const config = input.config || {}
  const collected = []
  for (const file of input.files) {
    if (!file || typeof file.path !== 'string' || typeof file.source !== 'string') {
      throw new TypeError('each file needs path and source strings')
    }
    collected.push(...entriesForFile(file, config))
  }
  const analysis = classifyCollected(collected)
  analysis.runtimeMessages = sortFindings(analysis.runtimeMessages)
  analysis.auditFindings = sortFindings(analysis.auditFindings)
  analysis.explicitRequiredFindings = sortFindings(analysis.explicitRequiredFindings)
  analysis.localizedCallFindings = sortFindings(analysis.localizedCallFindings)
  return analysis
}

function buildSourceCatalog(analysis) {
  const messages = new Map()
  for (const finding of analysis.runtimeMessages || []) {
    const key = finding.key || keyFor(finding.text)
    const prior = messages.get(key)
    if (prior != null && prior !== finding.text) {
      const error = new Error(
        `source catalog key "${key}" maps to incompatible source text`
      )
      error.kind = 'collection'
      throw error
    }
    messages.set(key, finding.text)
  }
  return Object.fromEntries([...messages.entries()].sort((left, right) => left[0].localeCompare(right[0])))
}

function analysisReport(analysis) {
  return {
    version: ANALYSIS_REPORT_VERSION,
    runtimeMessages: analysis.runtimeMessages,
    auditFindings: analysis.auditFindings,
    explicitRequiredFindings: analysis.explicitRequiredFindings,
    localizedCallFindings: analysis.localizedCallFindings,
    coverage: analysis.coverage
  }
}

module.exports = {
  ANALYSIS_REPORT_VERSION,
  analyzeProject,
  analysisReport,
  buildSourceCatalog,
  CAPABILITY_AUTOMATIC,
  CAPABILITY_LOCALIZED
}
