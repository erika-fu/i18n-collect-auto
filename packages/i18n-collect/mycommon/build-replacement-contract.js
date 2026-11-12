const fs = require('fs')
const path = require('path')
const { upgradeCatalogMetadata } = require('./catalog')
const { catalogFiles } = require('./config')
const {
  buildReplacementError,
  sortOccurrences
} = require('./build-replace')
const { ReplacementPlanner } = require('./replacement-planner')
const { parseTemplate } = require('../myloader/template-parser')

function contractError(kind, stage, message) {
  const error = new Error(message)
  error.kind = kind
  error.stage = stage
  return error
}

function insideRoot(root, projectPath) {
  if (!projectPath || path.posix.isAbsolute(projectPath)) return null
  const full = path.resolve(root, projectPath)
  const relative = path.relative(root, full)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return full
}

function readSources(root, items) {
  const sources = new Map()
  for (const item of items) {
    const projectPath = item.location.path
    if (sources.has(projectPath)) continue
    const full = insideRoot(root, projectPath)
    if (!full || !fs.existsSync(full)) {
      sources.set(projectPath, null)
      continue
    }
    const stat = fs.statSync(full)
    sources.set(projectPath, stat.isFile() ? fs.readFileSync(full, 'utf8') : null)
  }
  return sources
}

function plannerResources(root, config, adapter, items, sources) {
  const templatePaths = new Set(items
    .filter(item => (
      item.location.kind === 'html-text'
      || item.location.kind === 'html-attribute'
      || item.location.kind === 'template-expression'
    ))
    .map(item => item.location.path))
  return new Map([...sources].map(([projectPath, source]) => {
    if (
      adapter === 'js'
      || source == null
      || !templatePaths.has(projectPath)
      || path.posix.extname(projectPath).toLowerCase() !== '.vue'
    ) {
      return [projectPath, source]
    }
    return [projectPath, {
      source,
      template: parseTemplate({
        source,
        resource: {
          absolutePath: path.resolve(root, projectPath),
          projectPath
        },
        standalone: false,
        config: { vueVersion: adapter === 'vue2' ? 2 : 3 }
      })
    }]
  }))
}

function humanFailureLines(occurrences) {
  return occurrences.map(item => (
    `  ${item.path}:${item.start.line}:${item.start.column} ${item.reason} (${item.key})`
  ))
}

function formatHumanFailure(occurrences) {
  const header = occurrences.length === 1
    ? 'build: replacement failed with 1 unsafe occurrence'
    : `build: replacement failed with ${occurrences.length} unsafe occurrences`
  return `${[header, ...humanFailureLines(occurrences)].join('\n')}\n`
}

function formatJsonFailure(occurrences, message) {
  return {
    command: 'build',
    failure: 'build',
    stage: 'replacement',
    message: message || (
      occurrences.length === 1
        ? occurrences[0].reason
        : `replacement failed with ${occurrences.length} unsafe occurrences`
    ),
    ok: false,
    occurrences
  }
}

function extractBuildReplacementOccurrences(error, stats) {
  const occurrences = []
  const seen = new Set()
  const push = list => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (!item || typeof item.path !== 'string' || typeof item.reason !== 'string') continue
      const id = [
        item.path,
        item.key,
        item.kind,
        item.start && item.start.line,
        item.start && item.start.column,
        item.reason
      ].join('\0')
      if (seen.has(id)) continue
      seen.add(id)
      occurrences.push(item)
    }
  }
  if (error && Array.isArray(error.occurrences)) push(error.occurrences)
  if (stats && stats.compilation && Array.isArray(stats.compilation.errors)) {
    for (const item of stats.compilation.errors) {
      const nested = item && item.error
      if (nested && Array.isArray(nested.occurrences)) push(nested.occurrences)
      if (item && Array.isArray(item.occurrences)) push(item.occurrences)
    }
  }
  return sortOccurrences(occurrences)
}

function loadPublishedCatalog(root, config) {
  const metadataPath = path.join(root, catalogFiles(config).metadata)
  if (!fs.existsSync(metadataPath)) {
    throw contractError('collection', 'collection', 'collection finished without a catalog')
  }
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  } catch (error) {
    throw contractError(
      'configuration',
      'configuration',
      'catalog metadata could not be read; restore a valid version 1, 2, or 3 catalog.meta.json'
    )
  }
  try {
    const metadata = upgradeCatalogMetadata(parsed)
    if (!metadata || !metadata.entries || typeof metadata.entries !== 'object' || Array.isArray(metadata.entries)) {
      throw contractError(
        'configuration',
        'configuration',
        'catalog metadata is not a supported catalog schema'
      )
    }
    return metadata
  } catch (error) {
    if (error && error.kind === 'configuration') throw error
    throw contractError(
      'configuration',
      'configuration',
      error && error.message ? error.message : 'catalog metadata is not a supported catalog schema'
    )
  }
}

function normalizeLoaderPath(loader) {
  if (!loader) return ''
  if (typeof loader === 'object' && loader.loader) return normalizeLoaderPath(loader.loader)
  return String(loader).replace(/\\/g, '/')
}

function isCollectLoaderEntry(loader) {
  const value = normalizeLoaderPath(loader)
  return value.includes('/myloader/index.js')
    || value.endsWith('/myloader')
    || value.includes('/i18n-collect/myloader')
}

function stripCollectUse(use) {
  const list = [].concat(use).filter(entry => entry && !isCollectLoaderEntry(entry))
  if (list.length === 0) return null
  return list.length === 1 ? list[0] : list
}

