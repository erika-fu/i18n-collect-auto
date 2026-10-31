const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { containsHan } = require('../myloader/resource')
const { normalizeLocation, sortLocations, uniqueLocations } = require('./store')

const CATALOG_VERSION = 2
const PREVIOUS_CATALOG_VERSION = 1

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function fingerprintOf(source) {
  return sha256(source).slice(0, 16)
}

function pathSlug(projectPath) {
  const parsed = path.posix.parse(projectPath)
  const segments = (parsed.dir ? parsed.dir.split('/') : []).concat(parsed.name || parsed.base)
  const slug = segments.map(segment => segment.replace(/[^A-Za-z0-9_-]/g, '_') || '_').join('.')
  return /^[A-Za-z]/.test(slug) ? slug : `k${slug}`
}

// Automatic keys identify one occurrence. Fresh assignment uses coordinates; later rounds
// reuse a prior key when collection history uniquely matches the occurrence.
function automaticKey({ path: projectPath, kind, value, location }) {
  if (!location || !location.start || !location.end) {
    throw new Error('Automatic key requires a source location')
  }
  const material = [
    projectPath,
    kind,
    value,
    location.start.line,
    location.start.column,
    location.end.line,
    location.end.column
  ].join('\0')
  return `${pathSlug(projectPath)}.${sha256(material).slice(0, 8)}`
}

function sortedObject(map, project) {
  return Object.fromEntries([...map.keys()].sort().map(key => [key, project(map.get(key))]))
}

function semanticHostFromLocation(location) {
  switch (location.kind) {
    case 'script-string':
    case 'template-literal':
      return `${location.path}::script`
    case 'html-text':
    case 'html-attribute':
    case 'template-expression':
      return `${location.path}::template`
    case 'static-html-text':
    case 'static-html-attribute':
      return `${location.path}::html`
    case 'css-generated-content':
      return `${location.path}::style`
    default:
      return location.path
  }
}

function semanticHostOf(snapshot, location) {
  if (snapshot && typeof snapshot.identity === 'string' && snapshot.identity) return snapshot.identity
  return semanticHostFromLocation(location)
}

function occurrenceId({ semanticHost, childRole, localContext }) {
  return sha256([semanticHost, childRole, localContext].join('\0')).slice(0, 16)
}

function siblingKey(semanticHost, childRole) {
  return `${semanticHost}\0${childRole}`
}

