const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const CONFIG_FILE = 'i18n-collect.config.js'
const DEFAULTS = {
  htmlEntries: ['public/index.html'],
  styleExtensions: ['.css', '.scss', '.sass', '.less', '.styl'],
  include: [],
  exclude: [],
  attributeAllowlist: ['title', 'placeholder', 'alt', 'aria-label', 'value'],
  outputPath: 'lang/zh_hash.json',
  sourceMapFilename: 'lang/zh_hash.map.json'
}

const FIELDS = new Set(Object.keys(DEFAULTS))

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

function array(value, field, valid) {
  if (!Array.isArray(value) || value.some(item => !valid(item))) {
    fail(`${field} must be an array of valid values`)
  }
  if (new Set(value).size !== value.length) fail(`${field} must not contain duplicates`)
}

function validate(root, input) {
  if (!isObject(input)) fail('must export an object')
  Object.keys(input).forEach(key => {
    if (!FIELDS.has(key)) fail(`unknown field "${key}"`)
  })
  const config = { ...DEFAULTS, ...input }
  array(config.htmlEntries, 'htmlEntries', value => typeof value === 'string' && value.length > 0)
  config.htmlEntries = config.htmlEntries.map(value => projectPath(root, value, 'htmlEntries'))
  if (new Set(config.htmlEntries).size !== config.htmlEntries.length) {
    fail('htmlEntries must not contain duplicate paths')
  }
  array(config.styleExtensions, 'styleExtensions', value => /^(\.[a-z0-9]+)+$/i.test(value))
  for (const field of ['include', 'exclude', 'attributeAllowlist']) {
    array(config[field], field, value => typeof value === 'string' && value.length > 0)
  }
  config.outputPath = projectPath(root, config.outputPath, 'outputPath')
  config.sourceMapFilename = projectPath(root, config.sourceMapFilename, 'sourceMapFilename')
  if (config.outputPath === config.sourceMapFilename) fail('outputPath and sourceMapFilename must differ')
  const outputs = [config.outputPath, config.sourceMapFilename].map(value => path.resolve(root, value))
  for (const entry of config.htmlEntries) {
    if (outputs.includes(path.resolve(root, entry))) {
      fail('output files must not also be HTML inputs')
    }
  }
  return config
}

function merge(base, options, allowed) {
  if (options === undefined) return base
  if (!isObject(options)) fail('explicit options must be an object')
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail(`unknown explicit option "${key}"`)
  }
  return { ...base, ...options }
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
  config = validate(projectRoot, merge(config, loaderOptions, new Set(['include', 'exclude', 'attributeAllowlist', 'styleExtensions'])))
  config = validate(projectRoot, merge(config, pluginOptions, new Set(['htmlEntries', 'outputPath', 'sourceMapFilename'])))
  return {
    ...config,
    root: projectRoot,
    configHash: crypto.createHash('md5').update(JSON.stringify(config)).digest('hex')
  }
}

module.exports = { CONFIG_FILE, DEFAULTS, loadConfig, validate }
