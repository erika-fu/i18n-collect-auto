const { loadConfig } = require('../mycommon/config')
const { writeOutputs } = require('../mycommon/output')
const {
  COLLECT_METADATA,
  SCHEMA_VERSION,
  getSession,
  storeFromSnapshots
} = require('../mycommon/session')

const PLUGIN = 'MyI18nPlugin'
const NOT_INTEGRATED = 'i18n-collect loader is not integrated. Check ordinary module rules, Vue script/template/style block rules, and the HTML template loader chain.'

function collectMetadata(mod) {
  const metadata = mod && mod.buildInfo && mod.buildInfo[COLLECT_METADATA]
  if (!metadata || metadata.schemaVersion !== SCHEMA_VERSION || !metadata.invoked) return null
  return metadata
}

function hasMetadata(compilation) {
  for (const mod of compilation.modules) {
    if (collectMetadata(mod)) return true
  }
  return false
}

function liveSnapshots(compilation) {
  const byIdentity = new Map()
  for (const mod of compilation.modules) {
    const metadata = collectMetadata(mod)
    if (!metadata || !metadata.included || !metadata.snapshot || !metadata.snapshot.identity) continue
    byIdentity.set(metadata.snapshot.identity, metadata.snapshot)
  }
  return [...byIdentity.values()]
}

class MyI18nPlugin {
  constructor(options = {}) {
    this.options = options
  }

  apply(compiler) {
    const root = compiler.root || compiler
    if (compiler !== root) return
    const session = getSession(root)

    compiler.hooks.thisCompilation.tap(PLUGIN, compilation => {
      session.begin(compilation)
      compilation.hooks.afterSeal.tap(PLUGIN, () => {
        if (session.invocationCount(compilation) > 0 || hasMetadata(compilation)) return
        compilation.errors.push(new Error(NOT_INTEGRATED))
        session.abandon(compilation)
      })
    })

    compiler.hooks.done.tapPromise(PLUGIN, async stats => {
      const compilation = stats.compilation
      if (stats.hasErrors() || session.round(compilation).abandoned) {
        session.abandon(compilation)
        return
      }
      const config = loadConfig({ root: compiler.context, pluginOptions: this.options })
      const snapshots = liveSnapshots(compilation)
      const store = storeFromSnapshots(snapshots)
      await writeOutputs(config.root, config, store.runtimeDictionary(), store.sourceMap(config.configHash))
      session.commit(compilation, snapshots)
    })
  }
}

module.exports = MyI18nPlugin
