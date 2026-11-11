const fs = require('fs')
const path = require('path')
const { catalogFiles, clearCollectionOverrides, loadConfig, setCollectionOverrides } = require('../mycommon/config')
const { assertReplacementRuntime } = require('../mycommon/replacement-runtime')
const I18nBuildReplacementPlugin = require('../myplugin/build-replacement')
const {
  EXIT,
  classifyBuild,
  collect,
  forbidNetwork,
  parseCollectArgs,
  pluginOptionsFrom,
  projectRelative,
  readWebpackConfig,
  runCompiler
} = require('./collect')

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
    ? jsonText({ command: 'build', failure: kind, message, ok: false })
    : ''
  return outcome(EXIT[kind], stdout, `${kind}: ${message}\n`)
}

function requireBuildReplacement(root) {
  let config
  try {
    config = loadConfig({ root })
  } catch (error) {
    throw commandError('configuration', error.message)
  }
  const build = config.buildReplacement
  if (!build || !build.enabled) {
    throw commandError(
      'configuration',
      'buildReplacement.enabled must be true to run i18n-collect build'
    )
  }
  if (build.adapter !== 'js' && build.adapter !== 'vue2' && build.adapter !== 'vue3') {
    throw commandError('configuration', 'buildReplacement.adapter must be "js", "vue2", or "vue3"')
  }
  try {
    assertReplacementRuntime(root, build.adapter)
  } catch (error) {
    throw commandError('configuration', error.message)
  }
  return config
}

function overridesFrom(parsed) {
  const overrides = {}
  if (parsed.include) overrides.include = parsed.include
  if (parsed.exclude) overrides.exclude = parsed.exclude
  if (parsed.contextFilters) overrides.contextFilters = parsed.contextFilters
  return overrides
}

function humanReport(report) {
  const noun = report.collection.entries === 1 ? 'entry' : 'entries'
  return [
    `Build replacement finished.`,
    `Collection: ${report.collection.entries} ${noun}; catalog ${report.collection.catalog.messages}`,
    `Bundle: ${report.bundle}`,
    `Adapter: ${report.adapter}`,
    `Runtime: ${report.runtimeModule}#${report.runtimeExport}`,
    ''
  ].join('\n')
}

function cloneWebpackConfig(config) {
  return {
    ...config,
    output: { ...(config.output || {}) },
    plugins: [...(config.plugins || [])],
    module: config.module
      ? { ...config.module, rules: [...(config.module.rules || [])] }
      : config.module
  }
}

async function runReplacementCompilation(root, parsed, config) {
  const previous = process.cwd()
  let restoreNetwork = null
  process.chdir(root)
  clearCollectionOverrides()
  try {
    restoreNetwork = forbidNetwork()
    const overrides = overridesFrom(parsed)
    if (Object.keys(overrides).length > 0) {
      setCollectionOverrides(overrides)
      try {
        loadConfig({ root })
      } catch (error) {
        throw commandError(
          'configuration',
          error.message.replace(/^Invalid i18n-collect\.config\.js:/, 'Invalid build options:')
        )
      }
    }
    const configFile = path.resolve(root, parsed.webpackConfig || 'webpack.config.js')
    if (!fs.existsSync(configFile)) {
      throw commandError('configuration', `missing webpack configuration: ${projectRelative(root, configFile)}`)
    }
    const loaded = await readWebpackConfig(configFile)
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
      throw commandError('configuration', 'build accepts one webpack configuration object')
    }
    const webpackConfig = cloneWebpackConfig(loaded)
    webpackConfig.watch = false
    webpackConfig.cache = false
    webpackConfig.infrastructureLogging = { level: 'error' }
    webpackConfig.plugins.push(new I18nBuildReplacementPlugin({
      root,
      adapter: config.buildReplacement && config.buildReplacement.adapter
    }))
    const pluginOptions = pluginOptionsFrom(webpackConfig)
    const resolved = loadConfig({ root, pluginOptions })
    const { error, stats } = await runCompiler(webpackConfig)
    const failed = classifyBuild(error, stats)
    if (failed) throw failed
    if (stats && stats.hasErrors()) throw commandError('build', 'webpack reported a build failure')
    const outputPath = webpackConfig.output && webpackConfig.output.path
      ? webpackConfig.output.path
      : path.join(root, 'dist')
    const filename = (webpackConfig.output && webpackConfig.output.filename) || 'bundle.js'
    const bundleFile = path.isAbsolute(filename)
      ? filename
      : path.join(outputPath, Array.isArray(filename) ? filename[0] : String(filename).replace(/\[.+?\]/g, '*'))
    let bundle = projectRelative(root, path.join(outputPath, String(filename)))
    if (String(filename).includes('[')) {
      bundle = projectRelative(root, outputPath)
    }
    if (!fs.existsSync(outputPath)) {
      throw commandError('build', 'replacement compilation finished without an output directory')
    }
    return {
      adapter: resolved.buildReplacement.adapter,
      bundle,
      bundleFile,
      outputPath,
      runtimeExport: resolved.buildReplacement.runtimeExport,
      runtimeModule: resolved.buildReplacement.runtimeModule
    }
  } finally {
    if (restoreNetwork) restoreNetwork()
    clearCollectionOverrides()
    process.chdir(previous)
  }
}

function collectionReportFrom(stdout, json) {
  if (json) return JSON.parse(stdout)
  return null
}

async function build(args) {
  const json = args.includes('--json')
  let parsed
  try {
    parsed = parseCollectArgs(args)
  } catch (error) {
    return failure(error, json)
  }

  const root = path.resolve(parsed.cwd || process.cwd())
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return failure(commandError('configuration', `project root is not a directory: ${root}`), json)
  }

  try {
    requireBuildReplacement(root)
  } catch (error) {
    return failure(error, json)
  }

  const phase1 = await collect(args)
  if (phase1.code !== EXIT.ok) {
    if (json && phase1.stdout) {
      try {
        const body = JSON.parse(phase1.stdout)
        body.command = 'build'
        body.phase = 'collection'
        return outcome(phase1.code, jsonText(body), phase1.stderr)
      } catch (error) {
        return phase1
      }
    }
    return phase1
  }

  try {
    const config = loadConfig({ root })
    const metadataPath = path.join(root, catalogFiles(config).metadata)
    if (!fs.existsSync(metadataPath)) {
      throw commandError('collection', 'collection finished without a catalog')
    }
    const replacement = await runReplacementCompilation(root, parsed, config)
    const collection = json
      ? collectionReportFrom(phase1.stdout, true)
      : {
          catalog: { messages: catalogFiles(config).messages },
          entries: null
        }
    if (!json) {
      try {
        const dictionary = JSON.parse(fs.readFileSync(path.join(root, config.outputPath), 'utf8'))
        collection.entries = Object.keys(dictionary).length
        collection.catalog = {
          messages: catalogFiles(config).messages,
          metadata: catalogFiles(config).metadata
        }
      } catch (error) {
        collection.entries = 0
      }
    }
    const report = {
      adapter: replacement.adapter,
      bundle: replacement.bundle,
      collection,
      command: 'build',
      ok: true,
      runtimeExport: replacement.runtimeExport,
      runtimeModule: replacement.runtimeModule
    }
    if (json) {
      return outcome(EXIT.ok, jsonText(report), '')
    }
    return outcome(EXIT.ok, humanReport(report), '')
  } catch (error) {
    return failure(error, json)
  }
}

module.exports = { EXIT, build }
