const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { CATALOG_FORMATS, catalogFormat } = require('./catalog-format')
const { isGlobPattern, normalizeGlobPattern } = require('./scope-pattern')

const CONFIG_FILE = 'i18n-collect.config.js'
const CONTEXT_FILTERS = new Set(['logging', 'tests', 'analytics'])
const CATALOG_METADATA_FILE = 'catalog.meta.json'
const IDENTITY_CONFIRMATIONS_FILE = 'identity-confirmations.json'
const IDENTITY_AMBIGUITIES_FILE = 'identity-ambiguities.json'
const RETIREMENT_CONFIRMATIONS_FILE = 'retirement-confirmations.json'
const LOCALE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/

const DEFAULTS = {
  styleExtensions: ['.css'],
  include: [],
  exclude: [],
  contextFilters: [],
  attributeAllowlist: ['title', 'placeholder', 'alt', 'aria-label', 'value'],
  outputPath: 'lang/zh_hash.json',
  sourceMapFilename: 'lang/zh_hash.map.json',
  catalogDir: 'lang/catalog',
  sourceLocale: 'zh',
  catalogFormat: 'json',
  translationProvider: '',
  targetLocales: [],
  translationFailure: 'partial',
  pruneOrphaned: false
}

const FIELDS = new Set(Object.keys(DEFAULTS))
const LOADER_FIELDS = new Set(['include', 'exclude', 'contextFilters', 'attributeAllowlist', 'styleExtensions'])
const CATALOG_FIELDS = ['catalogDir', 'sourceLocale', 'catalogFormat', 'pruneOrphaned']
const TRANSLATION_FIELDS = ['translationProvider', 'targetLocales', 'translationFailure']
const FAILURE_POLICIES = new Set(['partial', 'strict'])
const PLUGIN_FIELDS = new Set(['outputPath', 'sourceMapFilename', ...CATALOG_FIELDS])
const SCOPE_OVERRIDE_FIELDS = ['include', 'exclude', 'contextFilters']
let scopeOverrides = null

function setCollectionOverrides(overrides) {
  scopeOverrides = overrides
}

function clearCollectionOverrides() {
  scopeOverrides = null
}

