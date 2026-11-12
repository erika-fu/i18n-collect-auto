const MIGRATE_KEYS = 'i18n-collect migrate-keys'
const SCAN = 'i18n-collect scan'
const COLLECT = 'i18n-collect collect'
const CHECK = 'i18n-collect check'
const TRANSLATE = 'i18n-collect translate'
const REPLACE = 'i18n-collect replace'
const BUILD = 'i18n-collect build'

const VERIFY_REMOVED =
  `verify is removed. Use ${COLLECT} then ${CHECK} for freshness and project localization completeness.`

const RUN_REMOVED =
  `run is removed. Use ${COLLECT}, ${TRANSLATE}, ${REPLACE}, ${BUILD}, and ${CHECK} directly.`

const CHECK_POLICY_REMOVED =
  `check-policy is removed. Use ${CHECK}; it evaluates project localization completeness including complete-static-copy and runtime-multilingual policy.`

const PRUNE_ORPHANED_REMOVED =
  'pruneOrphaned is removed. Orphan retirement is no longer part of the localization workflow; use collect, translate --prune for stale target keys, and migrate-keys for legacy catalogs.'

const LEGACY_IDENTITY_METADATA =
  `catalog metadata still uses per-occurrence identity state. Run ${MIGRATE_KEYS}, then ${COLLECT} (or ${SCAN}), before continuing.`

const PREPROCESSOR_STYLE_IR_REMOVED =
  'full Style IR collection for SCSS, Sass, Less, and Stylus is removed; those surfaces are Chinese source audit candidates via collect/check only.'

function migrationError(message, kind = 'configuration') {
  const error = new Error(message)
  error.kind = kind
  return error
}

function hasOccurrenceIdentity(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const entries = metadata.entries
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return false
  for (const key of Object.keys(entries)) {
    if (/^auto\./.test(key)) return true
    const entry = entries[key]
    if (!entry || typeof entry !== 'object') continue
    if (entry.status === 'orphaned') return true
    const occurrences = entry.occurrences
    if (!Array.isArray(occurrences)) continue
    for (const occurrence of occurrences) {
      if (!occurrence || typeof occurrence !== 'object') continue
      if (typeof occurrence.id === 'string' && occurrence.id) return true
      if (typeof occurrence.semanticHost === 'string' && occurrence.semanticHost) return true
      if (typeof occurrence.localContext === 'string' && occurrence.localContext) return true
    }
  }
  return false
}

function assertNoLegacyIdentityMetadata(metadata) {
  if (hasOccurrenceIdentity(metadata)) {
    throw migrationError(LEGACY_IDENTITY_METADATA)
  }
  return metadata
}

module.exports = {
  BUILD,
  CHECK,
  CHECK_POLICY_REMOVED,
  COLLECT,
  LEGACY_IDENTITY_METADATA,
  MIGRATE_KEYS,
  PREPROCESSOR_STYLE_IR_REMOVED,
  PRUNE_ORPHANED_REMOVED,
  REPLACE,
  RUN_REMOVED,
  SCAN,
  TRANSLATE,
  VERIFY_REMOVED,
  assertNoLegacyIdentityMetadata,
  hasOccurrenceIdentity,
  migrationError
}
