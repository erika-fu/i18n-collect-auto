const { loadConfig } = require('../mycommon/config')
const { CollectionStore } = require('../mycommon/store')
const { extractScript } = require('./extract-script')
const { describeResource, isResourceIncluded } = require('./resource')

const stores = global.__i18nCollectStores || (global.__i18nCollectStores = new Map())

function text(source) {
  return Buffer.isBuffer(source) ? source.toString('utf8') : source
}

function withKind(entries, kind) {
  if (!kind) return entries
  return entries.map(entry => ({
    value: entry.value,
    locations: entry.locations.map(location => ({ ...location, kind }))
  }))
}

function collectEntries(code, resourcePath, root, kind) {
  const resource = describeResource({ root, resourcePath, resourceQuery: '' })
  return withKind(extractScript({ source: text(code), resource }), kind)
}

function collect(code, resourcePath, root, store) {
  const resource = describeResource({ root, resourcePath, resourceQuery: '' })
  store.replaceSnapshot(resource.projectPath, collectEntries(code, resourcePath, root))
}

function getStore(root) {
  if (!stores.has(root)) stores.set(root, new CollectionStore())
  return stores.get(root)
}

function loader(source, sourceMap, meta) {
  const options = this.getOptions() || {}
  const { root = process.cwd(), ...loaderOptions } = options
  const config = loadConfig({ root, loaderOptions })
  const resource = describeResource({
    root: config.root,
    resourcePath: this.resourcePath,
    resourceQuery: this.resourceQuery || ''
  })
  if (resource.block === 'script' && isResourceIncluded(resource.projectPath, config)) {
    getStore(config.root).replaceSnapshot(
      resource.projectPath,
      extractScript({ source: text(source), resource })
    )
  }
  this.callback(null, source, sourceMap, meta)
}

loader.getStore = getStore
loader.collect = collect
loader.collectEntries = collectEntries
module.exports = loader