function fail(message) {
  throw new Error(`Invalid ${CONFIG_FILE}: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function projectPath(root, value, field) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) {
    fail(`${field} must be a project-relative path`)
  }
  const absolute = path.resolve(root, value)
  const relative = path.relative(root, absolute)
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) {
    fail(`${field} must stay inside the project root`)
  }
  return value.split(path.sep).join('/')
}

function array(value, field, valid, invalidMessage) {
  if (!Array.isArray(value) || value.some(item => !valid(item))) {
    fail(invalidMessage || `${field} must be an array of valid values`)
  }
  if (new Set(value).size !== value.length) fail(`${field} must not contain duplicates`)
}

function normalizeFilterPattern(root, pattern, field) {
  if (typeof pattern !== 'string') {
    throw new Error(`${field} must be an array of valid values`)
  }
  if (pattern.length === 0) {
    throw new Error(`${field} must not be empty or the project root`)
  }
  const slashed = pattern.replace(/\\/g, '/')
  if (slashed.startsWith('/') || /^[A-Za-z]:\//.test(slashed)) {
    throw new Error(`${field} must be a project-relative path`)
  }
  if (isGlobPattern(slashed)) return normalizeGlobPattern(slashed, field)
  const absolute = path.resolve(root, slashed)
  const relative = path.relative(root, absolute)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || relative.startsWith('../')) {
    throw new Error(`${field} must stay inside the project root`)
  }
  if (!relative || relative === '.') {
    throw new Error(`${field} must not be empty or the project root`)
  }
  return relative.split(path.sep).join('/')
}

function filterList(root, values, field) {
  if (!Array.isArray(values)) fail(`${field} must be an array of valid values`)
  const normalized = []
  for (const value of values) {
    try {
      normalized.push(normalizeFilterPattern(root, value, field))
    } catch (error) {
      fail(error.message)
    }
  }
  if (new Set(normalized).size !== normalized.length) fail(`${field} must not contain duplicates`)
  return normalized
}

function validate(root, input) {
  if (!isObject(input)) fail('must export an object')
  Object.keys(input).forEach(key => {
    if (!FIELDS.has(key)) fail(`unknown field "${key}"`)
  })
  const config = { ...DEFAULTS, ...input }
  array(config.styleExtensions, 'styleExtensions', value => /^(\.[a-z0-9]+)+$/i.test(value))
  array(config.attributeAllowlist, 'attributeAllowlist', value => typeof value === 'string' && value.length > 0)
  array(
    config.contextFilters,
    'contextFilters',
    value => CONTEXT_FILTERS.has(value),
    'contextFilters must be an array of "logging", "tests", and "analytics"'
  )
  config.include = filterList(root, config.include, 'include')
  config.exclude = filterList(root, config.exclude, 'exclude')
  config.outputPath = projectPath(root, config.outputPath, 'outputPath')
  config.sourceMapFilename = projectPath(root, config.sourceMapFilename, 'sourceMapFilename')
  if (config.outputPath === config.sourceMapFilename) fail('outputPath and sourceMapFilename must differ')
  config.catalogDir = projectPath(root, config.catalogDir, 'catalogDir').replace(/\/+$/, '')
  if (typeof config.sourceLocale !== 'string' || !LOCALE.test(config.sourceLocale)) {
    fail('sourceLocale must be a locale tag such as "zh" or "zh-CN"')
  }
  if (!CATALOG_FORMATS.includes(config.catalogFormat)) {
    fail(`catalogFormat must be one of ${CATALOG_FORMATS.map(name => `"${name}"`).join(', ')}`)
  }
  const files = catalogFiles(config)
  if ([files.messages, files.metadata].some(file => file === config.outputPath || file === config.sourceMapFilename)) {
    fail('catalog files must differ from outputPath and sourceMapFilename')
  }
  if (typeof config.translationProvider !== 'string') fail('translationProvider must be a project-relative path')
  if (config.translationProvider) {
    config.translationProvider = projectPath(root, config.translationProvider, 'translationProvider')
  }
  array(
    config.targetLocales,
    'targetLocales',
    value => LOCALE.test(value),
    'targetLocales must be an array of locale tags such as "en" or "en-US"'
  )
  if (config.targetLocales.includes(config.sourceLocale)) fail('targetLocales must not include sourceLocale')
  if (!FAILURE_POLICIES.has(config.translationFailure)) {
    fail('translationFailure must be "partial" or "strict"')
  }
  if (typeof config.pruneOrphaned !== 'boolean') fail('pruneOrphaned must be a boolean')
  return config
}

function catalogFiles(config) {
  const extension = catalogFormat(config.catalogFormat).extension
  return {
    messages: path.posix.join(config.catalogDir, `${config.sourceLocale}${extension}`),
    metadata: path.posix.join(config.catalogDir, CATALOG_METADATA_FILE)
  }
}

function identityFiles(config) {
  return {
    confirmations: path.posix.join(config.catalogDir, IDENTITY_CONFIRMATIONS_FILE),
    ambiguities: path.posix.join(config.catalogDir, IDENTITY_AMBIGUITIES_FILE),
    retirements: path.posix.join(config.catalogDir, RETIREMENT_CONFIRMATIONS_FILE)
  }
}

function merge(base, options, allowed) {
  if (options === undefined) return base
  if (!isObject(options)) fail('explicit options must be an object')
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail(`unknown explicit option "${key}"`)
  }
  return { ...base, ...options }
}

function hashConfig(config) {
  return crypto.createHash('md5').update(JSON.stringify(config)).digest('hex')
}

// Catalog and translation settings stay out of both hashes so the source map and cached module metadata keep their values.
function collectionHash(config) {
  const collection = { ...config }
  for (const field of CATALOG_FIELDS) delete collection[field]
  for (const field of TRANSLATION_FIELDS) delete collection[field]
  return hashConfig(collection)
}

function canonicalRoot(root) {
  const resolved = path.resolve(root)
  try {
    return fs.realpathSync(resolved)
  } catch (error) {
    return resolved
  }
}

function applyScopeOverrides(root, config) {
  if (!scopeOverrides) return config
  const picked = {}
  for (const field of SCOPE_OVERRIDE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(scopeOverrides, field)) picked[field] = scopeOverrides[field]
  }
  if (Object.keys(picked).length === 0) return config
  return validate(root, merge(config, picked, LOADER_FIELDS))
}

function loadConfig({ root = process.cwd(), loaderOptions, pluginOptions } = {}) {
  const projectRoot = path.resolve(root)
  const file = path.join(projectRoot, CONFIG_FILE)
  let fileConfig = {}
  if (fs.existsSync(file)) {
    delete require.cache[require.resolve(file)]
    fileConfig = require(file)
  }
  let config = validate(projectRoot, fileConfig)
  const fileConfigHash = collectionHash(config)
  config = validate(projectRoot, merge(config, loaderOptions, LOADER_FIELDS))
  config = validate(projectRoot, merge(config, pluginOptions, PLUGIN_FIELDS))
  config = applyScopeOverrides(projectRoot, config)
  return {
    ...config,
    root: projectRoot,
    configHash: collectionHash(config),
    fileConfigHash
  }
}

function translationSettings(config, overrides = {}) {
  const input = {}
  for (const key of Object.keys(DEFAULTS)) input[key] = config[key]
  for (const key of Object.keys(overrides)) {
    if (!TRANSLATION_FIELDS.includes(key)) fail(`unknown translation setting "${key}"`)
    input[key] = overrides[key]
  }
  const next = validate(config.root, input)
  const picked = {}
  for (const key of TRANSLATION_FIELDS) picked[key] = next[key]
  return { ...config, ...picked }
}

module.exports = {
  CONFIG_FILE,
  DEFAULTS,
  canonicalRoot,
  catalogFiles,
  clearCollectionOverrides,
  identityFiles,
  loadConfig,
  setCollectionOverrides,
  translationSettings,
  validate
}
