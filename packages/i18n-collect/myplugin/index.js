const { loadConfig } = require('../mycommon/config')
const { writeOutputs } = require('../mycommon/output')
const { getStore, collect } = require('../myloader')
const fs = require('fs')
const path = require('path')

function sourceFiles(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    return /\.(js|vue)$/.test(entry.name) ? [file] : []
  })
}

function collectProjectScripts(root, store) {
  for (const file of sourceFiles(path.join(root, 'src'))) {
    const source = fs.readFileSync(file, 'utf8')
    const script = file.endsWith('.vue') ? source.match(/<script[^>]*>([\s\S]*?)<\/script>/) : null
    const code = script
      ? `${source.slice(0, script.index).replace(/[^\n]/g, ' ')}${script[1]}`
      : source
    collect(code, file, root, store)
  }
}

class MyI18nPlugin {
  constructor(options = {}) {
    this.options = options
  }

  apply(compiler) {
    compiler.hooks.done.tapPromise('MyI18nPlugin', async () => {
      const config = loadConfig({ root: compiler.context, pluginOptions: this.options })
      const store = getStore(config.root)
      collectProjectScripts(config.root, store)
      await writeOutputs(config.root, config, store.runtimeDictionary(), store.sourceMap(config.configHash))
    })
  }
}

module.exports = MyI18nPlugin
