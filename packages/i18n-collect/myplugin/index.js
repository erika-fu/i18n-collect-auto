const { loadConfig } = require('../mycommon/config')
const { writeOutputs } = require('../mycommon/output')
const { getStore, collect, collectEntries } = require('../myloader')
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

function region(source, start, end) {
  return source.slice(0, start).replace(/[^\n]/g, ' ') + source.slice(start, end)
}

function templateExpressions(source) {
  const template = source.match(/<template[^>]*>([\s\S]*?)<\/template>/)
  if (!template) return []
  const innerStart = template.index + template[0].indexOf(template[1])
  const expressions = []
  const pattern = /\{\{([\s\S]*?)\}\}/g
  let match
  while ((match = pattern.exec(template[1]))) {
    const start = innerStart + match.index + 2
    expressions.push([start, start + match[1].length])
  }
  return expressions
}

function collectProjectScripts(root, store) {
  for (const file of sourceFiles(path.join(root, 'src'))) {
    const source = fs.readFileSync(file, 'utf8')
    if (!file.endsWith('.vue')) {
      collect(source, file, root, store)
      continue
    }
    const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)
    const entries = []
    if (script) {
      const code = `${source.slice(0, script.index).replace(/[^\n]/g, ' ')}${script[1]}`
      entries.push(...collectEntries(code, file, root))
    }
    for (const [start, end] of templateExpressions(source)) {
      entries.push(...collectEntries(region(source, start, end), file, root, 'template-expression'))
    }
    const relativePath = path.relative(root, file).split(path.sep).join('/')
    store.replaceSnapshot(relativePath, entries)
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
