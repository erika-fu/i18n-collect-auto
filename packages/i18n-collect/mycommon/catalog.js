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

// Current normalization boundary: literal static text is kept as-is; only simple
// `{identifier}` tokens become positional slots. Whitespace, ICU selects, and
// non-identifier braces are not folded — extend here when those rules land.
const PLACEHOLDER_TOKEN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

function messageContract(source) {
  const placeholders = []
  const pattern = String(source).replace(PLACEHOLDER_TOKEN, (_match, name) => {
    const index = placeholders.length
    placeholders.push(name)
    return `{${index}}`
  })
  return { pattern, placeholders }
}

function compatibilityKey(contract) {
  return `${contract.pattern}\0${contract.placeholders.join('\0')}`
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

// An unmoved occurrence hashes to the same automatic key as its first sighting.
// When this round did not uniquely match that history, keep the new assignment
// off every historical key so an old translation identity is not reused by collision.
function automaticKeyAvoiding(draft, forbidden) {
  const natural = automaticKey({
    path: draft.location.path,
    kind: draft.location.kind,
    value: draft.value,
    location: draft.location
  })
  if (!forbidden.has(natural)) return natural
  const slug = natural.slice(0, natural.lastIndexOf('.'))
  let salt = 1
  let key = natural
  while (forbidden.has(key)) {
    key = `${slug}.${sha256(`${natural}\0${salt}`).slice(0, 8)}`
    salt += 1
  }
  return key
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

function candidateOf(item) {
  return {
    key: item.key,
    source: item.source,
    semanticHost: item.semanticHost,
    childRole: item.childRole,
    localContext: item.localContext
  }
}

function confirmationIdentity(item) {
  return `${item.semanticHost}\0${item.childRole}\0${item.localContext}`
}

function ambiguityView(draft, proposedKey, candidates, rejectedConfirmation) {
  const view = {
    proposedKey,
    source: draft.value,
    semanticHost: draft.semanticHost,
    childRole: draft.childRole,
    localContext: draft.localContext,
    location: draft.location,
    candidates
  }
  if (rejectedConfirmation) view.rejectedConfirmation = rejectedConfirmation
  return view
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

  return {
    unmatchedPrevious: [...unmatchedPrevious],
    unmatchedCurrent: [...unmatchedCurrent]
  }
}

function matchAutomaticKeys(drafts, previousMetadata) {
  const reused = new Map()
  const ambiguities = []
  if (!previousMetadata || drafts.length === 0) return { reused, ambiguities }

  const previous = historicalDerivedOccurrences(previousMetadata)
  if (previous.length === 0) return { reused, ambiguities }

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
    const groupMatch = matchGroup(previousByGroup.get(groupKey) || [], current, reused, claimedKeys)
    for (const draft of groupMatch.unmatchedCurrent) {
      const candidates = groupMatch.unmatchedPrevious
        .filter(item => item.source === draft.value)
        .map(candidateOf)
        .sort(compareCandidates)
      if (candidates.length >= 2) ambiguities.push({ draft, candidates })
    }
  }

  const mappedPreviousHosts = new Set(hostMap.values())
  const unmappedPrevious = previous.filter(item =>
    !claimedKeys.has(item.key) && !mappedPreviousHosts.has(item.semanticHost)
  )
  for (const draft of drafts) {
    if (reused.has(draft) || hostMap.has(draft.semanticHost)) continue
    const candidates = unmappedPrevious
      .filter(item =>
        item.childRole === draft.childRole &&
        semanticBlockSuffix(item.semanticHost) === semanticBlockSuffix(draft.semanticHost) &&
        item.source === draft.value
      )
      .map(candidateOf)
      .sort(compareCandidates)
    if (candidates.length >= 2) ambiguities.push({ draft, candidates })
  }
  return { reused, ambiguities }
}

function compareCandidates(a, b) {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
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
  const matched = matchAutomaticKeys(automaticDrafts, previousMetadata)
  const proposalReserved = new Set(
    historicalDerivedOccurrences(previousMetadata).map(item => item.key)
  )
  const proposedByDraft = new Map()
  for (const draft of automaticDrafts) {
    const key = matched.reused.has(draft)
      ? matched.reused.get(draft)
      : automaticKeyAvoiding(draft, proposalReserved)
    proposalReserved.add(key)
    proposedByDraft.set(draft, key)
  }
  const confirmationByIdentity = new Map(
    (options.confirmations || []).map(item => [confirmationIdentity(item), item])
  )
  const candidatesByDraft = new Map(matched.ambiguities.map(item => [item.draft, item.candidates]))
  const assignedKeys = new Set()
  const keyByPlacement = new Map()
  const ambiguities = []
  for (const draft of automaticDrafts) {
    const proposedKey = proposedByDraft.get(draft)
    const candidates = candidatesByDraft.get(draft)
    let key = matched.reused.get(draft) || proposedKey
    if (candidates && !matched.reused.has(draft)) {
      const confirmation = confirmationByIdentity.get(confirmationIdentity(draft))
      if (!confirmation) {
        ambiguities.push(ambiguityView(draft, proposedKey, candidates))
      } else if (confirmation.key !== proposedKey && !candidates.some(candidate => candidate.key === confirmation.key)) {
        ambiguities.push(ambiguityView(
          draft,
          proposedKey,
          candidates,
          `"${confirmation.key}" is not a historical candidate or the proposed key`
        ))
      } else if (assignedKeys.has(confirmation.key)) {
        ambiguities.push(ambiguityView(
          draft,
          proposedKey,
          candidates,
          `"${confirmation.key}" is already confirmed for another occurrence`
        ))
      } else {
        key = confirmation.key
      }
    }
    if (!matched.reused.has(draft) && assignedKeys.has(key)) key = automaticKeyAvoiding(draft, assignedKeys)
    assignedKeys.add(key)
    keyByPlacement.set(draft.placement, key)
  }

  const byKey = new Map()
  for (const placement of placements) {
    const key = placement.explicitKey || keyByPlacement.get(placement)
    const group = byKey.get(key) || { variants: new Map() }
    const id = compatibilityKey(messageContract(placement.value))
    const variant = group.variants.get(id) || { explicit: false, source: placement.value, placements: [] }
    if (placement.explicitKey) variant.explicit = true
    variant.placements.push({ location: placement.location, semanticHost: placement.semanticHost })
    group.variants.set(id, variant)
    byKey.set(key, group)
  }
  const conflicts = []
  const entries = new Map()
  for (const [key, group] of byKey) {
    const variants = [...group.variants.values()].map(variant => {
      const unique = new Map()
      for (const placement of variant.placements) {
        unique.set(locationId(placement.location), placement)
      }
      const placements = [...unique.values()].sort((a, b) => sortLocations(a.location, b.location))
      return {
        source: variant.source,
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
  ambiguities.sort((a, b) => sortLocations(a.location, b.location))
  const active = sortedObject(entries, entry => ({ ...entry, status: 'active' }))
  const lifecycle = applyOccurrenceLifecycle(active, previousMetadata, {
    retirements: options.retirements || [],
    prune: Boolean(options.prune)
  })
  return {
    ambiguities,
    conflicts: conflicts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    entries: lifecycle.entries,
    messages: sortedObject(
      new Map(Object.entries(lifecycle.entries).filter(([, entry]) => entryStatus(entry) === 'active')),
      entry => entry.source
    ),
    orphaned: lifecycle.orphaned,
    retired: lifecycle.retired
  }
}

function entryStatus(entry) {
  return entry && entry.status === 'orphaned' ? 'orphaned' : 'active'
}

function cloneMetadataEntry(entry, status) {
  return {
    source: entry.source,
    fingerprint: entry.fingerprint,
    origin: entry.origin,
    locations: entry.locations,
    occurrences: entry.occurrences,
    status
  }
}

function applyOccurrenceLifecycle(activeEntries, previousMetadata, { retirements = [], prune = false } = {}) {
  const retiredKeys = new Set(retirements)
  const previous = previousMetadata ? previousMetadata.entries || {} : {}
  const entries = new Map()
  for (const [key, entry] of Object.entries(activeEntries || {})) {
    entries.set(key, cloneMetadataEntry(entry, 'active'))
  }
  const orphaned = []
  const retired = []
  for (const key of Object.keys(previous).sort()) {
    if (entries.has(key)) continue
    const prior = previous[key]
    if (!prior) continue
    if (retiredKeys.has(key) || prune) {
      retired.push(key)
      continue
    }
    entries.set(key, cloneMetadataEntry(prior, 'orphaned'))
    orphaned.push(key)
  }
  return {
    entries: sortedObject(entries, entry => entry),
    orphaned,
    retired
  }
}

function catalogMetadata(catalog, { sourceLocale, format }) {
  const entries = {}
  for (const key of Object.keys(catalog.entries || {}).sort()) {
    const entry = catalog.entries[key]
    entries[key] = cloneMetadataEntry(entry, entryStatus(entry))
  }
  return { version: CATALOG_VERSION, sourceLocale, format, entries }
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
  if (entry.status != null && entry.status !== 'active' && entry.status !== 'orphaned') {
    throw migrationError(`catalog metadata entry "${key}" has an unknown status`)
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
  const diff = { added: [], removed: [], changed: [], unchanged: [], orphaned: [], recovered: [] }
  for (const key of Object.keys(after).sort()) {
    const afterEntry = after[key]
    if (entryStatus(afterEntry) === 'orphaned') {
      diff.orphaned.push(key)
      continue
    }
    const beforeEntry = before[key]
    if (!beforeEntry) diff.added.push(key)
    else if (entryStatus(beforeEntry) === 'orphaned') diff.recovered.push(key)
    else if (beforeEntry.fingerprint !== afterEntry.fingerprint) diff.changed.push(key)
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

function ambiguityMessage(ambiguities, reportPath) {
  const noun = ambiguities.length === 1 ? 'ambiguity' : 'ambiguities'
  const lines = [`i18n-collect failed: ${ambiguities.length} occurrence identity ${noun}`]
  if (reportPath) lines.push(`  Ambiguity report: ${reportPath}`)
  for (const item of ambiguities) {
    lines.push(`  ${where(item.location)} ${JSON.stringify(item.source)} proposed ${item.proposedKey}`)
    for (const candidate of item.candidates) {
      lines.push(`    candidate ${candidate.key} ${JSON.stringify(candidate.source)} at ${candidate.semanticHost} ${candidate.localContext}`)
    }
    if (item.rejectedConfirmation) lines.push(`    confirmation rejected: ${item.rejectedConfirmation}`)
  }
  lines.push('  Add an i18n-key directive, or record the chosen key in identity-confirmations.json.')
  return lines.join('\n')
}

const CONFIRMATION_VERSION = 1
const RETIREMENT_VERSION = 1

function readRetirementConfirmations(file) {
  if (!fs.existsSync(file)) return []
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`retirement confirmations could not be read (${error.message})`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('retirement confirmations must be an object')
  }
  if (parsed.version !== RETIREMENT_VERSION) {
    throw new Error(`retirement confirmations version ${parsed.version} is unsupported; use version ${RETIREMENT_VERSION}`)
  }
  if (!Array.isArray(parsed.keys)) {
    throw new Error('retirement confirmations must include a keys array')
  }
  const seen = new Set()
  return parsed.keys.map((key, index) => {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error(`retirement confirmation ${index} must be a non-empty localization key`)
    }
    if (seen.has(key)) throw new Error(`duplicate retirement confirmation for "${key}"`)
    seen.add(key)
    return key
  })
}

function readIdentityConfirmations(file) {
  if (!fs.existsSync(file)) return []
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`identity confirmations could not be read (${error.message})`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('identity confirmations must be an object')
  }
  if (parsed.version !== CONFIRMATION_VERSION) {
    throw new Error(`identity confirmations version ${parsed.version} is unsupported; use version ${CONFIRMATION_VERSION}`)
  }
  if (!Array.isArray(parsed.confirmations)) {
    throw new Error('identity confirmations must include a confirmations array')
  }
  const seen = new Set()
  return parsed.confirmations.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`identity confirmation ${index} must be an object`)
    }
    for (const field of ['semanticHost', 'childRole', 'localContext', 'key']) {
      if (typeof item[field] !== 'string' || item[field].length === 0) {
        throw new Error(`identity confirmation ${index} is missing ${field}`)
      }
    }
    const id = confirmationIdentity(item)
    if (seen.has(id)) {
      throw new Error(`duplicate identity confirmation for ${item.semanticHost} ${item.childRole} ${item.localContext}`)
    }
    seen.add(id)
    return {
      semanticHost: item.semanticHost,
      childRole: item.childRole,
      localContext: item.localContext,
      key: item.key
    }
  })
}

function conflictMessage(conflicts) {
  const noun = conflicts.length === 1 ? 'conflict' : 'conflicts'
  const lines = [`i18n-collect failed: ${conflicts.length} localization key ${noun}`]
  for (const conflict of conflicts) {
    lines.push(`  "${conflict.key}" names incompatible message contracts:`)
    for (const variant of conflict.variants) {
      for (const location of variant.locations) {
        lines.push(`    ${JSON.stringify(variant.source)} (${variant.origin}) at ${where(location)}`)
      }
    }
  }
  lines.push('  Give each message its own i18n-key, or make the message patterns and placeholders agree.')
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
  ambiguityMessage,
  buildCatalog,
  catalogMetadata,
  conflictMessage,
  deriveKey: automaticKey,
  diffCatalog,
  entryStatus,
  fingerprintOf,
  messageContract,
  readCatalogMetadataFile,
  readIdentityConfirmations,
  readRetirementConfirmations,
  upgradeCatalogMetadata
}
