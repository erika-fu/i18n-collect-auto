const fs = require('fs')
const path = require('path')
const { CONFIG_FILE, canonicalRoot, loadConfig } = require('../mycommon/config')
const {
  COLLECT_METADATA,
  getSession,
  moduleMetadata
} = require('../mycommon/session')
const { extractScript } = require('./extract-script')
const { extractTemplateExpressions, extractVueScript } = require('./extract-vue-compat')
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

function entriesFor(resource, sourceText) {
  if (vueFile(resource.projectPath) && resource.block === 'script') {
    return extractVueScript({
      source: fs.readFileSync(resource.absolutePath, 'utf8'),
      resource
    })
  }
  if (vueFile(resource.projectPath) && resource.block === 'template') {
    return extractTemplateExpressions({
      source: fs.readFileSync(resource.absolutePath, 'utf8'),
      resource
    })
  }
  if (resource.block === 'script') return extractScript({ source: sourceText, resource })
  if (resource.block === 'style' || resource.block === 'html') return []
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
    resourceQuery: loaderContext.resourceQuery || ''
  })
  if (!isResourceIncluded(resource.projectPath, config)) {
    record(loaderContext, config, false, null)
    return
  }
  let entries
  try {
    entries = entriesFor(resource, text(sourceText))
  } catch (error) {
    throw collectionFailure(resource, error)
  }
  if (!entries || !resource.identity) {
    record(loaderContext, config, true, null)
    return
  }
  record(loaderContext, config, true, snapshotFor(resource, entries))
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
