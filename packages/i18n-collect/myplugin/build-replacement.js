const path = require('path')
const { SCRIPT_EXTENSIONS } = require('../mycommon/replace-preview')

const PLUGIN = 'I18nBuildReplacementPlugin'
const LOADER = require.resolve('../myloader/build-replace-loader')

function normalizeLoaderPath(loader) {
  if (!loader) return ''
  if (typeof loader === 'object' && loader.loader) return normalizeLoaderPath(loader.loader)
  return String(loader).replace(/\\/g, '/')
}

function isCollectLoader(loader) {
  const value = normalizeLoaderPath(loader)
  return value.includes('/myloader/index.js')
    || value.endsWith('/myloader')
    || value.includes('/i18n-collect/myloader')
}

function isBuildReplaceLoader(loader) {
  const value = normalizeLoaderPath(loader)
  return value.includes('/build-replace-loader')
}

function insertLoader(loaders, entry) {
  if (loaders.some(isBuildReplaceLoader)) return
  const collectIndex = loaders.findIndex(isCollectLoader)
  if (collectIndex >= 0) {
    loaders.splice(collectIndex, 0, entry)
    return
  }
  loaders.push(entry)
}

class I18nBuildReplacementPlugin {
  constructor(options = {}) {
    this.options = options
  }

  apply(compiler) {
    const root = path.resolve(this.options.root || compiler.context || process.cwd())
    const webpack = compiler.webpack || require('webpack')
    const { NormalModule } = webpack

    compiler.hooks.compilation.tap(PLUGIN, compilation => {
      NormalModule.getCompilationHooks(compilation).loader.tap(PLUGIN, (loaderContext, mod) => {
        const resource = String((mod && (mod.resource || mod.userRequest)) || '').split('?')[0]
        if (!resource) return
        const extension = path.extname(resource).toLowerCase()
        if (!SCRIPT_EXTENSIONS.has(extension)) return
        insertLoader(mod.loaders, {
          loader: LOADER,
          options: { root },
          ident: 'i18n-collect-build-replace'
        })
      })
    })
  }
}

module.exports = I18nBuildReplacementPlugin
