const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const { getOptions } = require('loader-utils')
const path = require('path')
const { loadConfig } = require('../mycommon/config')
const { CollectionStore } = require('../mycommon/store')

const stores = global.__i18nCollectStores || (global.__i18nCollectStores = new Map())

function column(code, offset) {
  const lineStart = code.lastIndexOf('\n', offset - 1) + 1
  return code.slice(lineStart, offset).length
}

function collectEntries(code, resourcePath, root, kind) {
  const relativePath = path.relative(root, resourcePath).split(path.sep).join('/')
  const location = (node, fallbackKind) => ({
    path: relativePath,
    kind: kind || fallbackKind,
    start: { line: node.loc.start.line, column: column(code, node.start) },
    end: { line: node.loc.end.line, column: column(code, node.end) }
  })
  const entries = []
  const ast = parser.parse(code, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] })
  traverse(ast, {
    StringLiteral(nodePath) {
      if (['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration'].includes(nodePath.parent.type)) return
      if (/[\u4e00-\u9fa5]/.test(nodePath.node.value)) {
        entries.push({ value: nodePath.node.value, locations: [location(nodePath.node, 'script-string')] })
      }
    },
    TemplateLiteral(nodePath) {
      nodePath.node.quasis.forEach(node => {
        if (node.value.cooked && /[\u4e00-\u9fa5]/.test(node.value.cooked)) {
          entries.push({ value: node.value.cooked, locations: [location(node, 'template-literal')] })
        }
      })
    }
  })
  return entries
}

function collect(code, resourcePath, root, store) {
  const relativePath = path.relative(root, resourcePath).split(path.sep).join('/')
  store.replaceSnapshot(relativePath, collectEntries(code, resourcePath, root))
}

function getStore(root) {
  if (!stores.has(root)) stores.set(root, new CollectionStore())
  return stores.get(root)
}

function loader(code) {
  const options = getOptions(this) || {}
  const { root = process.cwd(), ...loaderOptions } = options
  const config = loadConfig({ root, loaderOptions })
  const store = getStore(config.root)
  const relativePath = path.relative(config.root, this.resourcePath).split(path.sep).join('/')
  const included = !config.include.length || config.include.some(item => relativePath.startsWith(item))
  const excluded = config.exclude.some(item => relativePath.startsWith(item))
  if ((!this.resourceQuery || this.resourceQuery.includes('type=script')) && included && !excluded) {
    collect(code, this.resourcePath, config.root, store)
  }
  return code
}

loader.getStore = getStore
loader.collect = collect
loader.collectEntries = collectEntries
module.exports = loader
