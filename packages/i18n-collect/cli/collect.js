// Orchestrates the project's webpack integration. Semantic extraction stays in myloader.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { diffCatalog, entryStatus, readCatalogMetadataFile } = require('../mycommon/catalog')
const { catalogFiles, clearCollectionOverrides, loadConfig, setCollectionOverrides } = require('../mycommon/config')

const EXIT = {
  ok: 0,
  configuration: 1,
  collection: 2,
  build: 3
}

function commandError(kind, message) {
  const error = new Error(message)
  error.kind = kind
  return error
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function outcome(code, stdout, stderr) {
  return { code, stdout, stderr }
}

function failure(error, json) {
  const kind = error && EXIT[error.kind] ? error.kind : 'build'
  const message = error && error.message ? error.message : String(error)
  const stdout = json
    ? jsonText({ command: 'collect', failure: kind, message, ok: false })
    : ''
  return outcome(EXIT[kind], stdout, `${kind}: ${message}\n`)
}

function take(args, index, flag) {
  const next = args[index + 1]
  if (next === undefined || next.startsWith('-')) throw commandError('configuration', `${flag} requires a value`)
  return next
}

function parseCollectArgs(args) {
  const parsed = {
    contextFilters: undefined,
    cwd: null,
    exclude: undefined,
    include: undefined,
    json: false,
    webpackConfig: null
  }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    const eq = arg.indexOf('=')
    const flag = eq === -1 ? arg : arg.slice(0, eq)
    const inline = eq === -1 ? null : arg.slice(eq + 1)
    const value = name => {
      if (inline !== null) {
        if (!inline) throw commandError('configuration', `${name} requires a value`)
        return inline
      }
      const next = take(args, index, name)
      index += 1
      return next
    }
    if (flag === '--json') {
      if (inline !== null) throw commandError('configuration', 'unknown option "--json"')
      parsed.json = true
    } else if (flag === '--cwd') parsed.cwd = value('--cwd')
    else if (flag === '--webpack-config') parsed.webpackConfig = value('--webpack-config')
    else if (flag === '--include') {
      if (!parsed.include) parsed.include = []
      parsed.include.push(value('--include'))
    } else if (flag === '--exclude') {
      if (!parsed.exclude) parsed.exclude = []
      parsed.exclude.push(value('--exclude'))
    } else if (flag === '--context-filter') {
      if (!parsed.contextFilters) parsed.contextFilters = []
      parsed.contextFilters.push(value('--context-filter'))
    } else if (flag.startsWith('-')) throw commandError('configuration', `unknown option "${flag}"`)
    else throw commandError('configuration', `unexpected argument "${arg}"`)
  }
  return parsed
}

function overridesFrom(parsed) {
  const overrides = {}
  if (parsed.include) overrides.include = parsed.include
  if (parsed.exclude) overrides.exclude = parsed.exclude
  if (parsed.contextFilters) overrides.contextFilters = parsed.contextFilters
  return overrides
}

function forbidNetwork() {
  const http = require('http')
  const https = require('https')
  const net = require('net')
  const originals = {
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
    netConnect: net.connect,
    netCreateConnection: net.createConnection,
    socketConnect: net.Socket.prototype.connect,
    fetch: global.fetch
  }
  const block = name => () => {
    throw commandError('build', `i18n-collect collect does not make network requests (${name})`)
  }
  http.request = block('http.request')
  http.get = block('http.get')
  https.request = block('https.request')
  https.get = block('https.get')
  net.connect = block('net.connect')
  net.createConnection = block('net.createConnection')
  net.Socket.prototype.connect = block('net.Socket.connect')
  if (typeof global.fetch === 'function') global.fetch = block('fetch')
  return function restoreNetwork() {
    http.request = originals.httpRequest
    http.get = originals.httpGet
    https.request = originals.httpsRequest
    https.get = originals.httpsGet
    net.connect = originals.netConnect
    net.createConnection = originals.netCreateConnection
    net.Socket.prototype.connect = originals.socketConnect
    if (typeof originals.fetch === 'function') global.fetch = originals.fetch
  }
}

