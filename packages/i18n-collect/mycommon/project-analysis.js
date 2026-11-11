const path = require('path')
const { REPRESENTATION_LOCALIZED_CALL } = require('./localized-call')
const { messageContract, readExplicitMessages, referenceMessage } = require('./catalog')
const { identityFiles } = require('./config')
const { keyFor } = require('./store')
const { scanCompleteStaticCopyPolicy } = require('./complete-static-copy-policy')
const { extractScript } = require('../myloader/extract-script')
const { extractHtml } = require('../myloader/extract-html')
const { extractVueScript } = require('../myloader/extract-vue-compat')
const { auditStyle } = require('../myloader/audit-style')

const HASH_DICTIONARY_KEY = /^[a-f0-9]{32}$/

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
const CAPABILITY_EXPLICIT_REQUIRED = 'explicit-required'
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
      },
      explicitRequired: { total: 0 }
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
  if (extras.reason) finding.reason = extras.reason
  if (extras.source) finding.source = extras.source
  if (extras.paramsKind) finding.paramsKind = extras.paramsKind
  if (extras.paramNames) finding.paramNames = extras.paramNames
  return finding
}

function collectionFailure(message) {
  const error = new Error(message)
  error.kind = 'collection'
  return error
}

function sameParamSet(actual, expected) {
  const left = [...new Set(actual || [])].sort()
  const right = [...new Set(expected || [])].sort()
  return left.length === right.length && left.every((name, index) => name === right[index])
}

function callParamError(finding, placeholders) {
  const kind = finding.paramsKind || 'none'
  if (kind === 'dynamic') {
    return placeholders.length > 0 ? 'dynamic-params' : null
  }
  const names = kind === 'static' ? (finding.paramNames || []) : []
  return sameParamSet(names, placeholders) ? null : 'placeholder-mismatch'
}

function unusedMessage(errors) {
  const noun = errors.length === 1 ? 'declaration' : 'declarations'
  const lines = [`i18n-collect failed: ${errors.length} unused explicit message ${noun}`]
  for (const error of errors) {
    lines.push(`  "${error.key}" is declared in the explicit message manifest but never referenced by a static localized call`)
  }
  lines.push('  Remove the unused declaration or add a static t()/$t()/this.$t() call that references it.')
  return lines.join('\n')
}

function loadExplicitMessages(input, config) {
  if (Array.isArray(input.explicitMessages)) return input.explicitMessages
  if (!config || !config.root || !config.catalogDir) return []
  const file = path.resolve(config.root, identityFiles(config).explicitMessages)
  return readExplicitMessages(file)
}

function loadExternalKeys(input, config) {
  if (Array.isArray(input.externalKeys)) return input.externalKeys
  if (config && Array.isArray(config.externalKeys)) return config.externalKeys
  return []
}

function validateAndBindExplicitMessages(analysis, explicitMessages, externalKeys) {
  const external = new Set(externalKeys || [])
  const explicitByKey = new Map((explicitMessages || []).map(item => [item.key, item]))
  const automaticByKey = new Map()
  for (const finding of analysis.runtimeMessages) {
    const key = finding.key || keyFor(finding.text)
    const prior = automaticByKey.get(key)
    if (prior != null && prior !== finding.text) {
      throw collectionFailure(
        `hash collision for key "${key}": ${JSON.stringify(prior)} vs ${JSON.stringify(finding.text)}`
      )
    }
    automaticByKey.set(key, finding.text)
  }

  const referenceErrors = []
  const unusedErrors = []
  const referencedExplicit = new Set()

  for (const finding of analysis.localizedCallFindings) {
    const key = finding.key
    if (!key || external.has(key) || HASH_DICTIONARY_KEY.test(key)) continue

    const declared = explicitByKey.get(key)
    const automatic = automaticByKey.get(key)
    if (!declared && automatic == null) {
      referenceErrors.push({ key, reason: 'unknown', location: finding.location })
      continue
    }
    if (declared && automatic != null && declared.source !== automatic) {
      referenceErrors.push({ key, reason: 'source-mismatch', location: finding.location })
      continue
    }

    const source = declared ? declared.source : automatic
    if (declared) referencedExplicit.add(key)
    const placeholders = messageContract(source).placeholders
    const paramError = callParamError(finding, placeholders)
    if (paramError) {
      referenceErrors.push({ key, reason: paramError, location: finding.location })
      continue
    }
    finding.source = source
  }

  for (const item of explicitMessages || []) {
    if (!referencedExplicit.has(item.key)) {
      unusedErrors.push({ key: item.key, reason: 'unused' })
    }
  }

  if (referenceErrors.length) {
    throw collectionFailure(referenceMessage(referenceErrors))
  }
  if (unusedErrors.length) {
    throw collectionFailure(unusedMessage(unusedErrors))
  }
}