function compareOccurrenceDrafts(a, b) {
  return sortLocations(a.location, b.location) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

function assignOccurrenceIdentities(drafts) {
  const groups = new Map()
  for (const draft of drafts) {
    const groupKey = siblingKey(draft.semanticHost, draft.childRole)
    const group = groups.get(groupKey) || []
    group.push(draft)
    groups.set(groupKey, group)
  }
  for (const group of groups.values()) {
    group.sort(compareOccurrenceDrafts)
    group.forEach((draft, index) => {
      draft.localContext = `sibling:${index}`
      draft.id = occurrenceId(draft)
    })
  }
  return drafts.map(draft => ({
    key: draft.key,
    occurrence: {
      id: draft.id,
      semanticHost: draft.semanticHost,
      childRole: draft.childRole,
      localContext: draft.localContext,
      origin: draft.origin,
      location: draft.location
    }
  }))
}

function attachOccurrences(entries) {
  const drafts = []
  for (const [key, entry] of entries) {
    for (const location of entry.locations) {
      drafts.push({
        key,
        origin: entry.origin,
        semanticHost: entry.hostByLocation.get(locationId(location)),
        childRole: location.kind,
        location
      })
    }
  }
  const byKey = new Map()
  for (const { key, occurrence } of assignOccurrenceIdentities(drafts)) {
    const list = byKey.get(key) || []
    list.push(occurrence)
    byKey.set(key, list)
  }
  for (const [key, entry] of entries) {
    entries.set(key, {
      source: entry.source,
      fingerprint: entry.fingerprint,
      origin: entry.origin,
      locations: entry.locations,
      occurrences: (byKey.get(key) || []).sort((a, b) => sortLocations(a.location, b.location))
    })
  }
}

function locationId(location) {
  return JSON.stringify(location)
}

function semanticBlockSuffix(semanticHost) {
  const index = String(semanticHost).lastIndexOf('::')
  return index === -1 ? '' : semanticHost.slice(index)
}

function indexBy(items, keyOf) {
  const groups = new Map()
  for (const item of items) {
    const key = keyOf(item)
    const list = groups.get(key) || []
    list.push(item)
    groups.set(key, list)
  }
  return groups
}

function historicalDerivedOccurrences(metadata) {
  const entries = metadataEntries(metadata)
  const list = []
  for (const key of Object.keys(entries).sort()) {
    const entry = entries[key]
    if (!entry || entry.origin !== 'derived') continue
    for (const occurrence of entry.occurrences || []) {
      if (!occurrence || occurrence.origin === 'explicit') continue
      list.push({
        key,
        source: entry.source,
        semanticHost: occurrence.semanticHost,
        childRole: occurrence.childRole,
        localContext: occurrence.localContext
      })
    }
  }
  return list
}

function hostCorrespondence(previousHosts, currentHosts) {
  const currentToPrevious = new Map()
  for (const host of currentHosts) {
    if (previousHosts.has(host)) currentToPrevious.set(host, host)
  }
  const vanished = [...previousHosts].filter(host => !currentHosts.has(host))
  const appeared = [...currentHosts].filter(host => !previousHosts.has(host))
  const vanishedByBlock = indexBy(vanished, semanticBlockSuffix)
  const appearedByBlock = indexBy(appeared, semanticBlockSuffix)
  for (const block of new Set([...vanishedByBlock.keys(), ...appearedByBlock.keys()])) {
    const lost = vanishedByBlock.get(block) || []
    const gained = appearedByBlock.get(block) || []
    if (lost.length === 1 && gained.length === 1) currentToPrevious.set(gained[0], lost[0])
  }
  return currentToPrevious
}

function matchGroup(previous, current, reused, claimedKeys) {
  const unmatchedPrevious = new Set(previous)
  const unmatchedCurrent = new Set(current)

  if (previous.length === current.length && previous.length > 0) {
    const previousByContext = indexBy(previous, item => item.localContext)
    const currentByContext = indexBy(current, item => item.localContext)
    for (const context of currentByContext.keys()) {
      const prior = previousByContext.get(context) || []
      const next = currentByContext.get(context) || []
      if (
        prior.length === 1 &&
        next.length === 1 &&
        unmatchedPrevious.has(prior[0]) &&
        unmatchedCurrent.has(next[0]) &&
        !claimedKeys.has(prior[0].key)
      ) {
        reused.set(next[0], prior[0].key)
        claimedKeys.add(prior[0].key)
        unmatchedPrevious.delete(prior[0])
        unmatchedCurrent.delete(next[0])
      }
    }
  }

  const previousByText = indexBy([...unmatchedPrevious], item => item.source)
  const currentByText = indexBy([...unmatchedCurrent], item => item.value)
  for (const text of currentByText.keys()) {
    const prior = (previousByText.get(text) || []).filter(item => unmatchedPrevious.has(item))
    const next = (currentByText.get(text) || []).filter(item => unmatchedCurrent.has(item))
    if (prior.length === 1 && next.length === 1 && !claimedKeys.has(prior[0].key)) {
      reused.set(next[0], prior[0].key)
      claimedKeys.add(prior[0].key)
      unmatchedPrevious.delete(prior[0])
      unmatchedCurrent.delete(next[0])
    }
  }
}

function matchAutomaticKeys(drafts, previousMetadata) {
  const reused = new Map()
  if (!previousMetadata || drafts.length === 0) return reused

  const previous = historicalDerivedOccurrences(previousMetadata)
  if (previous.length === 0) return reused

  const hostMap = hostCorrespondence(
    new Set(previous.map(item => item.semanticHost)),
    new Set(drafts.map(item => item.semanticHost))
  )
  const previousByGroup = indexBy(previous, item => siblingKey(item.semanticHost, item.childRole))
  const currentByGroup = new Map()
  for (const draft of drafts) {
    const previousHost = hostMap.get(draft.semanticHost)
    if (!previousHost) continue
    const groupKey = siblingKey(previousHost, draft.childRole)
    const group = currentByGroup.get(groupKey) || []
    group.push(draft)
    currentByGroup.set(groupKey, group)
  }

  const claimedKeys = new Set()
  for (const [groupKey, current] of currentByGroup) {
    matchGroup(previousByGroup.get(groupKey) || [], current, reused, claimedKeys)
  }
  return reused
}

function buildCatalog(snapshots, options = {}) {
  const previousMetadata = options && options.previousMetadata != null
    ? upgradeCatalogMetadata(options.previousMetadata)
    : null
  const placements = []
  for (const snapshot of snapshots || []) {
    for (const entry of (snapshot && snapshot.entries) || []) {
      if (!entry || !containsHan(entry.value)) continue
      for (const raw of entry.locations || []) {
        const location = normalizeLocation(raw)
        placements.push({
          value: entry.value,
          explicitKey: entry.key || null,
          location,
          semanticHost: semanticHostOf(snapshot, location)
        })
      }
    }
  }

  // Index siblings the same way metadata does (explicit + automatic), then match only automatic ones.
  const indexingDrafts = placements.map(placement => ({
    placement,
    value: placement.value,
    origin: placement.explicitKey ? 'explicit' : 'derived',
    semanticHost: placement.semanticHost,
    childRole: placement.location.kind,
    location: placement.location,
    key: placement.explicitKey || ''
  }))
  assignOccurrenceIdentities(indexingDrafts)
  const automaticDrafts = indexingDrafts.filter(draft => !draft.placement.explicitKey)
  const reusedKeys = matchAutomaticKeys(automaticDrafts, previousMetadata)
  const keyByPlacement = new Map()
  for (const draft of automaticDrafts) {
    keyByPlacement.set(
      draft.placement,
      reusedKeys.get(draft) || automaticKey({
        path: draft.location.path,
        kind: draft.location.kind,
        value: draft.value,
        location: draft.location
      })
    )
  }

  const byKey = new Map()
  for (const placement of placements) {
    const key = placement.explicitKey || keyByPlacement.get(placement)
    const group = byKey.get(key) || { variants: new Map() }
    const variant = group.variants.get(placement.value) || { explicit: false, placements: [] }
    if (placement.explicitKey) variant.explicit = true
    variant.placements.push({ location: placement.location, semanticHost: placement.semanticHost })
    group.variants.set(placement.value, variant)
    byKey.set(key, group)
  }
  const conflicts = []
  const entries = new Map()
  for (const [key, group] of byKey) {
    const variants = [...group.variants].map(([source, variant]) => {
      const unique = new Map()
      for (const placement of variant.placements) {
        unique.set(locationId(placement.location), placement)
      }
      const placements = [...unique.values()].sort((a, b) => sortLocations(a.location, b.location))
      return {
        source,
        origin: variant.explicit ? 'explicit' : 'derived',
        locations: placements.map(placement => placement.location),
        hostByLocation: new Map(placements.map(placement => [locationId(placement.location), placement.semanticHost]))
      }
    }).sort((a, b) => sortLocations(a.locations[0], b.locations[0]))
    if (variants.length > 1) {
      conflicts.push({
        key,
        variants: variants.map(variant => ({
          source: variant.source,
          origin: variant.origin,
          locations: variant.locations
        }))
      })
      continue
    }
    const [only] = variants
    entries.set(key, {
      source: only.source,
      fingerprint: fingerprintOf(only.source),
      origin: only.origin,
      locations: only.locations,
      hostByLocation: only.hostByLocation
    })
  }
  attachOccurrences(entries)
  return {
    conflicts: conflicts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    entries: sortedObject(entries, entry => entry),
    messages: sortedObject(entries, entry => entry.source)
  }
}

function catalogMetadata(catalog, { sourceLocale, format }) {
  return { version: CATALOG_VERSION, sourceLocale, format, entries: catalog.entries }
}

function migrationError(message) {
  const error = new Error(message)
  error.kind = 'migration'
  return error
}

function upgradeEntryFromV1(entry, key) {
  if (!entry || typeof entry.source !== 'string') {
    throw migrationError(`catalog metadata entry "${key}" is missing source text`)
  }
  if (typeof entry.fingerprint !== 'string' || entry.fingerprint.length === 0) {
    throw migrationError(`catalog metadata entry "${key}" is missing a source fingerprint`)
  }
  if (entry.origin !== 'explicit' && entry.origin !== 'derived') {
    throw migrationError(`catalog metadata entry "${key}" has an unknown origin`)
  }
  if (entry.locations != null && !Array.isArray(entry.locations)) {
    throw migrationError(`catalog metadata entry "${key}" has invalid source locations`)
  }
  const locations = []
  for (const raw of entry.locations || []) {
    try {
      locations.push(normalizeLocation(raw))
    } catch (error) {
      throw migrationError(`catalog metadata entry "${key}" has an invalid source location`)
    }
  }
  return {
    source: entry.source,
    fingerprint: entry.fingerprint,
    origin: entry.origin,
    locations: uniqueLocations(locations).sort(sortLocations),
    occurrences: null
  }
}

function migrateV1ToV2(metadata) {
  if (!metadata.entries || typeof metadata.entries !== 'object' || Array.isArray(metadata.entries)) {
    throw migrationError('catalog metadata version 1 has no entries object')
  }
  const upgraded = new Map()
  const drafts = []
  for (const key of Object.keys(metadata.entries).sort()) {
    const entry = upgradeEntryFromV1(metadata.entries[key], key)
    upgraded.set(key, entry)
    for (const location of entry.locations) {
      drafts.push({
        key,
        origin: entry.origin,
        semanticHost: semanticHostFromLocation(location),
        childRole: location.kind,
        location
      })
    }
  }
  const byKey = new Map()
  for (const { key, occurrence } of assignOccurrenceIdentities(drafts)) {
    const list = byKey.get(key) || []
    list.push(occurrence)
    byKey.set(key, list)
  }
  const entries = {}
  for (const [key, entry] of upgraded) {
    entries[key] = {
      source: entry.source,
      fingerprint: entry.fingerprint,
      origin: entry.origin,
      locations: entry.locations,
      occurrences: (byKey.get(key) || []).sort((a, b) => sortLocations(a.location, b.location))
    }
  }
  return {
    version: CATALOG_VERSION,
    sourceLocale: metadata.sourceLocale,
    format: metadata.format,
    entries
  }
}

function assertCurrentEntry(entry, key) {
  if (!entry || typeof entry.source !== 'string') {
    throw migrationError(`catalog metadata entry "${key}" is missing source text`)
  }
  if (typeof entry.fingerprint !== 'string' || entry.fingerprint.length === 0) {
    throw migrationError(`catalog metadata entry "${key}" is missing a source fingerprint`)
  }
  if (entry.origin !== 'explicit' && entry.origin !== 'derived') {
    throw migrationError(`catalog metadata entry "${key}" has an unknown origin`)
  }
  if (!Array.isArray(entry.locations)) {
    throw migrationError(`catalog metadata entry "${key}" has invalid source locations`)
  }
  if (!Array.isArray(entry.occurrences) || entry.occurrences.length !== entry.locations.length) {
    throw migrationError(`catalog metadata entry "${key}" is missing occurrence identities`)
  }
  for (let index = 0; index < entry.occurrences.length; index += 1) {
    const occurrence = entry.occurrences[index]
    if (!occurrence || typeof occurrence.id !== 'string' || !/^[0-9a-f]{16}$/.test(occurrence.id)) {
      throw migrationError(`catalog metadata entry "${key}" has an invalid occurrence id`)
    }
    if (typeof occurrence.semanticHost !== 'string' || !occurrence.semanticHost) {
      throw migrationError(`catalog metadata entry "${key}" is missing a semantic host`)
    }
    if (typeof occurrence.childRole !== 'string' || !occurrence.childRole) {
      throw migrationError(`catalog metadata entry "${key}" is missing a child role`)
    }
    if (typeof occurrence.localContext !== 'string' || !occurrence.localContext) {
      throw migrationError(`catalog metadata entry "${key}" is missing local context`)
    }
    if (occurrence.origin !== 'explicit' && occurrence.origin !== 'derived') {
      throw migrationError(`catalog metadata entry "${key}" has an unknown occurrence origin`)
    }
    if (!occurrence.location || locationId(normalizeLocation(occurrence.location)) !== locationId(entry.locations[index])) {
      throw migrationError(`catalog metadata entry "${key}" occurrence location does not match locations[${index}]`)
    }
  }
}

function upgradeCatalogMetadata(metadata) {
  if (metadata == null) return null
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw migrationError('catalog metadata must be an object')
  }
  if (metadata.version === CATALOG_VERSION) {
    if (!metadata.entries || typeof metadata.entries !== 'object' || Array.isArray(metadata.entries)) {
      throw migrationError(`catalog metadata version ${CATALOG_VERSION} has no entries object`)
    }
    for (const key of Object.keys(metadata.entries)) assertCurrentEntry(metadata.entries[key], key)
    return metadata
  }
  if (metadata.version === PREVIOUS_CATALOG_VERSION) return migrateV1ToV2(metadata)
  throw migrationError(
    `catalog metadata version ${metadata.version} cannot be upgraded to version ${CATALOG_VERSION}; rewrite catalogs with i18n-collect collect or restore a version ${PREVIOUS_CATALOG_VERSION} or ${CATALOG_VERSION} catalog.meta.json`
  )
}

