const STATE_VERSION = 1

function cloneState(state) {
  const locales = {}
  for (const [locale, entries] of Object.entries((state && state.locales) || {})) {
    locales[locale] = {}
    for (const [key, record] of Object.entries(entries || {})) {
      locales[locale][key] = {
        sourceFingerprint: record.sourceFingerprint,
        review: record.review
      }
    }
  }
  return { version: STATE_VERSION, locales }
}

function pairId(key, locale) {
  return `${key}\0${locale}`
}

// Missing target entries are sent to the provider. Existing text stays unless retranslate
// is set. A kept entry with no review record adopts the current source fingerprint.
// A kept entry whose recorded fingerprint differs is marked needs-review and keeps its text.
// retainedKeys (active + orphaned) keeps translation history; other target keys are pruned.
function planTranslation({ entries, targets, state, locales, retranslate = false, retainedKeys = null }) {
  const nextState = cloneState(state)
  const nextTargets = {}
  for (const locale of locales) nextTargets[locale] = { ...(targets[locale] || {}) }
  const items = new Map()
  const pending = []
  const kept = []
  const pruned = []
  const retained = retainedKeys == null ? null : new Set(retainedKeys)

  for (const key of Object.keys(entries).sort()) {
    const entry = entries[key]
    for (const locale of locales) {
      const hasEntry = Object.prototype.hasOwnProperty.call(nextTargets[locale], key)
      if (!nextState.locales[locale]) nextState.locales[locale] = {}
      const record = nextState.locales[locale][key]
      if (hasEntry && record) {
        record.review = record.sourceFingerprint === entry.fingerprint ? 'current' : 'needs-review'
      }
      if (hasEntry && !retranslate) {
        if (!record) {
          nextState.locales[locale][key] = {
            sourceFingerprint: entry.fingerprint,
            review: 'current'
          }
        }
        kept.push({ key, locale })
        continue
      }
      const item = items.get(key) || { key, source: entry.source, locales: [] }
      item.locales.push(locale)
      items.set(key, item)
      pending.push({ key, locale, fingerprint: entry.fingerprint, replace: hasEntry })
    }
  }

  if (retained) {
    for (const locale of locales) {
      for (const key of Object.keys(nextTargets[locale]).sort()) {
        if (retained.has(key)) continue
        delete nextTargets[locale][key]
        if (nextState.locales[locale]) delete nextState.locales[locale][key]
        pruned.push({ key, locale })
      }
    }
  }

  return { items: [...items.values()], pending, nextTargets, nextState, kept, pruned }
}

function needsReview(state, entries, locales) {
  const pairs = []
  for (const key of Object.keys(entries).sort()) {
    for (const locale of locales) {
      const record = state.locales[locale] && state.locales[locale][key]
      if (record && record.review === 'needs-review') pairs.push({ key, locale })
    }
  }
  return pairs
}

function failureMessage(failure) {
  return typeof failure.message === 'string' && failure.message.trim()
    ? failure.message
    : 'provider failed this item'
}

function applyDrafts(plan, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.drafts)) {
    throw new Error('provider result must be an object with a drafts array')
  }
  if (result.failures !== undefined && !Array.isArray(result.failures)) {
    throw new Error('provider failures must be an array')
  }
  const pending = new Map(plan.pending.map(pair => [pairId(pair.key, pair.locale), pair]))
  const resolved = new Set()
  const failures = []
  for (const failure of result.failures || []) {
    if (!failure || typeof failure.key !== 'string' || typeof failure.locale !== 'string') continue
    const id = pairId(failure.key, failure.locale)
    if (!pending.has(id) || resolved.has(id)) continue
    resolved.add(id)
    failures.push({ key: failure.key, locale: failure.locale, message: failureMessage(failure) })
  }
  for (const draft of result.drafts) {
    if (!draft || typeof draft.key !== 'string' || typeof draft.locale !== 'string') continue
    const id = pairId(draft.key, draft.locale)
    const pair = pending.get(id)
    if (!pair || resolved.has(id)) continue
    if (typeof draft.text !== 'string') {
      resolved.add(id)
      failures.push({ key: draft.key, locale: draft.locale, message: 'draft text must be a string' })
      continue
    }
    plan.nextTargets[draft.locale][draft.key] = draft.text
    plan.nextState.locales[draft.locale][draft.key] = {
      sourceFingerprint: pair.fingerprint,
      review: 'current'
    }
    resolved.add(id)
  }
  const created = []
  const replaced = []
  for (const pair of plan.pending) {
    if (!resolved.has(pairId(pair.key, pair.locale))) {
      failures.push({ key: pair.key, locale: pair.locale, message: 'provider returned no draft' })
      continue
    }
    if (failures.some(failure => failure.key === pair.key && failure.locale === pair.locale)) continue
    const recorded = { key: pair.key, locale: pair.locale }
    if (pair.replace) replaced.push(recorded)
    else created.push(recorded)
  }
  return { created, replaced, failures }
}

function serializeState(state) {
  const locales = {}
  for (const locale of Object.keys(state.locales).sort()) {
    const entries = state.locales[locale]
    const keys = Object.keys(entries).sort()
    if (keys.length === 0) continue
    locales[locale] = {}
    for (const key of keys) {
      locales[locale][key] = {
        sourceFingerprint: entries[key].sourceFingerprint,
        review: entries[key].review
      }
    }
  }
  return `${JSON.stringify({ version: STATE_VERSION, locales }, null, 2)}\n`
}

module.exports = { applyDrafts, needsReview, planTranslation, serializeState }