function projectRelative(root, file) {
  const relative = path.relative(root, file)
  return (relative || path.basename(file)).split(path.sep).join('/')
}

function resolveConfig(root) {
  try {
    return loadConfig({ root })
  } catch (error) {
    throw commandError('configuration', error.message)
  }
}

async function readWebpackConfig(file) {
  let loaded
  try {
    loaded = require(file)
    if (typeof loaded === 'function') loaded = await loaded()
  } catch (error) {
    if (error && error.kind) throw error
    throw commandError('build', error && error.message ? error.message : String(error))
  }
  return loaded
}

function redirectEmit(config) {
  const emitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-emit-'))
  config.output = { ...(config.output || {}), path: emitDir, clean: false }
  config.watch = false
  config.cache = false
  config.infrastructureLogging = { level: 'error' }
  return emitDir
}

function runCompiler(config) {
  const webpack = require('webpack')
  let compiler
  try {
    compiler = webpack(config)
  } catch (error) {
    throw commandError('build', error && error.message ? error.message : String(error))
  }
  return new Promise(resolve => {
    compiler.run((error, stats) => {
      compiler.close(() => resolve({ error, stats }))
    })
  })
}

function errorMessages(error, stats) {
  const messages = []
  if (error && error.message) messages.push(error.message)
  if (stats && typeof stats.toJson === 'function') {
    const json = stats.toJson({ errors: true })
    for (const item of json.errors || []) {
      if (item && item.message) messages.push(item.message)
    }
  }
  return messages
}

function isCollectionMessage(message) {
  return message.includes('i18n-collect failed') ||
    message.includes('i18n-collect loader is not integrated') ||
    message.includes('i18n-collect loader must run in the main webpack process')
}

function classifyBuild(error, stats) {
  if (error && error.kind && EXIT[error.kind]) return error
  const messages = errorMessages(error, stats)
  const text = messages.join('\n')
  if (!text.trim()) return null
  if (text.includes('Invalid i18n-collect.config.js') || text.includes('Invalid collect options')) {
    return commandError('configuration', text)
  }
  const collectionMessages = messages.filter(isCollectionMessage)
  const otherMessages = messages.filter(message => !isCollectionMessage(message))
  if (otherMessages.length > 0) return commandError('build', otherMessages.join('\n'))
  if (collectionMessages.length > 0) return commandError('collection', collectionMessages.join('\n'))
  return commandError('build', text)
}

function pluginOptionsFrom(webpackConfig) {
  for (const plugin of webpackConfig.plugins || []) {
    if (plugin && plugin.constructor && plugin.constructor.name === 'MyI18nPlugin') return plugin.options || {}
  }
  return undefined
}

function humanReport(report) {
  const noun = report.entries === 1 ? 'entry' : 'entries'
  const include = report.include.length ? report.include.join(', ') : '(all resources that enter the loader)'
  const exclude = report.exclude.length ? report.exclude.join(', ') : '(none)'
  const filters = report.contextFilters.length ? report.contextFilters.join(', ') : '(none)'
  const catalog = report.catalog
  const keyNoun = catalog.keys === 1 ? 'key' : 'keys'
  return [
    `Collected ${report.entries} ${noun}.`,
    `Dictionary: ${report.dictionary}`,
    `Source map: ${report.sourceMap}`,
    `Catalog: ${catalog.messages} (${catalog.keys} ${keyNoun}: ${catalog.added.length} added, ${catalog.removed.length} removed, ${catalog.changed.length} changed, ${catalog.unchanged.length} unchanged, ${(catalog.orphaned || []).length} orphaned, ${(catalog.recovered || []).length} recovered)`,
    `Catalog metadata: ${catalog.metadata}`,
    `Scope include: ${include}`,
    `Scope exclude: ${exclude}`,
    `Context filters: ${filters}`,
    ''
  ].join('\n')
}