function stripCollectionRule(rule) {
  if (!rule || typeof rule !== 'object') return rule
  if (rule.oneOf) {
    const oneOf = rule.oneOf.map(stripCollectionRule).filter(Boolean)
    return oneOf.length ? { ...rule, oneOf } : null
  }
  if (rule.rules) {
    const rules = rule.rules.map(stripCollectionRule).filter(Boolean)
    return rules.length ? { ...rule, rules } : null
  }
  const next = { ...rule }
  if (next.loader && isCollectLoaderEntry(next.loader)) {
    delete next.loader
    delete next.options
  }
  if (next.use) {
    const use = stripCollectUse(next.use)
    if (!use) delete next.use
    else next.use = use
  }
  if (!next.loader && !next.use && !next.oneOf && !next.rules) return null
  return next
}

function stripCollectionIntegration(webpackConfig) {
  if (!webpackConfig || typeof webpackConfig !== 'object') return webpackConfig
  webpackConfig.plugins = (webpackConfig.plugins || []).filter(plugin => {
    if (!plugin) return false
    return !(plugin.constructor && plugin.constructor.name === 'MyI18nPlugin')
  })
  if (webpackConfig.module && Array.isArray(webpackConfig.module.rules)) {
    webpackConfig.module = {
      ...webpackConfig.module,
      rules: webpackConfig.module.rules.map(stripCollectionRule).filter(Boolean)
    }
  }
  return webpackConfig
}

function preflightBuildReplacement(root, config, options = {}) {
  const adapter = config.buildReplacement && config.buildReplacement.adapter
  if (!Array.isArray(options.occurrences)) {
    const { LEGACY_IDENTITY_METADATA } = require('./legacy-contraction')
    throw contractError('configuration', 'configuration', LEGACY_IDENTITY_METADATA)
  }
  const open = options.occurrences.map(item => ({
    ...item,
    reportedAmbiguity: false,
    status: 'active'
  }))
  const sources = readSources(root, open)
  const planner = new ReplacementPlanner({
    adapter,
    styleExtensions: config.styleExtensions,
    runtime: {
      localizationFunction: true,
      helperName: (config.buildReplacement && config.buildReplacement.runtimeExport) || 't',
      helperAvailable: adapter === 'js' || adapter === 'vue3'
    }
  })
  const planned = planner.plan({
    occurrences: open,
    resources: plannerResources(root, config, adapter, open, sources)
  })
  const occurrences = sortOccurrences(planned.skipped)
  if (occurrences.length === 0) return { metadata: null, occurrences: [] }
  throw buildReplacementError(occurrences)
}

function formalOutputPath(webpackConfig, root) {
  if (webpackConfig.output && webpackConfig.output.path) return webpackConfig.output.path
  return path.join(root, 'dist')
}

function stageFormalBundle(webpackConfig, root) {
  const formalPath = formalOutputPath(webpackConfig, root)
  const stagingPath = fs.mkdtempSync(path.join(path.dirname(formalPath), '.i18n-build-staging-'))
  webpackConfig.output = {
    ...(webpackConfig.output || {}),
    path: stagingPath,
    clean: true
  }
  return { formalPath, stagingPath }
}

function removeTree(target) {
  if (target && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
}

function moveTree(from, to) {
  try {
    fs.renameSync(from, to)
  } catch (error) {
    const code = error && error.code
    // Windows can refuse renameSync on a non-empty directory tree that still has
    // open handles; copy then delete preserves the same publish semantics.
    if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EXDEV' && code !== 'EBUSY') {
      throw error
    }
    fs.cpSync(from, to, { recursive: true })
    removeTree(from)
  }
}

function publishFormalBundle({ formalPath, stagingPath }) {
  const backupPath = `${formalPath}.i18n-build-bak-${process.pid}-${Date.now()}`
  let backedUp = false
  try {
    if (fs.existsSync(formalPath)) {
      moveTree(formalPath, backupPath)
      backedUp = true
    }
    moveTree(stagingPath, formalPath)
    if (backedUp) removeTree(backupPath)
  } catch (error) {
    let restored = !backedUp
    if (backedUp && fs.existsSync(backupPath)) {
      removeTree(formalPath)
      try {
        moveTree(backupPath, formalPath)
        restored = true
      } catch (restoreError) {
        restored = false
      }
    }
    removeTree(stagingPath)
    if (restored) removeTree(backupPath)
    const failure = new Error(error && error.message ? error.message : 'formal bundle could not be published')
    failure.kind = 'build'
    failure.stage = 'replacement'
    throw failure
  }
}

function scrubOrphanedStagingDirs(root) {
  if (!root || !fs.existsSync(root)) return
  let names
  try {
    names = fs.readdirSync(root)
  } catch (error) {
    return
  }
  for (const name of names) {
    if (!name.startsWith('.i18n-build-staging-')) continue
    removeTree(path.join(root, name))
  }
}

function cleanupBundleArtifacts(root, stagingPath) {
  removeTree(stagingPath)
  scrubOrphanedStagingDirs(root)
}

module.exports = {
  cleanupBundleArtifacts,
  extractBuildReplacementOccurrences,
  formatHumanFailure,
  formatJsonFailure,
  loadPublishedCatalog,
  preflightBuildReplacement,
  publishFormalBundle,
  sortOccurrences,
  scrubOrphanedStagingDirs,
  stageFormalBundle,
  stripCollectionIntegration
}
