const { PLUGIN_COLLECTION_REMOVED } = require('../mycommon/legacy-contraction')

class MyI18nPlugin {
  constructor(options = {}) {
    this.options = options
  }

  apply(compiler) {
    const root = compiler.root || compiler
    if (compiler !== root) return
    throw new Error(PLUGIN_COLLECTION_REMOVED)
  }
}

module.exports = MyI18nPlugin
