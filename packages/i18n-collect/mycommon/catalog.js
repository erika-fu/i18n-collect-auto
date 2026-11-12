const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { containsHan } = require('../myloader/resource')
const { normalizeLocation, sortLocations, uniqueLocations } = require('./store')

const CATALOG_VERSION = 3
const CATALOG_VERSION_V2 = 2
const CATALOG_VERSION_V1 = 1
const REPRESENTATION_SOURCE_TEXT = 'source-text'
const REPRESENTATION_LOCALIZED_CALL = 'localized-call'
const REPRESENTATIONS = new Set([REPRESENTATION_SOURCE_TEXT, REPRESENTATION_LOCALIZED_CALL])
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const OPAQUE_AUTOMATIC_KEY = /^auto\.[0-9A-HJKMNP-TV-Z]{26}$/
const HASH_DICTIONARY_KEY = /^[a-f0-9]{32}$/

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

function encodeCrockford(value, length) {
  let remaining = value
  let out = ''
  for (let index = 0; index < length; index += 1) {
    out = CROCKFORD[remaining % 32] + out
    remaining = Math.floor(remaining / 32)
  }
  return out
}

function createUlid(now = Date.now(), randomBytes = size => crypto.randomBytes(size)) {
  const time = encodeCrockford(now, 10)
  const bytes = randomBytes(10)
  let entropy = 0n
  for (const byte of bytes) entropy = (entropy << 8n) | BigInt(byte)
  let random = ''
  for (let index = 0; index < 16; index += 1) {
    random = CROCKFORD[Number(entropy & 31n)] + random
    entropy >>= 5n
  }
  return `${time}${random}`
}

// Automatic keys identify one occurrence. Fresh assignment is an opaque ULID; later rounds
// reuse a prior key when collection history uniquely matches the occurrence.
function automaticKey(options = {}) {
  const allocate = options && typeof options.createUlid === 'function'
    ? options.createUlid
    : createUlid
  return `auto.${allocate()}`
}

// Keep a freshly allocated automatic key off every reserved historical identity so an old
// translation identity is not reused by collision.
function automaticKeyAvoiding(draft, forbidden, createUlidImpl = createUlid) {
  let key = automaticKey({ createUlid: createUlidImpl })
  while (forbidden.has(key)) key = automaticKey({ createUlid: createUlidImpl })
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
      representation: draft.representation || REPRESENTATION_SOURCE_TEXT,
      location: draft.location
    }
  }))
}

function representationAt(entry, location) {
  if (entry.representationByLocation && entry.representationByLocation.has(locationId(location))) {
    return entry.representationByLocation.get(locationId(location))
  }
  return entry.representation || REPRESENTATION_SOURCE_TEXT
}