function metadataEntries(metadata) {
  if (!metadata) return {}
  const upgraded = upgradeCatalogMetadata(metadata)
  const entries = upgraded && upgraded.entries
  return entries && typeof entries === 'object' && !Array.isArray(entries) ? entries : {}
}

function diffCatalog(previous, next) {
  const before = metadataEntries(previous)
  const after = metadataEntries(next)
  const diff = { added: [], removed: [], changed: [], unchanged: [] }
  for (const key of Object.keys(after).sort()) {
    if (!Object.prototype.hasOwnProperty.call(before, key)) diff.added.push(key)
    else if (before[key].fingerprint !== after[key].fingerprint) diff.changed.push(key)
    else diff.unchanged.push(key)
  }
  for (const key of Object.keys(before).sort()) {
    if (!Object.prototype.hasOwnProperty.call(after, key)) diff.removed.push(key)
  }
  return diff
}

function where(location) {
  return `${location.path}:${location.start.line}:${location.start.column} (${location.kind})`
}

function conflictMessage(conflicts) {
  const noun = conflicts.length === 1 ? 'conflict' : 'conflicts'
  const lines = [`i18n-collect failed: ${conflicts.length} localization key ${noun}`]
  for (const conflict of conflicts) {
    lines.push(`  "${conflict.key}" names different source text:`)
    for (const variant of conflict.variants) {
      for (const location of variant.locations) {
        lines.push(`    ${JSON.stringify(variant.source)} (${variant.origin}) at ${where(location)}`)
      }
    }
  }
  lines.push('  Give each source text its own i18n-key, or make the directives agree.')
  return lines.join('\n')
}

function readCatalogMetadataFile(file) {
  if (!fs.existsSync(file)) return null
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(
      `catalog metadata could not be read; restore a valid version 1 or 2 catalog.meta.json (${error.message})`
    )
  }
  return upgradeCatalogMetadata(parsed)
}

module.exports = {
  CATALOG_VERSION,
  automaticKey,
  buildCatalog,
  catalogMetadata,
  conflictMessage,
  deriveKey: automaticKey,
  diffCatalog,
  fingerprintOf,
  readCatalogMetadataFile,
  upgradeCatalogMetadata
}
