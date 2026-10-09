const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const webpack = require('webpack')
const { VueLoaderPlugin } = require('@vue/vue-loader-v15')
const MyI18nPlugin = require('../myplugin')

const HELLO = '7eca689f0d3389d9dea66ae112e5cfd7'

function compile(config) {
  return new Promise((resolve, reject) => {
    const compiler = webpack(config)
    compiler.run((error, stats) => {
      compiler.close(closeError => {
        if (error) reject(error)
        else if (closeError) reject(closeError)
        else resolve(stats)
      })
    })
  })
}

function project(root, entry) {
  return {
    context: root,
    mode: 'development',
    entry,
    output: { path: path.join(root, 'dist'), filename: 'bundle.js' },
    infrastructureLogging: { level: 'error' },
    resolve: { alias: { vue$: 'vue/dist/vue.esm.js' } }
  }
}

function readOutput(root, outputPath = 'lang/zh_hash.json', sourceMapFilename = 'lang/zh_hash.map.json') {
  return {
    dictionary: JSON.parse(fs.readFileSync(path.join(root, outputPath), 'utf8')),
    map: JSON.parse(fs.readFileSync(path.join(root, sourceMapFilename), 'utf8'))
  }
}

function messages(stats) {
  return stats.toJson({ errors: true }).errors.map(error => error.message).join('\n')
}

test('aggregates loader snapshots and ignores source that never enters the loader', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-pipeline-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = "你好"\n')
  fs.writeFileSync(path.join(root, 'src/orphan.js'), 'module.exports = "孤儿词条"\n')
  const stats = await compile({
    ...project(root, path.join(root, 'src/app.js')),
    plugins: [new MyI18nPlugin()],
    module: { rules: [{ test: /\.js$/, loader: require.resolve('../myloader') }] }
  })
  assert.strictEqual(stats.hasErrors(), false, messages(stats))
  const { dictionary, map } = readOutput(root)
  assert.deepStrictEqual(dictionary, { [HELLO]: '你好' })
  assert.strictEqual(map.version, 1)
  assert.strictEqual(map.parserVersion, 'babel-7')
  assert.deepStrictEqual(map.entries.map(entry => entry.key), [...map.entries.map(entry => entry.key)].sort((a, b) => a.localeCompare(b)))
  assert.strictEqual(map.entries[0].locations[0].kind, 'script-string')
  assert.strictEqual(map.entries[0].locations[0].path, 'src/app.js')
})

test('an empty snapshot replaces previous copy for the same resource', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-empty-'))
  fs.mkdirSync(path.join(root, 'src'))
  const file = path.join(root, 'src/app.js')
  fs.writeFileSync(file, 'module.exports = "你好"\n')
  const config = {
    ...project(root, file),
    plugins: [new MyI18nPlugin()],
    module: { rules: [{ test: /\.js$/, loader: require.resolve('../myloader') }] }
  }
  const first = await compile(config)
  assert.strictEqual(first.hasErrors(), false, messages(first))
  assert.strictEqual(readOutput(root).dictionary[HELLO], '你好')
  fs.writeFileSync(file, 'module.exports = 1\n')
  const second = await compile(config)
  assert.strictEqual(second.hasErrors(), false, messages(second))
  assert.deepStrictEqual(readOutput(root).dictionary, {})
})

test('fails with a configuration error when no loader ran', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-missing-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = "你好"\n')
  const stats = await compile({
    ...project(root, path.join(root, 'src/app.js')),
    plugins: [new MyI18nPlugin()]
  })
  assert.strictEqual(stats.hasErrors(), true)
  const text = messages(stats)
  assert.match(text, /ordinary module rules/)
  assert.match(text, /Vue script\/template\/style block rules/)
  assert.match(text, /HTML template loader chain/)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/zh_hash.json')), false)
})

