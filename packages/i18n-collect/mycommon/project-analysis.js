const fs = require('fs')
const path = require('path')
const { REPRESENTATION_LOCALIZED_CALL } = require('./localized-call')
const { messageContract, readExplicitMessages, referenceMessage } = require('./catalog')
const { identityFiles } = require('./config')
const {
  applyDynamicMessageDecisions,
  normalizeDecision,
  readDynamicMessageDecisions
} = require('./dynamic-message-decisions')
const { keyFor } = require('./store')
const {
  discoverDynamicMessageCandidates
} = require('./complete-static-copy-policy')
const { extractScript } = require('../myloader/extract-script')
const { extractHtml } = require('../myloader/extract-html')
const { extractVueScriptBlocks } = require('../myloader/extract-vue-compat')
const { auditStyle } = require('../myloader/audit-style')

const HASH_DICTIONARY_KEY = /^[a-f0-9]{32}$/

const ANALYSIS_REPORT_VERSION = 2
const SOURCE_CATALOG_VERSION = 1

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
const CAPABILITY_EXPLICIT_LOCALIZATION_REQUIRED = 'explicit-localization-required'
const DISPOSITION_UNRESOLVED = 'unresolved'
const DISPOSITION_NEEDS_REVIEW = 'needs-review'
const DISPOSITION_INTENTIONALLY_IGNORED = 'intentionally-ignored'
const DISPOSITION_TRANSLATION_APPROVED = 'translation-approved'
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
    dynamicMessageCandidates: [],
    localizedCallFindings: [],
    diagnostics: [],
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
      dynamicMessageCandidates: {
        total: 0,
        needsReview: 0,
        intentionallyIgnored: 0,
        translationApproved: 0,
        deferred: 0,
        migrated: 0
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
  if (extras.resourceIdentity) finding.resourceIdentity = extras.resourceIdentity
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

function loadDynamicMessageDecisions(input, config) {
  if (Array.isArray(input.dynamicMessageDecisions)) {
    return input.dynamicMessageDecisions.map((item, index) => normalizeDecision(item, index))
  }
  if (!config || !config.root || !config.catalogDir) return []
  const file = path.resolve(config.root, identityFiles(config).dynamicMessageDecisions)
  return readDynamicMessageDecisions(file)
}

function refreshDynamicCoverage(analysis) {
  const candidates = analysis.dynamicMessageCandidates
  analysis.coverage.dynamicMessageCandidates = {
    total: candidates.length,
    needsReview: candidates.filter(candidate => candidate.disposition === DISPOSITION_NEEDS_REVIEW).length,
    intentionallyIgnored: candidates.filter(
      candidate => candidate.disposition === DISPOSITION_INTENTIONALLY_IGNORED
    ).length,
    translationApproved: candidates.filter(
      candidate => candidate.disposition === DISPOSITION_TRANSLATION_APPROVED
    ).length,
    deferred: candidates.filter(candidate => candidate.decision === 'defer').length,
    migrated: Array.isArray(analysis.migratedDynamicDecisions) ? analysis.migratedDynamicDecisions.length : 0
  }
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

function validateAndBindExplicitMessages(analysis, explicitMessages, externalKeys, pendingExplicitKeys = new Set()) {
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
    if (!referencedExplicit.has(item.key) && !pendingExplicitKeys.has(item.key)) {
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

function dynamicCandidatesFromPolicy(files, config) {
  const policyFiles = files.filter(file => isRuntimeLocalizablePolicyPath(file.path))
  if (!policyFiles.length) return { candidates: [], matchKeys: new Set() }
  const discovered = discoverDynamicMessageCandidates(policyFiles, {
    vueVersion: config.vueVersion,
    attributeAllowlist: config.attributeAllowlist
  })
  const candidates = []
  const matchKeys = new Set()
  for (const item of discovered) {
    if (AUDIT_KINDS.has(item.kind)) continue
    for (const fragment of item.fragmentRecords || []) {
      matchKeys.add(policyMatchKey(
        item.location.path,
        fragment.kind,
        fragment.text,
        fragment.start.line
      ))
    }
    for (const text of item.staticFragments || []) {
      matchKeys.add(policyMatchKey(
        item.location.path,
        item.kind,
        text,
        item.location.start.line
      ))
    }
    candidates.push({
      id: item.id,
      expression: item.expression,
      staticFragments: item.staticFragments,
      location: {
        path: item.location.path,
        start: { line: item.location.start.line, column: item.location.start.column },
        end: { line: item.location.end.line, column: item.location.end.column }
      },
      sourceSurface: sourceSurfaceFor(
        item.location.path,
        item.kind === 'html-text' || item.kind === 'html-attribute' ? 'template' : 'script'
      ),
      semanticRole: item.semanticRole,
      reason: item.reason,
      capability: CAPABILITY_EXPLICIT_LOCALIZATION_REQUIRED,
      disposition: item.disposition || DISPOSITION_NEEDS_REVIEW,
      diagnostic: item.diagnostic
    })
  }
  return { candidates, matchKeys }
}

function policyFilesFromSnapshots(snapshots, config = {}) {
  const root = config.root
  if (!root || typeof root !== 'string') return []
  const byPath = new Map()
  for (const snapshot of snapshots || []) {
    if (!snapshot) continue
    const projectPath = typeof snapshot.projectPath === 'string' && snapshot.projectPath
      ? snapshot.projectPath.split('\\').join('/')
      : (typeof snapshot.identity === 'string' ? snapshot.identity.split('::')[0] : '')
    if (!projectPath || !isRuntimeLocalizablePolicyPath(projectPath)) continue
    if (byPath.has(projectPath)) continue
    const absolutePath = path.resolve(root, projectPath)
    let source
    try {
      source = fs.readFileSync(absolutePath, 'utf8')
    } catch (_) {
      continue
    }
    byPath.set(projectPath, { path: projectPath, absolutePath, source })
  }
  return [...byPath.values()]
}

function collectedItem(entry, sourceSurface, resourceIdentity) {
  return { entry, sourceSurface, resourceIdentity }
}

function hasVueTemplateBlock(source) {
  return /<template[\s>]/i.test(source)
}

function collectScriptEntries(file, config) {
  const resourceIdentity = `${file.path}::script`
  const resource = {
    projectPath: file.path,
    absolutePath: file.absolutePath || path.resolve(file.path),
    block: 'script',
    identity: resourceIdentity
  }
  return extractScript({ source: file.source, resource, config }).map(entry => (
    collectedItem(entry, sourceSurfaceFor(file.path, 'script'), resourceIdentity)
  ))
}

function collectVueEntries(file, config) {
  const absolutePath = file.absolutePath || path.resolve(file.path)
  const scriptSurface = sourceSurfaceFor(file.path, 'script')
  const script = extractVueScriptBlocks({
    source: file.source,
    resource: {
      projectPath: file.path,
      absolutePath,
      block: 'script'
    },
    config
  }).flatMap(({ resource, entries }) => (
    entries.map(entry => collectedItem(entry, scriptSurface, resource.identity))
  ))
  const template = []
  if (hasVueTemplateBlock(file.source)) {
    const templateIdentity = `${file.path}::template[lang=html]`
    const templateResource = {
      projectPath: file.path,
      absolutePath,
      block: 'template',
      lang: 'html',
      identity: templateIdentity
    }
    for (const entry of extractHtml({
      source: file.source,
      resource: templateResource,
      config
    }).entries) {
      template.push(collectedItem(entry, sourceSurfaceFor(file.path, 'template'), templateIdentity))
    }
  }
  const styleIdentity = `${file.path}::style`
  const styles = auditStyle({
    source: file.source,
    resource: {
      projectPath: file.path,
      absolutePath,
      block: 'style',
      identity: styleIdentity
    },
    config
  }).entries.map(entry => (
    collectedItem(entry, sourceSurfaceFor(file.path, 'style'), styleIdentity)
  ))
  return script.concat(template).concat(styles)
}

function collectStandaloneHtmlEntries(file, config) {
  const absolutePath = file.absolutePath || path.resolve(file.path)
  const resourceIdentity = `${file.path}::html`
  const resource = {
    projectPath: file.path,
    absolutePath,
    block: 'html',
    lang: 'html',
    identity: resourceIdentity
  }
  return extractHtml({ source: file.source, resource, config }).entries.map(entry => (
    collectedItem(entry, sourceSurfaceFor(file.path, 'html'), resourceIdentity)
  ))
}

function collectStyleEntries(file, config) {
  const lang = styleLangFor(file.path)
  const absolutePath = file.absolutePath || path.resolve(file.path)
  const resourceIdentity = `${file.path}::style[index=0;lang=${lang}]`
  const resource = {
    projectPath: file.path,
    absolutePath,
    block: 'style',
    lang,
    identity: resourceIdentity
  }
  return auditStyle({ source: file.source, resource, config }).entries.map(entry => (
    collectedItem(entry, sourceSurfaceFor(file.path, 'style'), resourceIdentity)
  ))
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

function classifyCollected(collected, dynamicRequired = { candidates: [], matchKeys: new Set() }) {
  const analysis = emptyAnalysis()
  analysis.dynamicMessageCandidates.push(...dynamicRequired.candidates)
  for (const item of collected) {
    const { entry, sourceSurface, resourceIdentity } = item
    const identityExtras = resourceIdentity ? { resourceIdentity } : {}
    const locations = entry.locations || []
    for (const location of locations) {
      if (entry.representation === REPRESENTATION_LOCALIZED_CALL) {
        analysis.localizedCallFindings.push(
          findingFrom(entry, location, CAPABILITY_LOCALIZED, sourceSurface, {
            ...identityExtras,
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
            ...identityExtras,
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
      if (dynamicRequired.matchKeys.has(matchKey)) {
        // Static fragment evidence for a dynamic message candidate; do not
        // treat the fragment as independently runtime-localizable.
        continue
      }
      analysis.runtimeMessages.push(
        findingFrom(entry, location, CAPABILITY_AUTOMATIC, sourceSurface, identityExtras)
      )
    }
  }
  const automatic = analysis.runtimeMessages.length
  const already = analysis.localizedCallFindings.length
  const audit = analysis.auditFindings.length
  const dynamicTotal = analysis.dynamicMessageCandidates.length
  const dynamicNeedsReview = analysis.dynamicMessageCandidates.filter(
    candidate => candidate.disposition === DISPOSITION_NEEDS_REVIEW
  ).length
  const dynamicIgnored = analysis.dynamicMessageCandidates.filter(
    candidate => candidate.disposition === DISPOSITION_INTENTIONALLY_IGNORED
  ).length
  const dynamicDeferred = analysis.dynamicMessageCandidates.filter(
    candidate => candidate.decision === 'defer'
  ).length
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
    sourceDiscovery: { total: automatic + already + audit + dynamicTotal },
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
    dynamicMessageCandidates: {
      total: dynamicTotal,
      needsReview: dynamicNeedsReview,
      intentionallyIgnored: dynamicIgnored,
      translationApproved: 0,
      deferred: dynamicDeferred,
      migrated: 0
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
    || String(left.resourceIdentity || '').localeCompare(String(right.resourceIdentity || ''))
}

function sortFindings(findings) {
  return [...findings].sort(compareFindings)
}

function compareCandidates(left, right) {
  return left.location.path.localeCompare(right.location.path)
    || left.location.start.line - right.location.start.line
    || left.location.start.column - right.location.start.column
    || String(left.expression || '').localeCompare(String(right.expression || ''))
    || String(left.id || '').localeCompare(String(right.id || ''))
}

function sortCandidates(candidates) {
  return [...candidates].sort(compareCandidates)
}

function compareDiagnostics(left, right) {
  return String(left.path || '').localeCompare(String(right.path || ''))
    || String(left.message || '').localeCompare(String(right.message || ''))
    || String(left.code || '').localeCompare(String(right.code || ''))
    || String(left.identity || '').localeCompare(String(right.identity || ''))
}

function sortDiagnostics(diagnostics) {
  return [...(diagnostics || [])].sort(compareDiagnostics)
}

function finalizeAnalysis(analysis, input, config) {
  analysis.runtimeMessages = sortFindings(analysis.runtimeMessages)
  analysis.auditFindings = sortFindings(analysis.auditFindings)
  analysis.dynamicMessageCandidates = sortCandidates(analysis.dynamicMessageCandidates)
  analysis.localizedCallFindings = sortFindings(analysis.localizedCallFindings)
  analysis.diagnostics = sortDiagnostics(analysis.diagnostics)
  const explicitMessages = loadExplicitMessages(input, config)
  const migratedDynamicDecisions = applyDynamicMessageDecisions(
    analysis.dynamicMessageCandidates,
    loadDynamicMessageDecisions(input, config),
    explicitMessages,
    analysis.localizedCallFindings
  )
  if (migratedDynamicDecisions.length) {
    analysis.migratedDynamicDecisions = migratedDynamicDecisions
  }
  refreshDynamicCoverage(analysis)
  const externalKeys = loadExternalKeys(input, config)
  const pendingExplicitKeys = new Set(
    analysis.dynamicMessageCandidates
      .filter(candidate => candidate.disposition === DISPOSITION_TRANSLATION_APPROVED && candidate.key)
      .map(candidate => candidate.key)
  )
  validateAndBindExplicitMessages(analysis, explicitMessages, externalKeys, pendingExplicitKeys)
  return analysis
}

function collectedFromSnapshots(snapshots) {
  const collected = []
  for (const snapshot of snapshots || []) {
    if (!snapshot || !Array.isArray(snapshot.entries)) continue
    const projectPath = typeof snapshot.projectPath === 'string' && snapshot.projectPath
      ? snapshot.projectPath.split('\\').join('/')
      : (typeof snapshot.identity === 'string' ? snapshot.identity.split('::')[0] : '')
    const identity = snapshot.identity || null
    let block = 'script'
    if (typeof identity === 'string') {
      if (identity.includes('::template')) block = 'template'
      else if (identity.includes('::style')) block = 'style'
      else if (identity.includes('::html')) block = 'html'
      else if (identity.includes('::script')) block = 'script'
    }
    const sourceSurface = sourceSurfaceFor(projectPath, block)
    for (const entry of snapshot.entries) {
      if (!entry) continue
      collected.push(collectedItem(entry, sourceSurface, identity || undefined))
    }
  }
  return collected
}

function analyzeSnapshots(snapshots, config = {}, input = {}) {
  const collected = collectedFromSnapshots(snapshots)
  const policyFiles = Array.isArray(input.files) && input.files.length
    ? input.files
    : policyFilesFromSnapshots(snapshots, config)
  const dynamicRequired = dynamicCandidatesFromPolicy(policyFiles, config)
  const analysis = classifyCollected(collected, dynamicRequired)
  if (Array.isArray(input.diagnostics)) {
    analysis.diagnostics.push(...input.diagnostics)
  }
  return finalizeAnalysis(analysis, input, config)
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
  const dynamicRequired = dynamicCandidatesFromPolicy(input.files, config)
  const analysis = classifyCollected(collected, dynamicRequired)
  if (Array.isArray(input.diagnostics)) {
    analysis.diagnostics.push(...input.diagnostics)
  }
  return finalizeAnalysis(analysis, input, config)
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
  return {
    version: SOURCE_CATALOG_VERSION,
    messages: Object.fromEntries([...messages.entries()].sort((left, right) => left[0].localeCompare(right[0])))
  }
}

function analysisReport(analysis) {
  const report = {
    version: ANALYSIS_REPORT_VERSION,
    runtimeMessages: analysis.runtimeMessages,
    auditFindings: analysis.auditFindings,
    dynamicMessageCandidates: analysis.dynamicMessageCandidates,
    localizedCallFindings: analysis.localizedCallFindings,
    diagnostics: sortDiagnostics(analysis.diagnostics),
    coverage: analysis.coverage
  }
  if (Array.isArray(analysis.migratedDynamicDecisions) && analysis.migratedDynamicDecisions.length) {
    report.migratedDynamicDecisions = analysis.migratedDynamicDecisions
  }
  return report
}

module.exports = {
  ANALYSIS_REPORT_VERSION,
  SOURCE_CATALOG_VERSION,
  analyzeProject,
  analyzeSnapshots,
  analysisReport,
  buildSourceCatalog,
  CAPABILITY_AUTOMATIC,
  CAPABILITY_LOCALIZED,
  CAPABILITY_AUDIT,
  CAPABILITY_EXPLICIT_LOCALIZATION_REQUIRED,
  DISPOSITION_UNRESOLVED,
  DISPOSITION_NEEDS_REVIEW,
  DISPOSITION_INTENTIONALLY_IGNORED
}
