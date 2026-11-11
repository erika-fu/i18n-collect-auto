const { OPAQUE_AUTOMATIC_KEY } = require('./catalog')
const { keyFor: defaultKeyFor } = require('./store')

const HASH_DICTIONARY_KEY = /^[a-f0-9]{32}$/

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort((left, right) => left[0].localeCompare(right[0])))
}

function isAutomaticEntry(key, entry) {
  if (entry && entry.origin === 'explicit') return false
  if (entry && entry.origin === 'derived') return true
  return OPAQUE_AUTOMATIC_KEY.test(key) || HASH_DICTIONARY_KEY.test(key)
}

function sourceOf(key, sourceCatalog, entry) {
  if (entry && typeof entry.source === 'string') return entry.source
  if (sourceCatalog && typeof sourceCatalog[key] === 'string') return sourceCatalog[key]
  return undefined
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)))
}

function formatConflict(conflict) {
  const lines = [
    `source text ${JSON.stringify(conflict.source)} has conflicting target translations and needs explicit keys:`
  ]
  for (const locale of Object.keys(conflict.translationsByLocale).sort()) {
    const byText = conflict.translationsByLocale[locale]
    for (const text of Object.keys(byText).sort()) {
      const keys = byText[text].slice().sort()
      const label = text === '' ? '<missing translation>' : JSON.stringify(text)
      lines.push(`  [${locale}] ${label} from ${keys.join(', ')}`)
    }
  }
  return lines.join('\n')
}

function formatCollision(collision) {
  const messages = collision.messages
    .map(item => `${JSON.stringify(item.source)} (from ${item.keys.slice().sort().join(', ')})`)
    .join(' vs ')
  return `hash collision for key "${collision.key}": ${messages}`
}

function translationAgreement(keys, targetCatalog) {
  const missing = []
  const byText = new Map()
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(targetCatalog, key)) {
      missing.push(key)
      continue
    }
    const text = targetCatalog[key]
    if (!byText.has(text)) byText.set(text, [])
    byText.get(text).push(key)
  }
  if (missing.length === keys.length) {
    return { kind: 'absent' }
  }
  if (missing.length > 0 || byText.size !== 1) {
    const translationsByText = Object.fromEntries(
      [...byText.entries()].map(([text, textKeys]) => [text, uniqueSorted(textKeys)])
    )
    if (missing.length) translationsByText[''] = uniqueSorted(missing)
    return { kind: 'conflict', translationsByText }
  }
  return { kind: 'reuse', text: [...byText.keys()][0] }
}

function migrateToTextHashKeys(input = {}) {
  const sourceCatalog = input.sourceCatalog || {}
  const metadata = input.metadata || {}
  const entries = metadata.entries || {}
  const targets = input.targets || {}
  const hashOf = typeof input.keyFor === 'function' ? input.keyFor : defaultKeyFor

  const automaticBySource = new Map()
  const explicitSource = new Map()
  const keyMapping = {}

  for (const key of Object.keys(sourceCatalog).sort()) {
    const entry = entries[key]
    const source = sourceOf(key, sourceCatalog, entry)
    if (source == null) {
      return {
        ok: false,
        conflicts: [],
        collisions: [],
        report: `migration failed: key "${key}" has no source text`
      }
    }
    if (!isAutomaticEntry(key, entry)) {
      const prior = explicitSource.get(key)
      if (prior != null && prior !== source) {
        return {
          ok: false,
          conflicts: [],
          collisions: [],
          report: `migration failed: explicit key "${key}" maps to incompatible source text`
        }
      }
      explicitSource.set(key, source)
      keyMapping[key] = key
      continue
    }
    if (!automaticBySource.has(source)) automaticBySource.set(source, [])
    automaticBySource.get(source).push(key)
  }

  const collisions = []
  const hashOwners = new Map()
  for (const [source, keys] of [...automaticBySource.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    const hash = hashOf(source)
    const owner = hashOwners.get(hash)
    if (owner && owner.source !== source) {
      collisions.push({
        key: hash,
        messages: [
          { source: owner.source, keys: owner.keys.slice() },
          { source, keys: keys.slice() }
        ]
      })
      continue
    }
    hashOwners.set(hash, { source, keys: keys.slice() })
    for (const key of keys) keyMapping[key] = hash
  }

  const conflicts = []
  for (const [source, keys] of [...automaticBySource.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    const translationsByLocale = {}
    let hasConflict = false
    for (const locale of Object.keys(targets).sort()) {
      const agreement = translationAgreement(keys, targets[locale] || {})
      if (agreement.kind !== 'conflict') continue
      hasConflict = true
      translationsByLocale[locale] = agreement.translationsByText
    }
    if (hasConflict) {
      conflicts.push({ source, keys: uniqueSorted(keys), translationsByLocale })
    }
  }

  if (collisions.length || conflicts.length) {
    const parts = []
    if (collisions.length) {
      parts.push(`i18n-collect migration failed: ${collisions.length} hash collision(s)`)
      for (const collision of collisions) parts.push(formatCollision(collision))
    }
    if (conflicts.length) {
      parts.push(
        `i18n-collect migration failed: ${conflicts.length} source text(s) have conflicting historical translations`
      )
      for (const conflict of conflicts) parts.push(formatConflict(conflict))
      parts.push('Assign explicit keys to preserve contextual meaning, then retry migration.')
    }
    return {
      ok: false,
      conflicts,
      collisions,
      report: parts.join('\n')
    }
  }

  const nextSource = new Map(explicitSource)
  for (const source of automaticBySource.keys()) {
    nextSource.set(hashOf(source), source)
  }

  const nextTargets = {}
  for (const locale of Object.keys(targets).sort()) {
    const next = new Map()
    for (const key of explicitSource.keys()) {
      if (Object.prototype.hasOwnProperty.call(targets[locale], key)) {
        next.set(key, targets[locale][key])
      }
    }
    for (const [source, keys] of automaticBySource.entries()) {
      const agreement = translationAgreement(keys, targets[locale] || {})
      if (agreement.kind === 'reuse') next.set(hashOf(source), agreement.text)
    }
    nextTargets[locale] = sortedObject(next)
  }

  return {
    ok: true,
    sourceCatalog: sortedObject(nextSource),
    targets: nextTargets,
    keyMapping,
    conflicts: [],
    collisions: []
  }
}

module.exports = {
  migrateToTextHashKeys
}
