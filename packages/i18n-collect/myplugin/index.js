const fs = require('fs')
const path = require('path')
const { buildCatalog, catalogMetadata, conflictMessage, readCatalogMetadataFile } = require('../mycommon/catalog')
const { catalogFormat } = require('../mycommon/catalog-format')
const { canonicalRoot, catalogFiles, loadConfig } = require('../mycommon/config')
const { json, writeOutputs } = require('../mycommon/output')
const {
  assembleLiveSet,
  getSession,
  retainStaticHtmlSnapshots,
  selectActiveHtmlTemplates
} = require('../mycommon/session')
const { isResourceIncluded } = require('../myloader/resource')

const PLUGIN = 'MyI18nPlugin'
const NOT_INTEGRATED = 'i18n-collect loader is not integrated. Check ordinary module rules, Vue script/template/style block rules, and the HTML template loader chain.'

function templateFileFromRequest(template) {
  if (typeof template !== 'string' || !template || template === 'auto') return null
  const bang = template.lastIndexOf('!')
  const segment = bang === -1 ? template : template.slice(bang + 1)
  const file = segment.split('?')[0]
  if (!file || file.startsWith('data:')) return null
  return file
}

function configuredHtmlTemplates(compiler) {
  const files = []
  for (const plugin of compiler.options.plugins || []) {
    if (!plugin || plugin.constructor.name !== 'HtmlWebpackPlugin') continue
    const options = plugin.options || {}
    if (options.templateContent) continue
    const file = templateFileFromRequest(options.template)
    if (!file) continue
    files.push(path.resolve(compiler.context, file))
  }
  return files
}

function activeHtmlTemplates(compiler, compilation, config) {
  const selected = selectActiveHtmlTemplates({
    root: canonicalRoot(compiler.context),
    templates: configuredHtmlTemplates(compiler),
    dependencies: [...compilation.fileDependencies],
    missing: [...compilation.missingDependencies],
    present: file => fs.existsSync(file)
  })
  return selected.filter(projectPath => isResourceIncluded(projectPath, config))
}

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

function catalogOutputs(config, catalog) {
  const files = catalogFiles(config)
  const format = catalogFormat(config.catalogFormat)
  return [
    { path: files.messages, content: format.serialize(catalog.messages) },
    {
      path: files.metadata,
      content: json(catalogMetadata(catalog, { sourceLocale: config.sourceLocale, format: format.name }))
    }
  ]
}

function isHtmlIdentity(snapshot) {
  return Boolean(snapshot && typeof snapshot.identity === 'string' && snapshot.identity.endsWith('::html'))
}

function snapshotsForRelease(compilation, session, context) {
  const { main, child } = separatedModules(compilation)
  const live = assembleLiveSet(main, context)
  const recovered = assembleLiveSet(child, context)
  const submitted = new Map()
  for (const snapshot of session.candidateSnapshots(compilation)) {
    if (snapshot && snapshot.identity) submitted.set(snapshot.identity, snapshot)
  }
  for (const snapshot of recovered.snapshots) {
    if (isHtmlIdentity(snapshot) && !submitted.has(snapshot.identity)) submitted.set(snapshot.identity, snapshot)
  }
  return {
    live,
    diagnostics: [...new Set([...live.diagnostics, ...recovered.diagnostics])],
    integrated: live.integrated || recovered.integrated,
    snapshots: [...submitted.values()]
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
        const round = snapshotsForRelease(compilation, session, metadataContext(compiler))
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
      const round = snapshotsForRelease(compilation, session, metadataContext(compiler))
      if (round.diagnostics.length > 0) {
        session.abandon(compilation)
        throw new Error(round.diagnostics.join('\n'))
      }
      const config = loadConfig({ root: compiler.context, pluginOptions: this.options })
      const snapshots = retainStaticHtmlSnapshots({
        live: round.live.snapshots,
        submitted: round.snapshots,
        committed: session.committedSnapshots(),
        activeTemplates: activeHtmlTemplates(compiler, compilation, config)
      })
      const catalog = buildCatalog(snapshots, {
        previousMetadata: readCatalogMetadataFile(path.join(config.root, catalogFiles(config).metadata))
      })
      if (catalog.conflicts.length > 0) {
        session.abandon(compilation)
        throw new Error(conflictMessage(catalog.conflicts))
      }
      await session.release(compilation, snapshots, config.configHash, () =>
        writeOutputs(
          config.root,
          config,
          session.committed.runtimeDictionary(),
          session.committed.sourceMap(config.configHash),
          undefined,
          catalogOutputs(config, catalog)
        )
      )
    })
  }
}

module.exports = MyI18nPlugin
