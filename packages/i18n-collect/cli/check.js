const fs = require('fs')
const path = require('path')
const { catalogFormat } = require('../mycommon/catalog-format')
const { clearCollectionOverrides, loadConfig, setCollectionOverrides } = require('../mycommon/config')
const { evaluateHybridPolicy } = require('../mycommon/evaluate-hybrid-policy')
const {
  evaluateLocalizationCompleteness
} = require('../mycommon/evaluate-localization-completeness')
const { analyzeProject } = require('../mycommon/project-analysis')
const { listProjectSources } = require('../mycommon/project-sources')
const {
  readCommittedSourceCatalog,
  sourceCatalogPath
} = require('../mycommon/source-catalog-freshness')

const EXIT = {
  ok: 0,
  configuration: 1,
  incomplete: 2,
  collection: 2
}

const REVIEW_NAME = 'translation-state.json'

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

function tryReadCommittedSourceCatalog(root, config) {
  const relative = sourceCatalogPath(config)
  const file = path.join(root, relative)
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null
  return readCommittedSourceCatalog(root, config)
}

function localeFile(config, locale) {
  return path.posix.join(config.catalogDir, `${locale}${catalogFormat(config.catalogFormat).extension}`)
}

function reviewFile(config) {
  return path.posix.join(config.catalogDir, REVIEW_NAME)
}

function readTargetCatalog(root, relative, adapter) {
  const file = path.join(root, relative)
  if (!fs.existsSync(file)) return {}
  try {
    const parsed = adapter.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw commandError('configuration', `target catalog must be a JSON object: ${relative}`)
    }
    for (const key of Object.keys(parsed)) {
      if (typeof parsed[key] !== 'string') {
        throw commandError('configuration', `target catalog key "${key}" must be a string: ${relative}`)
      }
    }
    return parsed
  } catch (error) {
    if (error && error.kind === 'configuration') throw error
    throw commandError('configuration', `cannot read target catalog ${relative}: ${error.message}`)
  }
}

function readReviewState(root, relative) {
  const file = path.join(root, relative)
  if (!fs.existsSync(file)) return { version: 1, locales: {} }
  let value
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw commandError('configuration', `cannot read translation state ${relative}: ${error.message}`)
  }
  if (!value || value.version !== 1 || !value.locales || typeof value.locales !== 'object' || Array.isArray(value.locales)) {
    throw commandError('configuration', `translation state ${relative} must be version 1`)
  }
  for (const [locale, entries] of Object.entries(value.locales)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      throw commandError('configuration', `translation state for "${locale}" must be an object`)
    }
    for (const [key, record] of Object.entries(entries)) {
      const review = record && record.review
      if (!record || typeof record.sourceFingerprint !== 'string' || (review !== 'current' && review !== 'needs-review')) {
        throw commandError('configuration', `translation state for "${locale}" key "${key}" is invalid`)
      }
    }
  }
  return value
}

function mergePolicyIntoEvaluation(evaluation, policy) {
  if (policy.ok) {
    return {
      ...evaluation,
      policy
    }
  }
  const blocking = [...evaluation.blocking]
  if (policy.newViolations.length || policy.modifiedViolations.length) {
    if (!blocking.includes('complete-static-copy-policy')) {
      blocking.push('complete-static-copy-policy')
    }
  }
  if (policy.runtimeMultilingualViolations.length > 0) {
    if (!blocking.includes('runtime-multilingual-policy')) {
      blocking.push('runtime-multilingual-policy')
    }
  }
  const remediation = []
  if (!evaluation.ok) remediation.push(evaluation.message)
  if (policy.message) remediation.push(policy.message)
  return {
    ...evaluation,
    ok: false,
    blocking,
    message: remediation.join('; '),
    policy
  }
}