function isRuntimeLocalizablePolicyPath(projectPath) {
  const ext = extensionOf(projectPath)
  return SCRIPT_EXTENSIONS.has(ext) || ext === '.vue'
}

function policyMatchKey(pathValue, kind, text, line) {
  return [pathValue, kind, text, line].join('\0')
}

function explicitRequiredFromPolicy(files, config) {
  const policyFiles = files.filter(file => isRuntimeLocalizablePolicyPath(file.path))
  if (!policyFiles.length) return { findings: [], matchKeys: new Set() }
  const violations = scanCompleteStaticCopyPolicy(policyFiles, {
    vueVersion: config.vueVersion,
    attributeAllowlist: config.attributeAllowlist
  })
  const findings = []
  const matchKeys = new Set()
  for (const item of violations) {
    if (AUDIT_KINDS.has(item.kind)) continue
    matchKeys.add(policyMatchKey(item.path, item.kind, item.text, item.start.line))
    findings.push({
      text: item.text,
      location: {
        path: item.path,
        start: { line: item.start.line, column: item.start.column },
        end: { line: item.end.line, column: item.end.column }
      },
      sourceSurface: sourceSurfaceFor(item.path, item.kind === 'html-text' || item.kind === 'html-attribute'
        ? 'template'
        : 'script'),
      semanticRole: item.kind,
      capability: CAPABILITY_EXPLICIT_REQUIRED,
      reason: item.reason
    })
  }
  return { findings, matchKeys }
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

function classifyCollected(collected, explicitRequired = { findings: [], matchKeys: new Set() }) {
  const analysis = emptyAnalysis()
  analysis.explicitRequiredFindings.push(...explicitRequired.findings)
  for (const item of collected) {
    const { entry, sourceSurface } = item
    const locations = entry.locations || []
    for (const location of locations) {
      if (entry.representation === REPRESENTATION_LOCALIZED_CALL) {
        analysis.localizedCallFindings.push(
          findingFrom(entry, location, CAPABILITY_LOCALIZED, sourceSurface, {
            paramsKind: entry.paramsKind || 'none',
            paramNames: Array.isArray(entry.paramNames) ? entry.paramNames : []
          })
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
      const matchKey = policyMatchKey(
        location.path,
        location.kind,
        entry.value,
        location.start.line
      )
      if (explicitRequired.matchKeys.has(matchKey)) {
        // Already reported from the complete-static-copy policy scan; do not
        // treat the fragment as independently runtime-localizable.
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
    },
    explicitRequired: { total: explicit }
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
  const explicitRequired = explicitRequiredFromPolicy(input.files, config)
  const analysis = classifyCollected(collected, explicitRequired)
  analysis.runtimeMessages = sortFindings(analysis.runtimeMessages)
  analysis.auditFindings = sortFindings(analysis.auditFindings)
  analysis.explicitRequiredFindings = sortFindings(analysis.explicitRequiredFindings)
  analysis.localizedCallFindings = sortFindings(analysis.localizedCallFindings)
  const explicitMessages = loadExplicitMessages(input, config)
  const externalKeys = loadExternalKeys(input, config)
  validateAndBindExplicitMessages(analysis, explicitMessages, externalKeys)
  return analysis
}

function buildSourceCatalog(analysis) {
  const messages = new Map()
  for (const finding of analysis.runtimeMessages || []) {
    const key = finding.key || keyFor(finding.text)
    const prior = messages.get(key)
    if (prior != null && prior !== finding.text) {
      throw collectionFailure(
        `hash collision for key "${key}": ${JSON.stringify(prior)} vs ${JSON.stringify(finding.text)}`
      )
    }
    messages.set(key, finding.text)
  }
  for (const finding of analysis.localizedCallFindings || []) {
    if (!finding.key || finding.source == null) continue
    const prior = messages.get(finding.key)
    if (prior != null && prior !== finding.source) {
      throw collectionFailure(
        `hash collision for key "${finding.key}": ${JSON.stringify(prior)} vs ${JSON.stringify(finding.source)}`
      )
    }
    messages.set(finding.key, finding.source)
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
  CAPABILITY_EXPLICIT_REQUIRED,
  DISPOSITION_UNRESOLVED,
  DISPOSITION_NEEDS_REVIEW,
  DISPOSITION_INTENTIONALLY_IGNORED
}
