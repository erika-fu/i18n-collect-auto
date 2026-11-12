const { fingerprintOf } = require('./catalog')
const { buildSourceCatalog } = require('./project-analysis')
const { catalogEqual, sourceCatalogMessages } = require('./source-catalog-freshness')
const { needsReview, planTranslation } = require('./translate')

function runtimeLocalizationSummary(analysis) {
  const coverage = analysis.coverage || {}
  const runtime = coverage.runtimeLocalization || {}
  const explicit = coverage.explicitRequired || {}
  return {
    automaticallyRuntimeLocalizable: runtime.automaticallyRuntimeLocalizable || 0,
    alreadyLocalized: runtime.alreadyLocalized || 0,
    explicitRequired: explicit.total || (analysis.explicitRequiredFindings || []).length
  }
}

function chineseSourceAuditSummary(analysis) {
  const audit = (analysis.coverage && analysis.coverage.chineseSourceAudit) || {}
  return {
    total: audit.total || 0,
    unresolved: audit.unresolved || 0,
    needsReview: audit.needsReview || 0,
    intentionallyIgnored: audit.intentionallyIgnored || 0
  }
}

function sourceEntriesFromCatalog(catalog) {
  const messages = sourceCatalogMessages(catalog)
  const entries = {}
  for (const key of Object.keys(messages).sort()) {
    const source = messages[key]
    entries[key] = { source, fingerprint: fingerprintOf(source) }
  }
  return entries
}

function evaluateSourceFreshness(analysis, committedSourceCatalog) {
  if (committedSourceCatalog == null) {
    return {
      ok: false,
      reason: 'missing-source-catalog',
      message: 'committed source catalog is missing; run scan before check'
    }
  }
  let expected
  try {
    expected = buildSourceCatalog(analysis)
  } catch (error) {
    return {
      ok: false,
      reason: 'source-catalog-build-failed',
      message: error && error.message ? error.message : String(error)
    }
  }
  if (!catalogEqual(expected, committedSourceCatalog)) {
    return {
      ok: false,
      reason: 'stale-source-analysis',
      message: 'source analysis no longer matches the committed source catalog; run scan before check'
    }
  }
  return { ok: true, expected }
}

function evaluateLocaleCoverage({ entries, targets, reviewState, targetLocales }) {
  const localeCoverage = {}
  const missingTranslations = []
  const needsReviewTranslations = []
  const staleTargetKeys = []

  if (!targetLocales || targetLocales.length === 0) {
    return { localeCoverage, missingTranslations, needsReviewTranslations, staleTargetKeys }
  }

  const plan = planTranslation({
    entries,
    targets: targets || {},
    state: reviewState || { version: 1, locales: {} },
    locales: targetLocales,
    retranslate: false,
    prune: false
  })

  const reviewPairs = needsReview(plan.nextState, entries, targetLocales)
  const missingSet = new Set(plan.pending.map(item => `${item.key}\0${item.locale}`))
  const reviewSet = new Set(reviewPairs.map(item => `${item.key}\0${item.locale}`))

  for (const locale of targetLocales) {
    const translated = []
    const missing = []
    const review = []
    const stale = []
    for (const key of Object.keys(entries).sort()) {
      const id = `${key}\0${locale}`
      if (missingSet.has(id)) {
        missing.push(key)
        missingTranslations.push({ key, locale })
        continue
      }
      if (reviewSet.has(id)) {
        review.push(key)
        needsReviewTranslations.push({ key, locale })
        continue
      }
      translated.push(key)
    }
    for (const item of plan.stale) {
      if (item.locale !== locale) continue
      stale.push(item.key)
      staleTargetKeys.push({ key: item.key, locale })
    }
    localeCoverage[locale] = {
      translated,
      missing,
      needsReview: review,
      stale
    }
  }

  return { localeCoverage, missingTranslations, needsReviewTranslations, staleTargetKeys }
}

function sampleKeys(pairs, limit = 3) {
  const keys = pairs.map(item => `${item.locale}:${item.key}`)
  if (keys.length <= limit) return keys.join(', ')
  return `${keys.slice(0, limit).join(', ')} (+${keys.length - limit} more)`
}

