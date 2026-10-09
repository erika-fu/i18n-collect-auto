const fs = require('fs')
const path = require('path')
const { loadConfig } = require('../mycommon/config')
const {
  COLLECT_METADATA,
  SCHEMA_VERSION,
  getSession
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

function metadata(included, snapshot) {
  return {
    schemaVersion: SCHEMA_VERSION,
    invoked: true,
    included,
    snapshot
  }
}

function record(loaderContext, included, snapshot) {
  const mod = loaderContext._module
  if (mod) {
    if (!mod.buildInfo) mod.buildInfo = {}
    mod.buildInfo[COLLECT_METADATA] = metadata(included, snapshot)
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
  const canonical = canonicalPair(config.root, loaderContext.resourcePath)
  const resource = describeResource({
    root: canonical.root,
    resourcePath: canonical.resourcePath,
    resourceQuery: loaderContext.resourceQuery || ''
  })
  if (!isResourceIncluded(resource.projectPath, config)) {
    record(loaderContext, false, null)
    return
  }
  let entries
  try {
    entries = entriesFor(resource, text(sourceText))
  } catch (error) {
    throw new Error(`i18n-collect failed for ${resource.projectPath} (${resource.block || 'unknown'}): ${error.message}`)
  }
  if (!entries || !resource.identity) {
    record(loaderContext, true, null)
    return
  }
  record(loaderContext, true, snapshotFor(resource, entries))
}

function loader(source, sourceMap, meta) {
  if (!this.data || !this.data.collected) runCollect(this, source)
  this.callback(null, source, sourceMap, meta)
}

loader.pitch = function pitch() {
  runCollect(this, fs.readFileSync(this.resourcePath, 'utf8'))
  if (this.data) this.data.collected = true
}

module.exports = loader