test('an excluded resource still counts as loader integration', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-exclude-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = "你好"\n')
  const stats = await compile({
    ...project(root, path.join(root, 'src/app.js')),
    plugins: [new MyI18nPlugin()],
    module: {
      rules: [{
        test: /\.js$/,
        loader: require.resolve('../myloader'),
        options: { include: ['src/kept'] }
      }]
    }
  })
  assert.strictEqual(stats.hasErrors(), false, messages(stats))
  assert.deepStrictEqual(readOutput(root).dictionary, {})
})

test('parallel root compilers do not share collection results', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-parallel-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src/a.js'), 'module.exports = "你好"\n')
  fs.writeFileSync(path.join(root, 'src/b.js'), 'module.exports = "世界"\n')
  const configFor = (entry, outputPath, sourceMapFilename) => ({
    ...project(root, path.join(root, entry)),
    plugins: [new MyI18nPlugin({ outputPath, sourceMapFilename })],
    module: { rules: [{ test: /\.js$/, loader: require.resolve('../myloader') }] }
  })
  const [first, second] = await Promise.all([
    compile(configFor('src/a.js', 'lang/a.json', 'lang/a.map.json')),
    compile(configFor('src/b.js', 'lang/b.json', 'lang/b.map.json'))
  ])
  assert.strictEqual(first.hasErrors(), false, messages(first))
  assert.strictEqual(second.hasErrors(), false, messages(second))
  assert.deepStrictEqual(Object.values(readOutput(root, 'lang/a.json', 'lang/a.map.json').dictionary), ['你好'])
  assert.deepStrictEqual(Object.values(readOutput(root, 'lang/b.json', 'lang/b.map.json').dictionary), ['世界'])
})

test('collection reads the original file before a later loader replaces the source', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-order-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = "你好"\n')
  const swallow = path.join(root, 'swallow-loader.js')
  fs.writeFileSync(swallow, 'module.exports = function (source) { return source }\nmodule.exports.pitch = function () { return \'module.exports = "HI"\\n\' }\n')
  const stats = await compile({
    ...project(root, path.join(root, 'src/app.js')),
    plugins: [new MyI18nPlugin()],
    module: {
      rules: [{
        test: /\.js$/,
        use: [require.resolve('../myloader'), swallow]
      }]
    }
  })
  assert.strictEqual(stats.hasErrors(), false, messages(stats))
  assert.strictEqual(readOutput(root).dictionary[HELLO], '你好')
  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(bundle, /HI/)
})

test('vue blocks keep independent snapshots through the loader chain', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-blocks-'))
  fs.mkdirSync(path.join(root, 'src'))
  const source = `<template>
  <div>{{ \`这是\${a}的名字呀\` }}</div>
</template>
<script>
export default { data () { return { b:"我不好" } } }
</script>
<style>
.badge { color: red; }
</style>
`
  fs.writeFileSync(path.join(root, 'src/App.vue'), source)
  fs.writeFileSync(path.join(root, 'src/orphan.vue'), '<template><div>孤儿词条</div></template>\n<script>export default { title: "未引用" }</script>\n')
  fs.writeFileSync(path.join(root, 'src/main.js'), [
    'require("./App.vue?vue&type=script&lang=js")',
    'require("./App.vue?vue&type=template&lang=html")',
    'require("./App.vue?vue&type=style&index=0&lang=css")',
    ''
  ].join('\n'))
  const pass = path.join(root, 'pass-loader.js')
  fs.writeFileSync(pass, 'module.exports = function () { this.callback(null, "module.exports = {}\\n") }\n')
  const collector = require.resolve('../myloader')
  const stats = await compile({
    ...project(root, path.join(root, 'src/main.js')),
    plugins: [new MyI18nPlugin()],
    module: {
      rules: [
        { test: /\.js$/, loader: collector },
        { test: /\.vue$/, resourceQuery: /type=script/, use: [pass, collector] },
        { test: /\.vue$/, resourceQuery: /type=template/, use: [pass, collector] },
        { test: /\.vue$/, resourceQuery: /type=style/, use: [pass, collector] }
      ]
    }
  })
  assert.strictEqual(stats.hasErrors(), false, messages(stats))
  const { dictionary, map } = readOutput(root)
  assert.deepStrictEqual(Object.values(dictionary).sort(), ['我不好', '的名字呀', '这是'])
  const kinds = new Map(map.entries.map(entry => [entry.value, entry.locations.map(location => location.kind)]))
  assert.deepStrictEqual(kinds.get('我不好'), ['script-string'])
  assert.deepStrictEqual(kinds.get('这是').sort(), ['template-expression'])
  assert.deepStrictEqual(kinds.get('的名字呀'), ['template-expression'])
  const identities = [...stats.compilation.modules]
    .map(mod => mod.buildInfo && mod.buildInfo.i18nCollect && mod.buildInfo.i18nCollect.snapshot)
    .filter(Boolean)
    .map(snapshot => snapshot.identity)
  assert.ok(identities.includes('src/App.vue::script[lang=js]'))
  assert.ok(identities.includes('src/App.vue::template[lang=html]'))
  assert.ok(identities.includes('src/App.vue::style[index=0;lang=css]'))
})