function readCatalogMetadata(root, config) {
  try {
    return readCatalogMetadataFile(path.join(root, catalogFiles(config).metadata))
  } catch (error) {
    throw commandError('collection', error.message)
  }
}

function reportFrom(config, dictionaryFile, previousCatalog) {
  const dictionary = JSON.parse(fs.readFileSync(dictionaryFile, 'utf8'))
  const files = catalogFiles(config)
  const nextCatalog = readCatalogMetadata(config.root, config)
  if (!nextCatalog) throw commandError('collection', 'collection finished without a catalog')
  const entries = nextCatalog.entries || {}
  const activeKeys = Object.keys(entries).filter(key => entryStatus(entries[key]) === 'active').length
  return {
    catalog: {
      format: config.catalogFormat,
      keys: activeKeys,
      messages: files.messages,
      metadata: files.metadata,
      sourceLocale: config.sourceLocale,
      ...diffCatalog(previousCatalog, nextCatalog)
    },
    command: 'collect',
    contextFilters: config.contextFilters,
    dictionary: config.outputPath,
    entries: Object.keys(dictionary).length,
    exclude: config.exclude,
    include: config.include,
    ok: true,
    sourceMap: config.sourceMapFilename
  }
}

async function execute(parsed) {
  const root = path.resolve(parsed.cwd || process.cwd())
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw commandError('configuration', `project root is not a directory: ${root}`)
  }
  const previous = process.cwd()
  let emitDir = null
  let restoreNetwork = null
  process.chdir(root)
  clearCollectionOverrides()
  try {
    restoreNetwork = forbidNetwork()
    resolveConfig(root)
    const overrides = overridesFrom(parsed)
    if (Object.keys(overrides).length > 0) {
      setCollectionOverrides(overrides)
      try {
        loadConfig({ root })
      } catch (error) {
        throw commandError('configuration', error.message.replace(/^Invalid i18n-collect\.config\.js:/, 'Invalid collect options:'))
      }
    }
    const configFile = path.resolve(root, parsed.webpackConfig || 'webpack.config.js')
    if (!fs.existsSync(configFile)) {
      throw commandError('configuration', `missing webpack configuration: ${projectRelative(root, configFile)}`)
    }
    const webpackConfig = await readWebpackConfig(configFile)
    if (!webpackConfig || typeof webpackConfig !== 'object' || Array.isArray(webpackConfig)) {
      throw commandError('configuration', 'collect accepts one webpack configuration object')
    }
    const pluginOptions = pluginOptionsFrom(webpackConfig)
    const previousCatalog = readCatalogMetadata(root, loadConfig({ root, pluginOptions }))
    emitDir = redirectEmit(webpackConfig)
    const { error, stats } = await runCompiler(webpackConfig)
    const failed = classifyBuild(error, stats)
    if (failed) throw failed
    if (stats && stats.hasErrors()) throw commandError('build', 'webpack reported a build failure')
    const config = loadConfig({ root, pluginOptions })
    const dictionaryFile = path.join(root, config.outputPath)
    if (!fs.existsSync(dictionaryFile)) throw commandError('collection', 'collection finished without a dictionary')
    return reportFrom(config, dictionaryFile, previousCatalog)
  } finally {
    if (restoreNetwork) restoreNetwork()
    clearCollectionOverrides()
    process.chdir(previous)
    if (emitDir) fs.rmSync(emitDir, { recursive: true, force: true })
  }
}

async function collect(args) {
  const json = args.includes('--json')
  let parsed
  try {
    parsed = parseCollectArgs(args)
  } catch (error) {
    return failure(error, json)
  }
  try {
    const report = await execute(parsed)
    const stdout = parsed.json ? jsonText(report) : humanReport(report)
    return outcome(EXIT.ok, stdout, '')
  } catch (error) {
    return failure(error, parsed.json)
  }
}

module.exports = { EXIT, collect }
