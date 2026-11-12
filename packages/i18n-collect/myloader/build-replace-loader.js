const fs = require('fs')
const path = require('path')
const {
  transformBuildReplacement
} = require('../mycommon/build-replace')
const {
  occurrencesForReplacement,
  occurrencesFromModuleSource
} = require('../mycommon/build-replacement-findings')
const { getBuildReplacementContext } = require('../mycommon/build-replacement-context')
const { catalogFiles, loadConfig } = require('../mycommon/config')
const { SCRIPT_EXTENSIONS } = require('../mycommon/replace-preview')
const { SOURCE_CATALOG_FILE } = require('../mycommon/source-catalog-freshness')
const { COLLECT_METADATA } = require('../mycommon/session')
const { analyzeSnapshots } = require('../mycommon/project-analysis')

function supportedResource(projectPath, adapter) {
  const extension = path.posix.extname(projectPath).toLowerCase()
  if (SCRIPT_EXTENSIONS.has(extension)) return true
  return (adapter === 'vue2' || adapter === 'vue3') && extension === '.vue'
}

function looksLikeVueSfc(source) {
  return typeof source === 'string' && /<(?:template|script|style)\b/i.test(source)
}

function activeOccurrencesFromList(items, projectPath) {
  const open = []
  for (const item of items || []) {
    if (!item || !item.location || item.location.path !== projectPath) continue
    if (item.status === 'orphaned') continue
    open.push({ ...item, status: 'active', reportedAmbiguity: false })
  }
  return { open }
}

function occurrencesFromCollectMetadata(mod, projectPath, config) {
  const metadata = mod && mod.buildInfo && mod.buildInfo[COLLECT_METADATA]
  const snapshot = metadata && metadata.snapshot
  if (!snapshot || !Array.isArray(snapshot.entries)) return []
  const analysis = analyzeSnapshots([{
    ...snapshot,
    projectPath: snapshot.projectPath || projectPath
  }], config)
  return activeOccurrencesFromList(occurrencesForReplacement(analysis), projectPath).open
}

function loader(source, sourceMap, meta) {
  const callback = this.async()
  try {
    const options = typeof this.getOptions === 'function' ? (this.getOptions() || {}) : {}
    const root = path.resolve(options.root || this.rootContext || process.cwd())
    const resourcePath = this.resourcePath
    const projectPath = path.relative(root, resourcePath).split(path.sep).join('/')
    const config = loadConfig({ root })
    const build = config.buildReplacement
    if (!build || !build.enabled || (build.adapter !== 'js' && build.adapter !== 'vue2' && build.adapter !== 'vue3')) {
      callback(null, source, sourceMap, meta)
      return
    }
    if (!supportedResource(projectPath, build.adapter)) {
      callback(null, source, sourceMap, meta)
      return
    }
    const sourceText = Buffer.isBuffer(source) ? source.toString('utf8') : source
    if ((build.adapter === 'vue2' || build.adapter === 'vue3') && path.posix.extname(projectPath).toLowerCase() === '.vue' && !looksLikeVueSfc(sourceText)) {
      callback(null, source, sourceMap, meta)
      return
    }
    const context = getBuildReplacementContext(root)
    if (!context || (!Array.isArray(context.occurrences) && !context.sourceCatalog)) {
      const { LEGACY_IDENTITY_METADATA } = require('../mycommon/legacy-contraction')
      callback(new Error(LEGACY_IDENTITY_METADATA))
      return
    }
    // Vue SFC pre-replacement edits original template/script coordinates. Webpack
    // collection findings for templates live on render-function sources, so derive
    // SFC occurrences from the in-memory module buffer instead of those locations.
    const vueSfc = (build.adapter === 'vue2' || build.adapter === 'vue3')
      && path.posix.extname(projectPath).toLowerCase() === '.vue'
      && looksLikeVueSfc(sourceText)
    let selected = { open: [] }
    if (vueSfc) {
      selected = {
        open: occurrencesFromModuleSource({
          source: sourceText,
          projectPath,
          config
        })
      }
    } else {
      selected = activeOccurrencesFromList(context.occurrences, projectPath)
      if (selected.open.length === 0) {
        selected = {
          open: occurrencesFromCollectMetadata(this._module, projectPath, config)
        }
      }
      if (selected.open.length === 0) {
        selected = {
          open: occurrencesFromModuleSource({
            source: sourceText,
            projectPath,
            config
          })
        }
      }
    }
    if (selected.open.length === 0) {
      callback(null, source, sourceMap, meta)
      return
    }
    const result = transformBuildReplacement({
      source: sourceText,
      root,
      projectPath,
      resourcePath,
      occurrences: selected.open,
      adapter: build.adapter,
      runtimeModule: build.runtimeModule,
      runtimeExport: build.runtimeExport,
      styleExtensions: config.styleExtensions,
      inputSourceMap: sourceMap || null
    })
    if (result.error) {
      callback(result.error instanceof Error ? result.error : new Error(String(result.error)))
      return
    }
    if (typeof this.addDependency === 'function') {
      this.addDependency(path.join(root, config.catalogDir, SOURCE_CATALOG_FILE))
      this.addDependency(path.resolve(root, build.runtimeModule))
      const files = catalogFiles(config)
      const metadataPath = path.join(root, files.metadata)
      if (fs.existsSync(metadataPath)) this.addDependency(metadataPath)
    }
    callback(null, result.code, result.map || sourceMap, meta)
  } catch (error) {
    callback(error)
  }
}

module.exports = loader