function attachOccurrences(entries) {
  const drafts = []
  for (const [key, entry] of entries) {
    for (const location of entry.locations) {
      drafts.push({
        key,
        origin: entry.origin,
        representation: representationAt(entry, location),
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
      representation: entry.representation || REPRESENTATION_SOURCE_TEXT,
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

function appendCallPlacement(entry, placement) {
  const id = locationId(placement.location)
  if (!entry.hostByLocation.has(id)) {
    entry.locations = uniqueLocations(entry.locations.concat([placement.location]))
      .sort(sortLocations)
    entry.hostByLocation.set(id, placement.semanticHost)
  }
  if (!entry.representationByLocation) entry.representationByLocation = new Map()
  entry.representationByLocation.set(id, REPRESENTATION_LOCALIZED_CALL)
}

function isHashDictionaryKey(key) {
  return HASH_DICTIONARY_KEY.test(key)
}

function sameParamSet(actual, expected) {
  const left = [...new Set(actual || [])].sort()
  const right = [...new Set(expected || [])].sort()
  return left.length === right.length && left.every((name, index) => name === right[index])
}

function callParamError(placement, placeholders) {
  const kind = placement.paramsKind || 'none'
  if (kind === 'dynamic') {
    return placeholders.length > 0 ? 'dynamic-params' : null
  }
  const names = kind === 'static' ? (placement.paramNames || []) : []
  return sameParamSet(names, placeholders) ? null : 'placeholder-mismatch'
}

function applyLocalizedCallReferences(entries, callPlacements, previousMetadata, options = {}) {
  const externalKeys = new Set(options.externalKeys || [])
  const retirements = new Set(options.retirements || [])
  const conflictKeys = new Set(options.conflictKeys || [])
  const explicitByKey = new Map((options.explicitMessages || []).map(item => [item.key, item]))
  const previous = previousMetadata ? previousMetadata.entries || {} : {}
  const referenceErrors = []
  const rejectedKeys = new Set()
  for (const placement of callPlacements) {
    const key = placement.explicitKey
    // Legacy MD5 dictionary calls and externalKeys stay outside the project catalog.
    if (!key || externalKeys.has(key) || isHashDictionaryKey(key)) continue
    // Same-round message-contract conflicts already fail collection for this key.
    if (conflictKeys.has(key)) continue
    const declared = explicitByKey.get(key)
    const prior = previous[key]
    const retiredPrior = Boolean(prior && entryStatus(prior) === 'orphaned' && retirements.has(key))
    const retiredAbsent = Boolean(!prior && !entries.has(key) && retirements.has(key))
    if (retiredPrior || retiredAbsent) {
      referenceErrors.push({ key, reason: 'retired', location: placement.location })
      rejectedKeys.add(key)
      continue
    }
    if (!entries.has(key) && !prior && !declared) {
      referenceErrors.push({ key, reason: 'unknown', location: placement.location })
      rejectedKeys.add(key)
      continue
    }

    let source
    let origin
    if (entries.has(key)) {
      const entry = entries.get(key)
      if (declared && declared.source !== entry.source) {
        if (entry.representation === REPRESENTATION_SOURCE_TEXT) {
          referenceErrors.push({ key, reason: 'source-mismatch', location: placement.location })
          rejectedKeys.add(key)
          continue
        }
        entry.source = declared.source
        entry.fingerprint = fingerprintOf(declared.source)
        entry.origin = 'explicit'
      } else if (declared) {
        entry.origin = 'explicit'
      }
      source = entry.source
      origin = entry.origin
    } else if (declared) {
      source = declared.source
      origin = 'explicit'
    } else {
      source = prior.source
      origin = prior.origin
    }

    const placeholders = messageContract(source).placeholders
    const paramError = callParamError(placement, placeholders)
    if (paramError) {
      referenceErrors.push({ key, reason: paramError, location: placement.location })
      rejectedKeys.add(key)
      continue
    }

    if (!entries.has(key)) {
      const representationByLocation = new Map([
        [locationId(placement.location), REPRESENTATION_LOCALIZED_CALL]
      ])
      entries.set(key, {
        source,
        fingerprint: fingerprintOf(source),
        origin,
        representation: REPRESENTATION_LOCALIZED_CALL,
        locations: [placement.location],
        hostByLocation: new Map([[locationId(placement.location), placement.semanticHost]]),
        representationByLocation
      })
      continue
    }
    appendCallPlacement(entries.get(key), placement)
  }
  // Drop call-only seeds that failed validation so a failed round exposes no partial key.
  for (const key of rejectedKeys) {
    const entry = entries.get(key)
    if (!entry) continue
    const representations = entry.representationByLocation
      ? [...entry.representationByLocation.values()]
      : [entry.representation]
    if (!representations.includes(REPRESENTATION_SOURCE_TEXT)) entries.delete(key)
  }
  referenceErrors.sort((a, b) => sortLocations(a.location, b.location) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return referenceErrors
}

function buildCatalog(snapshots, options = {}) {
  const { LEGACY_IDENTITY_METADATA } = require('./legacy-contraction')
  throw migrationError(LEGACY_IDENTITY_METADATA)
  const previousMetadata = options && options.previousMetadata != null
    ? upgradeCatalogMetadata(options.previousMetadata)
    : null
  const createUlidImpl = options && typeof options.createUlid === 'function'
    ? options.createUlid
    : createUlid
  const placements = []
  const callPlacements = []
  for (const snapshot of snapshots || []) {
    for (const entry of (snapshot && snapshot.entries) || []) {
      if (!entry) continue
      const representation = entry.representation || REPRESENTATION_SOURCE_TEXT
      if (representation === REPRESENTATION_LOCALIZED_CALL) {
        if (!entry.key) continue
        for (const raw of entry.locations || []) {
          const location = normalizeLocation(raw)
          callPlacements.push({
            explicitKey: entry.key,
            location,
            semanticHost: semanticHostOf(snapshot, location),
            representation: REPRESENTATION_LOCALIZED_CALL,
            paramNames: Array.isArray(entry.paramNames) ? entry.paramNames : [],
            paramsKind: entry.paramsKind || 'none'
          })
        }
        continue
      }
      if (!containsHan(entry.value)) continue
      for (const raw of entry.locations || []) {
        const location = normalizeLocation(raw)
        placements.push({
          value: entry.value,
          explicitKey: entry.key || null,
          location,
          semanticHost: semanticHostOf(snapshot, location),
          representation: REPRESENTATION_SOURCE_TEXT
        })
      }
    }
  }

  // Index siblings the same way metadata does (explicit + automatic), then match only automatic ones.
  const indexingDrafts = placements.map(placement => ({
    placement,
    value: placement.value,
    origin: placement.explicitKey ? 'explicit' : 'derived',
    representation: placement.representation,
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
  const previousProposedByIdentity = new Map()
  for (const item of options.previousAmbiguities || []) {
    if (!item || typeof item.proposedKey !== 'string') continue
    if (!OPAQUE_AUTOMATIC_KEY.test(item.proposedKey)) continue
    const identity = confirmationIdentity(item)
    if (!previousProposedByIdentity.has(identity)) {
      previousProposedByIdentity.set(identity, item.proposedKey)
    }
  }
  const proposedByDraft = new Map()
  for (const draft of automaticDrafts) {
    let key
    if (matched.reused.has(draft)) {
      key = matched.reused.get(draft)
    } else {
      const priorProposed = previousProposedByIdentity.get(confirmationIdentity(draft))
      key = priorProposed && !proposalReserved.has(priorProposed)
        ? priorProposed
        : automaticKeyAvoiding(draft, proposalReserved, createUlidImpl)
    }
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
      // A prior failed round's proposed auto.<ULID> stays confirmable when the report
      // was cleared or the confirmation names that earlier proposal directly.
      const confirmsPriorProposal = Boolean(
        confirmation &&
        OPAQUE_AUTOMATIC_KEY.test(confirmation.key) &&
        !proposalReserved.has(confirmation.key)
      )
      if (!confirmation) {
        ambiguities.push(ambiguityView(draft, proposedKey, candidates))
      } else if (
        confirmation.key !== proposedKey &&
        !candidates.some(candidate => candidate.key === confirmation.key) &&
        !confirmsPriorProposal
      ) {
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
    if (!matched.reused.has(draft) && assignedKeys.has(key)) {
      key = automaticKeyAvoiding(draft, assignedKeys, createUlidImpl)
    }
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
    variant.placements.push({
      location: placement.location,
      semanticHost: placement.semanticHost,
      representation: placement.representation
    })
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
      const uniquePlacements = [...unique.values()].sort((a, b) => sortLocations(a.location, b.location))
      return {
        source: variant.source,
        origin: variant.explicit ? 'explicit' : 'derived',
        locations: uniquePlacements.map(placement => placement.location),
        hostByLocation: new Map(uniquePlacements.map(placement => [locationId(placement.location), placement.semanticHost])),
        representationByLocation: new Map(uniquePlacements.map(placement => [
          locationId(placement.location),
          placement.representation || REPRESENTATION_SOURCE_TEXT
        ]))
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
      representation: REPRESENTATION_SOURCE_TEXT,
      locations: only.locations,
      hostByLocation: only.hostByLocation,
      representationByLocation: only.representationByLocation
    })
  }
  const conflictKeys = new Set(conflicts.map(item => item.key))
  const referenceErrors = applyLocalizedCallReferences(entries, callPlacements, previousMetadata, {
    externalKeys: options.externalKeys || [],
    retirements: options.retirements || [],
    conflictKeys,
    explicitMessages: options.explicitMessages || []
  })
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
    referenceErrors,
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
    representation: entry.representation || REPRESENTATION_SOURCE_TEXT,
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
    version: CATALOG_VERSION_V2,
    sourceLocale: metadata.sourceLocale,
    format: metadata.format,
    entries
  }
}

function migrateV2ToV3(metadata) {
  if (!metadata.entries || typeof metadata.entries !== 'object' || Array.isArray(metadata.entries)) {
    throw migrationError('catalog metadata version 2 has no entries object')
  }
  const entries = {}
  for (const key of Object.keys(metadata.entries).sort()) {
    const entry = metadata.entries[key]
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
    const occurrences = entry.occurrences.map((occurrence, index) => {
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
      return {
        id: occurrence.id,
        semanticHost: occurrence.semanticHost,
        childRole: occurrence.childRole,
        localContext: occurrence.localContext,
        origin: occurrence.origin,
        representation: REPRESENTATION_SOURCE_TEXT,
        location: occurrence.location
      }
    })
    entries[key] = {
      source: entry.source,
      fingerprint: entry.fingerprint,
      origin: entry.origin,
      representation: REPRESENTATION_SOURCE_TEXT,
      locations: entry.locations,
      occurrences,
      ...(entry.status != null ? { status: entry.status } : {})
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
  if (!REPRESENTATIONS.has(entry.representation)) {
    throw migrationError(`catalog metadata entry "${key}" has an unknown representation`)
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
    if (!REPRESENTATIONS.has(occurrence.representation)) {
      throw migrationError(`catalog metadata entry "${key}" has an unknown occurrence representation`)
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
  const {
    LEGACY_IDENTITY_METADATA,
    hasOccurrenceIdentity
  } = require('./legacy-contraction')
  if (hasOccurrenceIdentity(metadata)) {
    throw migrationError(LEGACY_IDENTITY_METADATA)
  }
  if (metadata.version === CATALOG_VERSION) {
    if (!metadata.entries || typeof metadata.entries !== 'object' || Array.isArray(metadata.entries)) {
      throw migrationError(`catalog metadata version ${CATALOG_VERSION} has no entries object`)
    }
    for (const key of Object.keys(metadata.entries)) assertCurrentEntry(metadata.entries[key], key)
    return metadata
  }
  if (metadata.version === CATALOG_VERSION_V2 || metadata.version === CATALOG_VERSION_V1) {
    throw migrationError(LEGACY_IDENTITY_METADATA)
  }
  throw migrationError(
    `catalog metadata version ${metadata.version} is not supported; run i18n-collect migrate-keys then i18n-collect scan`
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
const AMBIGUITY_REPORT_VERSION = 1
const RETIREMENT_VERSION = 1
const EXPLICIT_MESSAGES_VERSION = 1

function readExplicitMessages(file) {
  if (!fs.existsSync(file)) return []
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`explicit messages could not be read (${error.message})`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('explicit messages must be an object')
  }
  if (parsed.version !== EXPLICIT_MESSAGES_VERSION) {
    throw new Error(
      `explicit messages version ${parsed.version} is unsupported; use version ${EXPLICIT_MESSAGES_VERSION}`
    )
  }
  if (!Array.isArray(parsed.messages)) {
    throw new Error('explicit messages must include a messages array')
  }
  const seen = new Set()
  return parsed.messages.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`explicit message ${index} must be an object`)
    }
    if (typeof item.key !== 'string' || item.key.length === 0) {
      throw new Error(`explicit message ${index} must be a non-empty localization key`)
    }
    if (typeof item.source !== 'string' || item.source.length === 0) {
      throw new Error(`explicit message ${index} must be a non-empty source`)
    }
    if (seen.has(item.key)) throw new Error(`duplicate explicit message for "${item.key}"`)
    seen.add(item.key)
    return { key: item.key, source: item.source }
  })
}

function readIdentityAmbiguities(file) {
  const { LEGACY_IDENTITY_ARTIFACT } = require('./legacy-contraction')
  if (!fs.existsSync(file)) return []
  throw new Error(LEGACY_IDENTITY_ARTIFACT)
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`identity ambiguities could not be read (${error.message})`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('identity ambiguities must be an object')
  }
  if (parsed.version !== AMBIGUITY_REPORT_VERSION) {
    throw new Error(
      `identity ambiguities version ${parsed.version} is unsupported; use version ${AMBIGUITY_REPORT_VERSION}`
    )
  }
  if (!Array.isArray(parsed.ambiguities)) {
    throw new Error('identity ambiguities must include an ambiguities array')
  }
  return parsed.ambiguities.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`identity ambiguity ${index} must be an object`)
    }
    for (const field of ['proposedKey', 'source', 'semanticHost', 'childRole', 'localContext']) {
      if (typeof item[field] !== 'string' || item[field].length === 0) {
        throw new Error(`identity ambiguity ${index} is missing ${field}`)
      }
    }
    if (!item.location || typeof item.location !== 'object' || Array.isArray(item.location)) {
      throw new Error(`identity ambiguity ${index} is missing location`)
    }
    if (!Array.isArray(item.candidates)) {
      throw new Error(`identity ambiguity ${index} must include a candidates array`)
    }
    return {
      proposedKey: item.proposedKey,
      source: item.source,
      semanticHost: item.semanticHost,
      childRole: item.childRole,
      localContext: item.localContext,
      location: item.location,
      candidates: item.candidates,
      ...(item.rejectedConfirmation ? { rejectedConfirmation: item.rejectedConfirmation } : {})
    }
  })
}

function readRetirementConfirmations(file) {
  const { LEGACY_IDENTITY_ARTIFACT } = require('./legacy-contraction')
  if (!fs.existsSync(file)) return []
  throw new Error(LEGACY_IDENTITY_ARTIFACT)
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
  const { LEGACY_IDENTITY_ARTIFACT } = require('./legacy-contraction')
  if (!fs.existsSync(file)) return []
  throw new Error(LEGACY_IDENTITY_ARTIFACT)
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

function referenceReasonLabel(reason) {
  if (reason === 'retired') return 'retired project key'
  if (reason === 'placeholder-mismatch') return 'placeholder mismatch'
  if (reason === 'source-mismatch') return 'source mismatch with the explicit message'
  if (reason === 'dynamic-params') return 'call with dynamic parameters'
  return 'unknown project key'
}

function referenceMessage(referenceErrors) {
  const noun = referenceErrors.length === 1 ? 'reference' : 'references'
  const lines = [`i18n-collect failed: ${referenceErrors.length} localization key ${noun}`]
  for (const error of referenceErrors) {
    lines.push(`  "${error.key}" is a ${referenceReasonLabel(error.reason)} at ${where(error.location)}`)
  }
  lines.push('  Restore the key in catalog metadata, fix the explicit message or call parameters, retire the call, or list it in externalKeys.')
  return lines.join('\n')
}

function readCatalogMetadataFile(file) {
  if (!fs.existsSync(file)) return null
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(
      `catalog metadata could not be read; restore a valid version 1, 2, or 3 catalog.meta.json (${error.message})`
    )
  }
  return upgradeCatalogMetadata(parsed)
}

module.exports = {
  CATALOG_VERSION,
  OPAQUE_AUTOMATIC_KEY,
  REPRESENTATION_LOCALIZED_CALL,
  REPRESENTATION_SOURCE_TEXT,
  automaticKey,
  ambiguityMessage,
  buildCatalog,
  catalogMetadata,
  conflictMessage,
  createUlid,
  deriveKey: automaticKey,
  diffCatalog,
  entryStatus,
  fingerprintOf,
  messageContract,
  readCatalogMetadataFile,
  readExplicitMessages,
  readIdentityAmbiguities,
  readIdentityConfirmations,
  readRetirementConfirmations,
  referenceMessage,
  upgradeCatalogMetadata
}