function summaryReport(analysis, evaluation, scannedFiles) {
  return {
    command: 'check',
    ok: evaluation.ok,
    scannedFiles,
    sourceFreshness: evaluation.sourceFreshness,
    runtimeLocalization: evaluation.runtimeLocalization,
    chineseSourceAudit: evaluation.chineseSourceAudit,
    localeCoverage: evaluation.localeCoverage,
    missingTranslations: evaluation.missingTranslations,
    needsReviewTranslations: evaluation.needsReviewTranslations,
    staleTargetKeys: evaluation.staleTargetKeys,
    blocking: evaluation.blocking,
    message: evaluation.message,
    coverage: analysis.coverage,
    auditFindings: evaluation.auditFindings,
    dynamicMessageCandidates: evaluation.dynamicMessageCandidates,
    dynamicMessageCandidateFindings: evaluation.dynamicMessageCandidateFindings,
    policy: evaluation.policy
      ? {
        ok: evaluation.policy.ok,
        baseline: evaluation.policy.baseline,
        runtimeMultilingualBoundaries: evaluation.policy.runtimeMultilingualBoundaries,
        violations: evaluation.policy.violations,
        grandfathered: evaluation.policy.grandfathered,
        newViolations: evaluation.policy.newViolations,
        modifiedViolations: evaluation.policy.modifiedViolations,
        runtimeMultilingualViolations: evaluation.policy.runtimeMultilingualViolations
      }
      : undefined
  }
}

function humanSummary(evaluation, analysis) {
  const lines = []
  if (evaluation.ok) {
    const policy = evaluation.policy
    const policyBit = policy
      ? `; policy ${policy.violations} violation(s), ${policy.grandfathered} grandfathered`
      : ''
    lines.push(
      `check: complete; source discovery ${analysis.coverage.sourceDiscovery.total}; ` +
      `runtime auto ${evaluation.runtimeLocalization.automaticallyRuntimeLocalizable}, ` +
      `already ${evaluation.runtimeLocalization.alreadyLocalized}, ` +
      `dynamic candidates ${evaluation.dynamicMessageCandidates.total}; ` +
      `unresolved audit ${evaluation.chineseSourceAudit.unresolved}; ` +
      `needs-review audit ${evaluation.chineseSourceAudit.needsReview}; ` +
      `intentionally ignored ${evaluation.chineseSourceAudit.intentionallyIgnored}` +
      policyBit
    )
  } else {
    lines.push(`incomplete: ${evaluation.message}`)
    for (const code of evaluation.blocking) {
      lines.push(`blocking: ${code}`)
    }
  }
  if (evaluation.staleTargetKeys.length > 0) {
    const sample = evaluation.staleTargetKeys
      .slice(0, 3)
      .map(item => `${item.locale}:${item.key}`)
      .join(', ')
    const more = evaluation.staleTargetKeys.length > 3
      ? ` (+${evaluation.staleTargetKeys.length - 3} more)`
      : ''
    lines.push(`stale target keys (reported only): ${sample}${more}`)
  }
  return `${lines.join('\n')}\n`
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
    const sources = listProjectSources(config.root, config)
    const analysis = analyzeProject({ files: sources, config })
    const committedSourceCatalog = tryReadCommittedSourceCatalog(config.root, config)

    const adapter = catalogFormat(config.catalogFormat)
    const targets = {}
    for (const locale of config.targetLocales) {
      targets[locale] = readTargetCatalog(config.root, localeFile(config, locale), adapter)
    }
    const reviewState = readReviewState(config.root, reviewFile(config))

    const completeness = evaluateLocalizationCompleteness({
      analysis,
      committedSourceCatalog,
      targetLocales: config.targetLocales,
      targets,
      reviewState
    })
    const policy = evaluateHybridPolicy({ sources, config })
    const evaluation = mergePolicyIntoEvaluation(completeness, policy)
    const report = summaryReport(analysis, evaluation, sources.length)

    if (!evaluation.ok) {
      if (parsed.json) {
        return outcome(
          EXIT.incomplete,
          jsonText({ ...report, failure: 'incomplete' }),
          `incomplete: ${evaluation.message}\n`
        )
      }
      return outcome(EXIT.incomplete, '', humanSummary(evaluation, analysis))
    }
    if (parsed.json) return outcome(EXIT.ok, jsonText(report), '')
    return outcome(EXIT.ok, humanSummary(evaluation, analysis), '')
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