test('vue-loader blocks are collected from the original file', { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(__dirname, '.tmp-vue-'))
  try {
  fs.mkdirSync(path.join(root, 'src'))
  const source = `<template>
  <div>{{ \`这是\${a}的名字呀\` }}</div>
</template>
<script>
export default { data () { return { b:"我不好" } } }
</script>
`
  fs.writeFileSync(path.join(root, 'src/App.vue'), source)
  const collector = require.resolve('../myloader')
  const stats = await compile({
    ...project(root, path.join(root, 'src/App.vue')),
    plugins: [new MyI18nPlugin(), new VueLoaderPlugin()],
    module: {
      rules: [
        { test: /\.vue$/, loader: require.resolve('@vue/vue-loader-v15') },
        { test: /\.vue$/, resourceQuery: /type=script/, loader: collector },
        { test: /\.vue$/, resourceQuery: /type=template/, loader: collector },
        { test: /\.m?jsx?$/, exclude: /node_modules/, loader: collector }
      ]
    }
  })
  assert.strictEqual(stats.hasErrors(), false, messages(stats))
  const { dictionary, map } = readOutput(root)
  assert.deepStrictEqual(Object.values(dictionary).sort(), ['我不好', '的名字呀', '这是'])
  const greeting = map.entries.find(entry => entry.value === '这是')
  assert.strictEqual(greeting.locations[0].kind, 'template-expression')
  assert.strictEqual(greeting.locations[0].path, 'src/App.vue')
  const line = source.split('\n')[greeting.locations[0].start.line - 1]
  assert.strictEqual(line.slice(greeting.locations[0].start.column, greeting.locations[0].end.column), '这是')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('demo places the collector before thread-loader', () => {
  const Config = require('webpack-chain')
  const vueConfig = require('../../../apps/demo/vue.config')
  const config = new Config()
  const js = config.module.rule('js')
  js.use('thread-loader').loader('thread-loader')
  js.use('babel-loader').loader('babel-loader')
  vueConfig.chainWebpack(config)
  const loaders = js.uses.values().map(use => use.get('loader'))
  const collector = fs.realpathSync(require.resolve('../myloader'))
  const collectorIndex = loaders.findIndex(loader => fs.realpathSync(loader) === collector)
  assert.ok(collectorIndex !== -1)
  assert.ok(collectorIndex < loaders.indexOf('thread-loader'))
  assert.ok(loaders.indexOf('thread-loader') < loaders.indexOf('babel-loader'))
  assert.strictEqual(
    fs.realpathSync(config.module.rule('vue-template').uses.get('i18n-auto-loader').get('loader')),
    collector
  )
  assert.strictEqual(
    fs.realpathSync(config.module.rule('vue-script-i18n-collect').uses.get('i18n-auto-loader').get('loader')),
    collector
  )
})
