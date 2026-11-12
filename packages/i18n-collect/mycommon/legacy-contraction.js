const MIGRATE_KEYS = 'i18n-collect migrate-keys'
const SCAN = 'i18n-collect scan'
const CHECK = 'i18n-collect check'
const TRANSLATE = 'i18n-collect translate'
const REPLACE = 'i18n-collect replace'
const BUILD = 'i18n-collect build'

const COLLECT_REMOVED =
  `collect is removed. Use ${SCAN} for source analysis and ${MIGRATE_KEYS} once for per-occurrence catalogs.`

const VERIFY_REMOVED =
  `verify is removed. Use ${SCAN} then ${CHECK} for freshness and project localization completeness.`

const RUN_REMOVED =
  `run is removed. Use ${SCAN}, ${TRANSLATE}, ${REPLACE}, ${BUILD}, and ${CHECK} directly.`

const RUN_COLLECT_REMOVED =
  `run --collect is removed. Use ${SCAN} for source analysis and ${MIGRATE_KEYS} once for per-occurrence catalogs.`

const CHECK_POLICY_REMOVED =
  `check-policy is removed. Use ${CHECK}; it evaluates project localization completeness including complete-static-copy and runtime-multilingual policy.`

const PRUNE_ORPHANED_REMOVED =
  'pruneOrphaned is removed. Orphan retirement is no longer part of the localization workflow; use scan, translate --prune for stale target keys, and migrate-keys for legacy catalogs.'

const PLUGIN_COLLECTION_REMOVED =
  `MyI18nPlugin catalog collection is removed. Use ${SCAN} for source analysis; keep webpack integration only for i18n-collect build replacement.`

const LEGACY_IDENTITY_METADATA =
  `catalog metadata still uses per-occurrence identity state. Run ${MIGRATE_KEYS}, then ${SCAN}, before continuing.`

const LEGACY_IDENTITY_ARTIFACT =
  `legacy identity artifact is no longer read. Remove identity-confirmations.json, identity-ambiguities.json, and retirement-confirmations.json after ${MIGRATE_KEYS}.`

const PREPROCESSOR_STYLE_IR_REMOVED =
  'full Style IR collection for SCSS, Sass, Less, and Stylus is removed; those surfaces are Chinese source audit candidates via scan/check only.'

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
  COLLECT_REMOVED,
  LEGACY_IDENTITY_ARTIFACT,
  LEGACY_IDENTITY_METADATA,
  MIGRATE_KEYS,
  PLUGIN_COLLECTION_REMOVED,
  PREPROCESSOR_STYLE_IR_REMOVED,
  PRUNE_ORPHANED_REMOVED,
  REPLACE,
  RUN_COLLECT_REMOVED,
  RUN_REMOVED,
  SCAN,
  TRANSLATE,
  VERIFY_REMOVED,
  assertNoLegacyIdentityMetadata,
  hasOccurrenceIdentity,
  migrationError
}
