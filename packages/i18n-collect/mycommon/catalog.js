const crypto = require('crypto')
const path = require('path')
const { containsHan } = require('../myloader/resource')
const { normalizeLocation, sortLocations, uniqueLocations } = require('./store')

const CATALOG_VERSION = 1

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

// The hash input leaves out line and column so moving text inside a file keeps its key.
function deriveKey({ path: projectPath, kind, value }) {
  return `${pathSlug(projectPath)}.${sha256(`${projectPath}\0${kind}\0${value}`).slice(0, 8)}`
}

function sortedObject(map, project) {
  return Object.fromEntries([...map.keys()].sort().map(key => [key, project(map.get(key))]))
}

function buildCatalog(snapshots) {
  const byKey = new Map()
  for (const snapshot of snapshots || []) {
    for (const entry of (snapshot && snapshot.entries) || []) {
      if (!entry || !containsHan(entry.value)) continue
      for (const raw of entry.locations || []) {
        const location = normalizeLocation(raw)
        const key = entry.key || deriveKey({ path: location.path, kind: location.kind, value: entry.value })
        const group = byKey.get(key) || { variants: new Map() }
        const variant = group.variants.get(entry.value) || { explicit: false, locations: [] }
        if (entry.key) variant.explicit = true
        variant.locations.push(location)
        group.variants.set(entry.value, variant)
        byKey.set(key, group)
      }
    }
  }
  const conflicts = []
  const entries = new Map()
  for (const [key, group] of byKey) {
    const variants = [...group.variants].map(([source, variant]) => ({
      source,
      origin: variant.explicit ? 'explicit' : 'derived',
      locations: uniqueLocations(variant.locations).sort(sortLocations)
    })).sort((a, b) => sortLocations(a.locations[0], b.locations[0]))
    if (variants.length > 1) {
      conflicts.push({ key, variants })
      continue
    }
    const [only] = variants
    entries.set(key, {
      source: only.source,
      fingerprint: fingerprintOf(only.source),
      origin: only.origin,
      locations: only.locations
    })
  }
  return {
    conflicts: conflicts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    entries: sortedObject(entries, entry => entry),
    messages: sortedObject(entries, entry => entry.source)
  }
}

function catalogMetadata(catalog, { sourceLocale, format }) {
  return { version: CATALOG_VERSION, sourceLocale, format, entries: catalog.entries }
}

function metadataEntries(metadata) {
  const entries = metadata && metadata.version === CATALOG_VERSION && metadata.entries
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

module.exports = {
  CATALOG_VERSION,
  buildCatalog,
  catalogMetadata,
  conflictMessage,
  deriveKey,
  diffCatalog,
  fingerprintOf
}
