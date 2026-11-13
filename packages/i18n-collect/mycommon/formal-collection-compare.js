const fs = require('fs')
const path = require('path')
const {
  analysisReportPath,
  parseSourceCatalogDocument,
  sourceCatalogPath
} = require('./formal-outputs')

const ENV_KEYS = new Set([
  'environment',
  'configHash',
  'parserVersion',
  'webpack',
  'loader',
  'compiler',
  'node',
  'builtAt',
  'timestamp'
])

function normalizeSourceCatalog(catalog) {
  const document = parseSourceCatalogDocument(catalog)
  const messages = Object.fromEntries(
    Object.entries(document.messages).sort((left, right) => left[0].localeCompare(right[0]))
  )
  return {
    version: document.version,
    messages
  }
}

function stripEnvironment(value) {
  if (Array.isArray(value)) return value.map(stripEnvironment)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const key of Object.keys(value).sort()) {
    if (ENV_KEYS.has(key)) continue
    out[key] = stripEnvironment(value[key])
  }
  return out
}

function compareNormalizedFindings(left, right) {
  const leftPath = left && left.location && left.location.path ? left.location.path : ''
  const rightPath = right && right.location && right.location.path ? right.location.path : ''
  const leftStart = left && left.location && left.location.start ? left.location.start : {}
  const rightStart = right && right.location && right.location.start ? right.location.start : {}
  return leftPath.localeCompare(rightPath)
    || (leftStart.line || 0) - (rightStart.line || 0)
    || (leftStart.column || 0) - (rightStart.column || 0)
    || String(left && left.semanticRole || '').localeCompare(String(right && right.semanticRole || ''))
    || String(left && left.text || '').localeCompare(String(right && right.text || ''))
    || String(left && left.expression || '').localeCompare(String(right && right.expression || ''))
    || String(left && left.id || '').localeCompare(String(right && right.id || ''))
    || String(left && left.key || '').localeCompare(String(right && right.key || ''))
    || String(left && left.resourceIdentity || '').localeCompare(String(right && right.resourceIdentity || ''))
}

function compareNormalizedDiagnostics(left, right) {
  return String(left && left.path || '').localeCompare(String(right && right.path || ''))
    || String(left && left.message || '').localeCompare(String(right && right.message || ''))
    || String(left && left.code || '').localeCompare(String(right && right.code || ''))
    || String(left && left.identity || '').localeCompare(String(right && right.identity || ''))
}

function normalizeFindingList(findings) {
  return [...(findings || [])]
    .map(stripEnvironment)
    .sort(compareNormalizedFindings)
}

function normalizeDiagnosticList(diagnostics) {
  return [...(diagnostics || [])]
    .map(stripEnvironment)
    .sort(compareNormalizedDiagnostics)
}

function normalizeAnalysisReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('analysis report must be an object')
  }
  return {
    version: report.version,
    runtimeMessages: normalizeFindingList(report.runtimeMessages),
    auditFindings: normalizeFindingList(report.auditFindings),
    dynamicMessageCandidates: normalizeFindingList(report.dynamicMessageCandidates),
    localizedCallFindings: normalizeFindingList(report.localizedCallFindings),
    diagnostics: normalizeDiagnosticList(report.diagnostics),
    coverage: stripEnvironment(report.coverage || {})
  }
}

function formalOutputsSemanticallyEqual(left, right) {
  const leftCatalog = normalizeSourceCatalog(left && left.catalog)
  const rightCatalog = normalizeSourceCatalog(right && right.catalog)
  const leftReport = normalizeAnalysisReport(left && left.report)
  const rightReport = normalizeAnalysisReport(right && right.report)
  return JSON.stringify(leftCatalog) === JSON.stringify(rightCatalog)
    && JSON.stringify(leftReport) === JSON.stringify(rightReport)
}

function readFormalCollectionOutputs(root, config, fsImpl = fs) {
  const catalogFile = path.join(root, sourceCatalogPath(config))
  const reportFile = path.join(root, analysisReportPath(config))
  if (!fsImpl.existsSync(catalogFile) || !fsImpl.existsSync(reportFile)) {
    const error = new Error('formal collection outputs are missing')
    error.kind = 'configuration'
    throw error
  }
  return {
    catalog: JSON.parse(fsImpl.readFileSync(catalogFile, 'utf8')),
    report: JSON.parse(fsImpl.readFileSync(reportFile, 'utf8'))
  }
}

function verifyFormalCollectionOutputs(committed, current) {
  return formalOutputsSemanticallyEqual(committed, current)
}

module.exports = {
  formalOutputsSemanticallyEqual,
  normalizeAnalysisReport,
  normalizeSourceCatalog,
  readFormalCollectionOutputs,
  verifyFormalCollectionOutputs
}
