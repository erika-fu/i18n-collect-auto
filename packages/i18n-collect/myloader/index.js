const fs = require('fs')
const path = require('path')
const { CONFIG_FILE, canonicalRoot, loadConfig } = require('../mycommon/config')
const {
  COLLECT_METADATA,
  getSession,
  moduleMetadata
} = require('../mycommon/session')
const { extractScript } = require('./extract-script')
const { extractHtml } = require('./extract-html')
const { extractCss } = require('./extract-css')
const { extractVueScript } = require('./extract-vue-compat')
const { describeResource, isResourceIncluded } = require('./resource')

function text(source) {
  return Buffer.isBuffer(source) ? source.toString('utf8') : source
}

function withoutRoot(options) {
  const { root, ...loaderOptions } = options || {}
  return { root, loaderOptions }
}

function canonicalPair(root, resourcePath) {
  const resolvedRoot = path.resolve(root)
  const resolvedResource = path.resolve(resourcePath)
  try {
    return {
      root: fs.realpathSync(resolvedRoot),
      resourcePath: fs.realpathSync(resolvedResource)
    }
  } catch (error) {
    return { root: resolvedRoot, resourcePath: resolvedResource }
  }
}

function vueFile(projectPath) {
  return projectPath.toLowerCase().endsWith('.vue')
}

function snapshotFor(resource, entries) {
  return {
    identity: resource.identity,
    projectPath: resource.projectPath,
    owner: {
      block: resource.block,
      styleIndex: resource.styleIndex,
      lang: resource.lang
    },
    entries
  }
}

function collectionFailure(resource, error) {
  const line = error && error.loc && error.loc.line
  const column = error && error.loc && error.loc.column
  const where = [
    resource.projectPath,
    resource.block || 'unknown',
    resource.block === 'style' && resource.styleIndex != null ? `index ${resource.styleIndex}` : null,
    resource.lang ? `lang ${resource.lang}` : null,
    line != null ? `line ${line}` : null,
    column != null ? `column ${column}` : null
  ].filter(Boolean).join(', ')
  const failure = new Error(`i18n-collect failed for ${where}: ${error.message}`)
  failure.cause = error
  return failure
}

function trackConfig(loaderContext, root) {
  const configFile = path.join(root, CONFIG_FILE)
  if (fs.existsSync(configFile)) {
    if (typeof loaderContext.addDependency === 'function') loaderContext.addDependency(configFile)
    return
  }
  if (typeof loaderContext.addMissingDependency === 'function') loaderContext.addMissingDependency(configFile)
}

function record(loaderContext, config, included, snapshot) {
  const mod = loaderContext._module
  if (mod) {
    if (!mod.buildInfo) mod.buildInfo = {}
    mod.buildInfo[COLLECT_METADATA] = moduleMetadata({
      root: canonicalRoot(config.root),
      fileConfigHash: config.fileConfigHash,
      included,
      snapshot
    })
  }
  if (!loaderContext._compiler || !loaderContext._compilation) return
  const session = getSession(loaderContext._compiler)
  if (included && snapshot) session.submit(loaderContext._compilation, mod, snapshot)
  else session.noteInvocation(loaderContext._compilation)
}

function publishWarnings(loaderContext, warnings) {
  if (!warnings || warnings.length === 0) return
  if (!loaderContext._compiler || !loaderContext._compilation) return
  const session = getSession(loaderContext._compiler)
  for (const warning of warnings) {
    if (!session.warn(loaderContext._compilation, warning)) continue
    const error = new Error(warning.message)
    if (typeof loaderContext.emitWarning === 'function') loaderContext.emitWarning(error)
    else if (Array.isArray(loaderContext._compilation.warnings)) loaderContext._compilation.warnings.push(error)
  }
}

function collectedFor(resource, sourceText, config) {
  if (vueFile(resource.projectPath) && resource.block === 'script') {
    return {
      entries: extractVueScript({
        source: fs.readFileSync(resource.absolutePath, 'utf8'),
        resource,
        config
      }),
      warnings: []
    }
  }
  if (resource.block === 'template' || resource.block === 'html') {
    return {
      entries: extractHtml({
        source: fs.readFileSync(resource.absolutePath, 'utf8'),
        resource,
        config
      }).entries,
      warnings: []
    }
  }
  if (resource.block === 'script') return { entries: extractScript({ source: sourceText, resource, config }), warnings: [] }
  if (resource.block === 'style') {
    return extractCss({
      source: fs.readFileSync(resource.absolutePath, 'utf8'),
      resource,
      config
    })
  }
  return null
}

function runCollect(loaderContext, sourceText) {
  if (loaderContext['thread-loader']) {
    throw new Error('i18n-collect loader must run in the main webpack process. Place it before thread-loader.')
  }
  const options = typeof loaderContext.getOptions === 'function' ? (loaderContext.getOptions() || {}) : {}
  const { root = loaderContext.rootContext || process.cwd(), loaderOptions } = withoutRoot(options)
  const config = loadConfig({ root, loaderOptions })
  trackConfig(loaderContext, config.root)
  const canonical = canonicalPair(config.root, loaderContext.resourcePath)
  const resource = describeResource({
    root: canonical.root,
    resourcePath: canonical.resourcePath,
    resourceQuery: loaderContext.resourceQuery || '',
    styleExtensions: config.styleExtensions
  })
  if (!isResourceIncluded(resource.projectPath, config)) {
    record(loaderContext, config, false, null)
    return
  }
  let collected
  try {
    collected = collectedFor(resource, text(sourceText), config)
  } catch (error) {
    throw collectionFailure(resource, error)
  }
  if (!collected || !resource.identity) {
    record(loaderContext, config, true, null)
    return
  }
  publishWarnings(loaderContext, collected.warnings)
  record(loaderContext, config, true, snapshotFor(resource, collected.entries))
}

function loader(source, sourceMap, meta) {
  if (!this.data || !this.data.collected) runCollect(this, source)
  else {
    const options = typeof this.getOptions === 'function' ? (this.getOptions() || {}) : {}
    trackConfig(this, path.resolve(options.root || this.rootContext || process.cwd()))
  }
  this.callback(null, source, sourceMap, meta)
}

loader.pitch = function pitch() {
  runCollect(this, fs.readFileSync(this.resourcePath, 'utf8'))
  if (this.data) this.data.collected = true
}

module.exports = loader