function sampleFindings(findings, limit = 3) {
  const labels = findings.map(item => {
    const path = item.location && item.location.path ? item.location.path : '?'
    return `${path}:${JSON.stringify(item.text)}`
  })
  if (labels.length <= limit) return labels.join(', ')
  return `${labels.slice(0, limit).join(', ')} (+${labels.length - limit} more)`
}

function blockingMessage(parts) {
  if (parts.length === 0) return 'project localization completeness passed'
  return `project localization completeness failed: ${parts.join('; ')}`
}

function evaluateLocalizationCompleteness(input = {}) {
  const analysis = input.analysis || {}
  const runtimeLocalization = runtimeLocalizationSummary(analysis)
  const chineseSourceAudit = chineseSourceAuditSummary(analysis)
  const sourceFreshness = evaluateSourceFreshness(analysis, input.committedSourceCatalog)

  const blocking = []
  const remediation = []

  if (!sourceFreshness.ok) {
    blocking.push(sourceFreshness.reason)
    remediation.push(sourceFreshness.message)
  }

  const explicitRequiredFindings = analysis.explicitRequiredFindings || []
  if (explicitRequiredFindings.length > 0 || runtimeLocalization.explicitRequired > 0) {
    blocking.push('explicit-required')
    remediation.push(
      `${explicitRequiredFindings.length || runtimeLocalization.explicitRequired} explicit-required message(s) (${sampleFindings(explicitRequiredFindings)}); migrate to explicit-messages.json and static localized calls`
    )
  }

  const unresolvedFindings = (analysis.auditFindings || []).filter(
    item => item.disposition === 'unresolved'
  )
  const needsReviewFindings = (analysis.auditFindings || []).filter(
    item => item.disposition === 'needs-review'
  )
  if (chineseSourceAudit.unresolved > 0) {
    blocking.push('unresolved-audit')
    remediation.push(
      `${chineseSourceAudit.unresolved} unresolved Chinese source audit finding(s) (${sampleFindings(unresolvedFindings)}); migrate, adapt, or add i18n-ignore: <reason>`
    )
  }
  if (chineseSourceAudit.needsReview > 0) {
    blocking.push('needs-review-audit')
    remediation.push(
      `${chineseSourceAudit.needsReview} needs-review Chinese source audit finding(s) (${sampleFindings(needsReviewFindings)}); confirm, migrate, or add i18n-ignore: <reason>`
    )
  }

  const expectedCatalog = sourceFreshness.ok
    ? sourceFreshness.expected
    : (input.committedSourceCatalog && typeof input.committedSourceCatalog === 'object'
      ? input.committedSourceCatalog
      : {})
  const entries = sourceEntriesFromCatalog(expectedCatalog || {})
  const localeResult = evaluateLocaleCoverage({
    entries,
    targets: input.targets,
    reviewState: input.reviewState,
    targetLocales: input.targetLocales || []
  })

  if (localeResult.missingTranslations.length > 0) {
    blocking.push('missing-translations')
    remediation.push(
      `${localeResult.missingTranslations.length} missing translation(s) (${sampleKeys(localeResult.missingTranslations)}); run translate`
    )
  }
  if (localeResult.needsReviewTranslations.length > 0) {
    blocking.push('needs-review-translations')
    remediation.push(
      `${localeResult.needsReviewTranslations.length} needs-review translation(s) (${sampleKeys(localeResult.needsReviewTranslations)}); retranslate or confirm against the current source fingerprint`
    )
  }

  const ok = blocking.length === 0
  return {
    ok,
    blocking,
    message: blockingMessage(remediation),
    sourceFreshness: {
      ok: sourceFreshness.ok,
      reason: sourceFreshness.reason || null
    },
    runtimeLocalization,
    chineseSourceAudit,
    localeCoverage: localeResult.localeCoverage,
    missingTranslations: localeResult.missingTranslations,
    needsReviewTranslations: localeResult.needsReviewTranslations,
    staleTargetKeys: localeResult.staleTargetKeys,
    explicitRequiredFindings,
    auditFindings: analysis.auditFindings || []
  }
}

module.exports = {
  evaluateLocalizationCompleteness
}
