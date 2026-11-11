const path = require('path')
const { REPRESENTATION_LOCALIZED_CALL } = require('./localized-call')
const { keyFor } = require('./store')
const { extractScript } = require('../myloader/extract-script')
const { extractHtml } = require('../myloader/extract-html')
const { extractVueScript } = require('../myloader/extract-vue-compat')
const { auditStyle } = require('../myloader/audit-style')

const ANALYSIS_REPORT_VERSION = 1

const SCRIPT_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'
])
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const STYLE_EXTENSIONS = new Set([
  '.css', '.scss', '.sass', '.less', '.styl', '.stylus'
])

const CAPABILITY_AUTOMATIC = 'automatically-runtime-localizable'
const CAPABILITY_LOCALIZED = 'already-localized'
const CAPABILITY_AUDIT = 'chinese-source-audit'
const DISPOSITION_UNRESOLVED = 'unresolved'
const DISPOSITION_NEEDS_REVIEW = 'needs-review'
const DISPOSITION_INTENTIONALLY_IGNORED = 'intentionally-ignored'
const STANDALONE_HTML_EXTENSIONS = new Set(['.html', '.htm'])
const AUDIT_KINDS = new Set([
  'static-html-text',
  'static-html-attribute',
  'css-generated-content',
  'css-preprocessor-candidate'
])

const CSS_PROVEN_DIAGNOSTIC =
  'Proven CSS generated content: Chinese static string in a content declaration'
const PREPROCESSOR_REVIEW_DIAGNOSTIC =
  'Conservative preprocessor review item: possible Chinese user-facing content without semantic proof'

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
      },
      chineseSourceAudit: {
        total: 0,
        unresolved: 0,
        needsReview: 0,
        intentionallyIgnored: 0
      }
    }
  }
}

function extensionOf(projectPath) {
  return path.posix.extname(String(projectPath).split('\\').join('/')).toLowerCase()
}

function styleLangFor(projectPath) {
  const ext = extensionOf(projectPath)
  if (ext === '.scss') return 'scss'
  if (ext === '.sass') return 'sass'
  if (ext === '.less') return 'less'
  if (ext === '.styl' || ext === '.stylus') return 'stylus'
  return 'css'
}

function sourceSurfaceFor(projectPath, block) {
  const ext = extensionOf(projectPath)
  if (STANDALONE_HTML_EXTENSIONS.has(ext)) return 'standalone-html'
  if (STYLE_EXTENSIONS.has(ext)) return styleLangFor(projectPath)
  if (ext === '.vue') {
    if (block === 'template') return 'vue-template'
    if (block === 'style') return 'vue-style'
    return 'vue-script'
  }
  if (TYPESCRIPT_EXTENSIONS.has(ext)) return 'typescript'
  return 'javascript'
}

function findingFrom(entry, location, capability, sourceSurface, extras = {}) {
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
  if (extras.disposition) finding.disposition = extras.disposition
  if (extras.ignoreReason) finding.ignoreReason = extras.ignoreReason
  if (extras.diagnostic) finding.diagnostic = extras.diagnostic
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
  const styles = auditStyle({
    source: file.source,
    resource: {
      projectPath: file.path,
      absolutePath,
      block: 'style',
      identity: `${file.path}::style`
    },
    config
  }).entries.map(entry => ({
    entry,
    sourceSurface: sourceSurfaceFor(file.path, 'style')
  }))
  return script.concat(template).concat(styles)
}

function collectStandaloneHtmlEntries(file, config) {
  const absolutePath = file.absolutePath || path.resolve(file.path)
  const resource = {
    projectPath: file.path,
    absolutePath,
    block: 'html',
    lang: 'html',
    identity: `${file.path}::html`
  }
  return extractHtml({ source: file.source, resource, config }).entries.map(entry => ({
    entry,
    sourceSurface: sourceSurfaceFor(file.path, 'html')
  }))
}

function collectStyleEntries(file, config) {
  const lang = styleLangFor(file.path)
  const absolutePath = file.absolutePath || path.resolve(file.path)
  const resource = {
    projectPath: file.path,
    absolutePath,
    block: 'style',
    lang,
    identity: `${file.path}::style[index=0;lang=${lang}]`
  }
  return auditStyle({ source: file.source, resource, config }).entries.map(entry => ({
    entry,
    sourceSurface: sourceSurfaceFor(file.path, 'style')
  }))
}

function entriesForFile(file, config) {
  const ext = extensionOf(file.path)
  if (SCRIPT_EXTENSIONS.has(ext)) return collectScriptEntries(file, config)
  if (ext === '.vue') return collectVueEntries(file, config)
  if (STANDALONE_HTML_EXTENSIONS.has(ext)) return collectStandaloneHtmlEntries(file, config)
  if (STYLE_EXTENSIONS.has(ext)) return collectStyleEntries(file, config)
  return []
}

function auditDisposition(entry, location) {
  if (entry.ignoreReason) return DISPOSITION_INTENTIONALLY_IGNORED
  if (location.kind === 'css-preprocessor-candidate') return DISPOSITION_NEEDS_REVIEW
  return DISPOSITION_UNRESOLVED
}

function auditDiagnostic(location) {
  if (location.kind === 'css-preprocessor-candidate') return PREPROCESSOR_REVIEW_DIAGNOSTIC
  if (location.kind === 'css-generated-content') return CSS_PROVEN_DIAGNOSTIC
  return undefined
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
      if (AUDIT_KINDS.has(location.kind) || sourceSurface === 'standalone-html') {
        const disposition = auditDisposition(entry, location)
        // Audit findings never receive localization keys (ADR-0007), even if a
        // legacy extractor still attached an i18n-key for webpack collect.
        const auditEntry = { ...entry, key: null }
        analysis.auditFindings.push(
          findingFrom(auditEntry, location, CAPABILITY_AUDIT, sourceSurface, {
            disposition,
            ignoreReason: entry.ignoreReason || undefined,
            diagnostic: auditDiagnostic(location)
          })
        )
        continue
      }
      analysis.runtimeMessages.push(
        findingFrom(entry, location, CAPABILITY_AUTOMATIC, sourceSurface)
      )
    }
  }
  const automatic = analysis.runtimeMessages.length
  const already = analysis.localizedCallFindings.length
  const audit = analysis.auditFindings.length
  const explicit = analysis.explicitRequiredFindings.length
  const intentionallyIgnored = analysis.auditFindings.filter(
    finding => finding.disposition === DISPOSITION_INTENTIONALLY_IGNORED
  ).length
  const needsReview = analysis.auditFindings.filter(
    finding => finding.disposition === DISPOSITION_NEEDS_REVIEW
  ).length
  const unresolved = analysis.auditFindings.filter(
    finding => finding.disposition === DISPOSITION_UNRESOLVED
  ).length
  analysis.coverage = {
    sourceDiscovery: { total: automatic + already + audit + explicit },
    runtimeLocalization: {
      total: automatic + already,
      automaticallyRuntimeLocalizable: automatic,
      alreadyLocalized: already
    },
    chineseSourceAudit: {
      total: audit,
      unresolved,
      needsReview,
      intentionallyIgnored
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
  CAPABILITY_LOCALIZED,
  CAPABILITY_AUDIT,
  DISPOSITION_UNRESOLVED,
  DISPOSITION_NEEDS_REVIEW,
  DISPOSITION_INTENTIONALLY_IGNORED
}
