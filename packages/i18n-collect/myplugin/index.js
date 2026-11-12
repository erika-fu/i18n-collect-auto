const { canonicalRoot, loadConfig } = require('../mycommon/config')
const { analysisReport, analyzeSnapshots, buildSourceCatalog } = require('../mycommon/project-analysis')
const { publishCollectionOutputs } = require('../mycommon/formal-outputs')
const { assembleLiveSet, getSession } = require('../mycommon/session')

const PLUGIN = 'MyI18nPlugin'
const NOT_INTEGRATED =
  'i18n-collect loader is not integrated. Check ordinary module rules, Vue script/template/style block rules, and the HTML template loader chain.'

function metadataContext(compiler) {
  return {
    root: canonicalRoot(compiler.context),
    fileConfigHash: loadConfig({ root: compiler.context }).fileConfigHash
  }
}

function separatedModules(compilation) {
  const main = [...(compilation.modules || [])]
  const child = []
  const seen = new Set([compilation])
  const visit = current => {
    for (const next of current.children || []) {
      if (!next || seen.has(next)) continue
      seen.add(next)
      for (const mod of next.modules || []) child.push(mod)
      visit(next)
    }
  }
  visit(compilation)
  return { main, child }
}

function liveRound(compilation, context) {
  const { main, child } = separatedModules(compilation)
  const live = assembleLiveSet(main, context)
  const recovered = assembleLiveSet(child, context)
  const byIdentity = new Map()
  for (const snapshot of live.snapshots) {
    if (snapshot && snapshot.identity) byIdentity.set(snapshot.identity, snapshot)
  }
  for (const snapshot of recovered.snapshots) {
    if (snapshot && snapshot.identity && !byIdentity.has(snapshot.identity)) {
      byIdentity.set(snapshot.identity, snapshot)
    }
  }
  return {
    snapshots: [...byIdentity.values()],
    diagnostics: [...new Set([...live.diagnostics, ...recovered.diagnostics])],
    integrated: live.integrated || recovered.integrated
  }
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
        const round = liveRound(compilation, metadataContext(compiler))
        for (const diagnostic of round.diagnostics) compilation.errors.push(new Error(diagnostic))
        if (round.diagnostics.length > 0 || (session.invocationCount(compilation) === 0 && !round.integrated)) {
          if (round.diagnostics.length === 0) compilation.errors.push(new Error(NOT_INTEGRATED))
          session.abandon(compilation)
        }
      })
    })

    compiler.hooks.done.tapPromise(PLUGIN, async stats => {
      const compilation = stats.compilation
      if (stats.hasErrors() || session.isAbandoned(compilation)) {
        session.abandon(compilation)
        return
      }
      const round = liveRound(compilation, metadataContext(compiler))
      if (round.diagnostics.length > 0) {
        session.abandon(compilation)
        throw new Error(round.diagnostics.join('\n'))
      }
      const config = loadConfig({ root: compiler.context, pluginOptions: this.options })
      let catalog
      let report
      try {
        const analysis = analyzeSnapshots(round.snapshots, config)
        catalog = buildSourceCatalog(analysis)
        report = analysisReport(analysis)
      } catch (error) {
        session.abandon(compilation)
        throw error
      }
      await session.release(compilation, round.snapshots, config.configHash, () =>
        publishCollectionOutputs({
          root: config.root,
          config,
          catalog,
          report,
          dictionary: session.committed.runtimeDictionary(),
          sourceMap: session.committed.sourceMap(config.configHash)
        })
      )
    })
  }
}

module.exports = MyI18nPlugin
