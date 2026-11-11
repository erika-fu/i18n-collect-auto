const path = require('path')
const { readCatalogMetadataFile } = require('../mycommon/catalog')
const { catalogFiles, loadConfig } = require('../mycommon/config')
const { transformBuildReplacement } = require('../mycommon/build-replace')
const { SCRIPT_EXTENSIONS } = require('../mycommon/replace-preview')

function catalogOccurrences(metadata) {
  const items = []
  if (!metadata || !metadata.entries) return items
  for (const key of Object.keys(metadata.entries).sort()) {
    const entry = metadata.entries[key]
    if (!entry || entry.status === 'orphaned' || typeof entry.source !== 'string') continue
    if (!Array.isArray(entry.occurrences)) continue
    for (const occurrence of entry.occurrences) {
      const location = occurrence && occurrence.location
      if (!location || typeof location.path !== 'string') continue
      items.push({
        key,
        source: entry.source,
        location,
        reportedAmbiguity: false
      })
    }
  }
  return items
}

function loader(source, sourceMap, meta) {
  const callback = this.async()
  try {
    const options = typeof this.getOptions === 'function' ? (this.getOptions() || {}) : {}
    const root = path.resolve(options.root || this.rootContext || process.cwd())
    const resourcePath = this.resourcePath
    const projectPath = path.relative(root, resourcePath).split(path.sep).join('/')
    const extension = path.posix.extname(projectPath).toLowerCase()
    if (!SCRIPT_EXTENSIONS.has(extension)) {
      callback(null, source, sourceMap, meta)
      return
    }
    const config = loadConfig({ root })
    const build = config.buildReplacement
    if (!build || !build.enabled || build.adapter !== 'js') {
      callback(null, source, sourceMap, meta)
      return
    }
    const metadata = readCatalogMetadataFile(path.join(root, catalogFiles(config).metadata))
    if (!metadata) {
      callback(new Error('i18n-collect build replacement requires a published catalog'))
      return
    }
    const result = transformBuildReplacement({
      source: Buffer.isBuffer(source) ? source.toString('utf8') : source,
      root,
      projectPath,
      resourcePath,
      occurrences: catalogOccurrences(metadata),
      adapter: build.adapter,
      runtimeModule: build.runtimeModule,
      runtimeExport: build.runtimeExport,
      styleExtensions: config.styleExtensions,
      inputSourceMap: sourceMap || null
    })
    if (typeof this.addDependency === 'function') {
      this.addDependency(path.join(root, catalogFiles(config).metadata))
      this.addDependency(path.resolve(root, build.runtimeModule))
    }
    callback(null, result.code, result.map || sourceMap, meta)
  } catch (error) {
    callback(error)
  }
}

module.exports = loader
