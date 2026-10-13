const crypto = require('crypto')
const path = require('path')
const { containsHan } = require('../myloader/resource')

const SEMANTIC_KINDS = new Set([
  'script-string',
  'template-literal',
  'html-text',
  'html-attribute',
  'template-expression',
  'css-generated-content',
  'static-html-text',
  'static-html-attribute'
])

function keyFor(value) {
  return crypto.createHash('md5').update(value, 'utf8').digest('hex')
}

function normalizeLocation(location) {
  if (!location || typeof location.path !== 'string' || !SEMANTIC_KINDS.has(location.kind)) {
    throw new Error('Invalid collection location')
  }
  for (const position of ['start', 'end']) {
    if (!location[position] || !Number.isInteger(location[position].line) || !Number.isInteger(location[position].column)) {
      throw new Error('Invalid collection location range')
    }
  }
  return {
    path: location.path.split(path.sep).join('/'),
    kind: location.kind,
    start: { line: location.start.line, column: location.start.column },
    end: { line: location.end.line, column: location.end.column }
  }
}

function locationId(location) {
  return JSON.stringify(location)
}

function compareNumber(left, right) {
  return left - right
}

function sortLocations(a, b) {
  return a.path.localeCompare(b.path) ||
    a.kind.localeCompare(b.kind) ||
    compareNumber(a.start.line, b.start.line) ||
    compareNumber(a.start.column, b.start.column) ||
    compareNumber(a.end.line, b.end.line) ||
    compareNumber(a.end.column, b.end.column)
}

function uniqueLocations(locations) {
  const seen = new Set()
  return locations.filter(location => {
    const id = locationId(location)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

class CollectionStore {
  constructor() {
    this.resources = new Map()
  }

  replaceSnapshot(resource, entries = []) {
    if (typeof resource !== 'string' || !resource) throw new Error('Resource identity is required')
    const snapshot = new Map()
    for (const entry of entries) {
      if (!entry || !containsHan(entry.value)) continue
      const key = keyFor(entry.value)
      const current = snapshot.get(key) || { value: entry.value, locations: [] }
      current.locations = uniqueLocations(current.locations.concat((entry.locations || []).map(normalizeLocation)))
      snapshot.set(key, current)
    }
    this.resources.set(resource, snapshot)
  }

  runtimeDictionary() {
    const values = new Map()
    for (const snapshot of this.resources.values()) {
      for (const [key, entry] of snapshot) values.set(key, entry.value)
    }
    return Object.fromEntries([...values].sort(([a], [b]) => a.localeCompare(b)))
  }

  sourceMap(configHash) {
    const merged = new Map()
    for (const snapshot of this.resources.values()) {
      for (const [key, entry] of snapshot) {
        const current = merged.get(key) || { value: entry.value, locations: [] }
        current.locations = uniqueLocations(current.locations.concat(entry.locations))
        merged.set(key, current)
      }
    }
    const entries = [...merged].map(([key, entry]) => ({
      key,
      value: entry.value,
      locations: entry.locations.sort(sortLocations)
    })).sort((a, b) => a.key.localeCompare(b.key))
    return { version: 1, parserVersion: 'babel-7', configHash, entries }
  }
}

module.exports = { CollectionStore, SEMANTIC_KINDS, keyFor, normalizeLocation, sortLocations, uniqueLocations }
