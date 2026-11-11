const fs = require('fs')
const path = require('path')
const {
  cleanupBundleArtifacts,
  extractBuildReplacementOccurrences,
  formatHumanFailure,
  formatJsonFailure,
  preflightBuildReplacement,
  publishFormalBundle,
  stageFormalBundle,
  stripCollectionIntegration
} = require('../mycommon/build-replacement-contract')
const {
  clearBuildReplacementContext,
  setBuildReplacementContext
} = require('../mycommon/build-replacement-context')
const { clearCollectionOverrides, loadConfig, setCollectionOverrides } = require('../mycommon/config')
const { assertReplacementRuntime } = require('../mycommon/replacement-runtime')
const { assertSourceCatalogFresh } = require('../mycommon/source-catalog-freshness')
const I18nBuildReplacementPlugin = require('../myplugin/build-replacement')
const {
  EXIT,
  classifyBuild,
  forbidNetwork,
  parseCollectArgs,
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
  const occurrences = Array.isArray(error && error.occurrences) ? error.occurrences : null
  if (occurrences && occurrences.length > 0) {
    const body = formatJsonFailure(occurrences, error.message)
    return outcome(
      EXIT.build,
      json ? jsonText(body) : '',
      formatHumanFailure(occurrences)
    )
  }
  const kind = error && EXIT[error.kind] ? error.kind : 'build'
  const message = error && error.message ? error.message : String(error)
  const stage = error && error.stage
    ? error.stage
    : kind === 'collection'
      ? 'analysis'
      : kind === 'configuration'
        ? 'configuration'
        : 'replacement'
  const stdout = json
    ? jsonText({ command: 'build', failure: kind, stage, message, ok: false })
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
  const noun = report.collection.keys === 1 ? 'key' : 'keys'
  return [
    `Build replacement finished.`,
    `Source catalog: ${report.collection.sourceCatalog} (${report.collection.keys} ${noun})`,
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

function classifyReplacementBuild(error, stats) {
  const occurrences = extractBuildReplacementOccurrences(error, stats)
  if (occurrences.length > 0) {
    const failureError = new Error(
      occurrences.length === 1
        ? occurrences[0].reason
        : `replacement failed with ${occurrences.length} unsafe occurrences`
    )
    failureError.kind = 'build'
    failureError.stage = 'replacement'
    failureError.occurrences = occurrences
    return failureError
  }
  const failed = classifyBuild(error, stats)
  if (failed) {
    failed.stage = failed.stage || 'replacement'
    return failed
  }
  if (stats && stats.hasErrors()) {
    return commandError('build', 'webpack reported a build failure')
  }
  return null
}

function prepareReadOnlyBuild(root, config) {
  return assertSourceCatalogFresh(root, config)
}

async function runReplacementCompilation(root, parsed, config, hooks = {}) {
  const previous = process.cwd()
  let restoreNetwork = null
  let staging = null
  let compiler = null
  let contextSet = false
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
    const prepared = hooks.prepared || prepareReadOnlyBuild(root, config)
    preflightBuildReplacement(root, config, { occurrences: prepared.occurrences })
    setBuildReplacementContext(root, {
      occurrences: prepared.occurrences,
      sourceCatalog: prepared.sourceCatalog
    })
    contextSet = true
    const webpackConfig = stripCollectionIntegration(cloneWebpackConfig(loaded))
    webpackConfig.watch = false
    webpackConfig.cache = false
    webpackConfig.infrastructureLogging = { level: 'error' }
    webpackConfig.plugins.push(new I18nBuildReplacementPlugin({
      root,
      adapter: config.buildReplacement && config.buildReplacement.adapter
    }))
    staging = stageFormalBundle(webpackConfig, root)
    const resolved = loadConfig({ root })
    const { error, stats } = await runCompiler(webpackConfig, {
      onCompiler(next) {
        compiler = next
        if (typeof hooks.onCompiler === 'function') hooks.onCompiler(next)
      },
      onCompilerClosed(next) {
        if (compiler === next) compiler = null
        if (typeof hooks.onCompilerClosed === 'function') hooks.onCompilerClosed(next)
      }
    })
    const failed = classifyReplacementBuild(error, stats)
    if (failed) throw failed
    const published = staging
    publishFormalBundle(published)
    // rename/move may leave the staging path on some Windows hosts; always scrub it.
    cleanupBundleArtifacts(root, published.stagingPath)
    staging = null
    const outputPath = published.formalPath
    const filename = (webpackConfig.output && webpackConfig.output.filename) || 'bundle.js'
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
      outputPath,
      prepared,
      runtimeExport: resolved.buildReplacement.runtimeExport,
      runtimeModule: resolved.buildReplacement.runtimeModule
    }
  } finally {
    if (contextSet) clearBuildReplacementContext(root)
    if (restoreNetwork) restoreNetwork()
    clearCollectionOverrides()
    process.chdir(previous)
    cleanupBundleArtifacts(root, staging && staging.stagingPath)
  }
}

function parseBuildArgs(args) {
  const watch = args.includes('--watch')
  const rest = []
  for (const arg of args) {
    if (arg === '--watch') continue
    rest.push(arg)
  }
  const parsed = parseCollectArgs(rest)
  parsed.watch = watch
  return parsed
}

function collectionSummary(prepared) {
  const keys = Object.keys(prepared.sourceCatalog || {})
  return {
    sourceCatalog: prepared.sourceCatalogPath,
    keys: keys.length,
    catalog: {
      sourceCatalog: prepared.sourceCatalogPath,
      keys: keys.length
    }
  }
}

async function build(args) {
  const json = args.includes('--json')
  let parsed
  try {
    parsed = parseBuildArgs(args)
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

  if (parsed.watch) {
    const { createWatchBuildSession } = require('./build-watch')
    const session = createWatchBuildSession({
      root,
      parsed,
      runReplacementCompilation,
      requireBuildReplacement,
      prepareReadOnlyBuild,
      failure,
      jsonText,
      humanReport,
      collectionSummary
    })
    return session.start()
  }

  try {
    const config = loadConfig({ root })
    const prepared = prepareReadOnlyBuild(root, config)
    const replacement = await runReplacementCompilation(root, parsed, config, { prepared })
    const collection = collectionSummary(prepared)
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

module.exports = {
  EXIT,
  build,
  parseBuildArgs,
  prepareReadOnlyBuild,
  runReplacementCompilation
}
