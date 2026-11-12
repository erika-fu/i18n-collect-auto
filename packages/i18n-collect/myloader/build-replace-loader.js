const fs = require('fs')
const path = require('path')
const {
  transformBuildReplacement
} = require('../mycommon/build-replace')
const { getBuildReplacementContext } = require('../mycommon/build-replacement-context')
const { catalogFiles, loadConfig } = require('../mycommon/config')
const { SCRIPT_EXTENSIONS } = require('../mycommon/replace-preview')
const { SOURCE_CATALOG_FILE } = require('../mycommon/source-catalog-freshness')

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
    if ((build.adapter === 'vue2' || build.adapter === 'vue3') && path.posix.extname(projectPath).toLowerCase() === '.vue' && !looksLikeVueSfc(source)) {
      callback(null, source, sourceMap, meta)
      return
    }
    const context = getBuildReplacementContext(root)
    if (!context || !Array.isArray(context.occurrences)) {
      const { LEGACY_IDENTITY_METADATA } = require('../mycommon/legacy-contraction')
      callback(new Error(LEGACY_IDENTITY_METADATA))
      return
    }
    const selected = activeOccurrencesFromList(context.occurrences, projectPath)
    if (selected.open.length === 0) {
      callback(null, source, sourceMap, meta)
      return
    }
    const result = transformBuildReplacement({
      source: Buffer.isBuffer(source) ? source.toString('utf8') : source,
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
