const crypto = require('crypto')
const fs = require('fs')
const { normalizeLocation } = require('./store')

const CATALOG_VERSION = 3
const CATALOG_VERSION_V2 = 2
const CATALOG_VERSION_V1 = 1
const REPRESENTATION_SOURCE_TEXT = 'source-text'
const REPRESENTATION_LOCALIZED_CALL = 'localized-call'
const REPRESENTATIONS = new Set([REPRESENTATION_SOURCE_TEXT, REPRESENTATION_LOCALIZED_CALL])
const OPAQUE_AUTOMATIC_KEY = /^auto\.[0-9A-HJKMNP-TV-Z]{26}$/
const EXPLICIT_MESSAGES_VERSION = 1

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

function migrationError(message) {
  const error = new Error(message)
  error.kind = 'migration'
  return error
}

function locationId(location) {
  return JSON.stringify(location)
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

function where(location) {
  return `${location.path}:${location.start.line}:${location.start.column} (${location.kind})`
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

module.exports = {
  CATALOG_VERSION,
  OPAQUE_AUTOMATIC_KEY,
  REPRESENTATION_LOCALIZED_CALL,
  REPRESENTATION_SOURCE_TEXT,
  fingerprintOf,
  messageContract,
  readExplicitMessages,
  referenceMessage,
  upgradeCatalogMetadata
}
