const fs = require('fs')
const path = require('path')
const { canonicalRoot, loadConfig } = require('../mycommon/config')
const { writeOutputs } = require('../mycommon/output')
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
        const live = assembleLiveSet(compilation.modules, metadataContext(compiler))
        for (const diagnostic of live.diagnostics) compilation.errors.push(new Error(diagnostic))
        if (live.diagnostics.length > 0 || (session.invocationCount(compilation) === 0 && !live.integrated)) {
          if (live.diagnostics.length === 0) compilation.errors.push(new Error(NOT_INTEGRATED))
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
      const live = assembleLiveSet(compilation.modules, metadataContext(compiler))
      if (live.diagnostics.length > 0) {
        session.abandon(compilation)
        throw new Error(live.diagnostics.join('\n'))
      }
      const config = loadConfig({ root: compiler.context, pluginOptions: this.options })
      const snapshots = retainStaticHtmlSnapshots({
        live: live.snapshots,
        submitted: session.candidateSnapshots(compilation),
        committed: session.committedSnapshots(),
        activeTemplates: activeHtmlTemplates(compiler, compilation, config)
      })
      await session.release(compilation, snapshots, config.configHash, () =>
        writeOutputs(
          config.root,
          config,
          session.committed.runtimeDictionary(),
          session.committed.sourceMap(config.configHash)
        )
      )
    })
  }
}

module.exports = MyI18nPlugin
