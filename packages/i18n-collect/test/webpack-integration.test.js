const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const webpack = require('webpack')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const { NormalModule } = webpack
const { VueLoaderPlugin } = require('@vue/vue-loader-v15')
const { loadConfig } = require('../mycommon/config')
const { getSession } = require('../mycommon/session')
const MyI18nPlugin = require('../myplugin')

const HELLO = '7eca689f0d3389d9dea66ae112e5cfd7'

function compile(config, prepare) {
  return new Promise((resolve, reject) => {
    const compiler = webpack(config)
    if (prepare) prepare(compiler)
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

function warningText(stats) {
  return stats.toJson({ warnings: true }).warnings.map(warning => warning.message).join('\n')
}

function jsProject(root, entry) {
  return {
    ...project(root, entry),
    cache: { type: 'memory' },
    plugins: [new MyI18nPlugin()],
    module: { rules: [{ test: /\.js$/, loader: require.resolve('../myloader') }] }
  }
}

function start(config) {
  const compiler = webpack(config)
  return {
    compiler,
    run() {
      return new Promise((resolve, reject) => {
        compiler.run((error, stats) => {
          if (error) reject(error)
          else resolve(stats)
        })
      })
    },
    close() {
      return new Promise((resolve, reject) => {
        compiler.close(error => error ? reject(error) : resolve())
      })
    }
  }
}

function loaderResource(loaderContext, mod) {
  const resource = (mod && (mod.resource || mod.userRequest)) || (loaderContext && loaderContext.resourcePath) || ''
  return String(resource).split('?')[0].replace(/\\/g, '/')
}

function countLoaders(compiler, counts) {
  compiler.hooks.compilation.tap('i18n-count', compilation => {
    NormalModule.getCompilationHooks(compilation).loader.tap('i18n-count', (loaderContext, mod) => {
      const resource = loaderResource(loaderContext, mod)
      for (const suffix of Object.keys(counts)) {
        if (resource.endsWith(suffix)) counts[suffix] += 1
      }
    })
  })
}

function snapshotIdentities(stats) {
  return [...stats.compilation.modules]
    .map(mod => mod.buildInfo && mod.buildInfo.i18nCollect && mod.buildInfo.i18nCollect.snapshot)
    .filter(Boolean)
    .map(snapshot => snapshot.identity)
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

function templateOutput(stats) {
  return [...stats.compilation.modules].flatMap(mod => {
    const resource = String(mod.resource || '')
    if (!/[?&]type=template(?:&|$)/.test(resource)) return []
    const original = typeof mod.originalSource === 'function' ? mod.originalSource() : null
    if (!original) return []
    return [{ code: original.source(), map: original.map() }]
  })
}

test('vue template copy is collected while render output stays unchanged', { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(__dirname, '.tmp-vue-html-'))
  try {
    fs.mkdirSync(path.join(root, 'src'))
    const source = `<template>
  <section>
    <p>静态段落</p>
    <input :placeholder="'请' + missing + '输入'" title="姓名提示">
    <p>{{ \`欢迎\${name}回来\` }}</p>
  </section>
</template>
<script>
export default { name: 'App' }
</script>
`
    fs.writeFileSync(path.join(root, 'src/App.vue'), source)
    fs.writeFileSync(path.join(root, 'src/copy.html'), '<p>外部文案</p>\n')
    fs.writeFileSync(path.join(root, 'src/External.vue'), '<template src="./copy.html">\n  <p>诱饵文案</p>\n</template>\n<script>export default {}</script>\n')
    const collector = require.resolve('../myloader')
    const vueLoader = require.resolve('@vue/vue-loader-v15')
    const configFor = (entry, withCollector) => ({
      ...project(root, entry),
      plugins: [new VueLoaderPlugin(), ...(withCollector ? [new MyI18nPlugin()] : [])],
      module: {
        rules: [
          { test: /\.vue$/, loader: vueLoader },
          ...(withCollector ? [
            { resourceQuery: /type=template/, loader: collector },
            { test: /\.vue$/, resourceQuery: /type=script/, loader: collector }
          ] : [])
        ]
      }
    })
    const plain = await compile(configFor(path.join(root, 'src/App.vue'), false))
    assert.strictEqual(plain.hasErrors(), false, messages(plain))
    const collected = await compile(configFor(path.join(root, 'src/App.vue'), true))
    assert.strictEqual(collected.hasErrors(), false, messages(collected))
    const renderOf = stats => templateOutput(stats).filter(item => item.code.includes('var render'))
    const plainRender = renderOf(plain)
    assert.ok(plainRender.length > 0)
    assert.deepStrictEqual(renderOf(collected), plainRender)
    const { dictionary, map } = readOutput(root)
    const byValue = new Map(map.entries.map(entry => [entry.value, entry.locations.map(location => location.kind)]))
    assert.deepStrictEqual(byValue.get('静态段落'), ['html-text'])
    assert.deepStrictEqual(byValue.get('姓名提示'), ['html-attribute'])
    assert.deepStrictEqual(byValue.get('请'), ['html-attribute'])
    assert.deepStrictEqual(byValue.get('输入'), ['html-attribute'])
    assert.deepStrictEqual(byValue.get('欢迎'), ['template-expression'])
    assert.deepStrictEqual(byValue.get('回来'), ['template-expression'])
    assert.ok(!Object.values(dictionary).includes('诱饵文案'))
    const paragraph = map.entries.find(entry => entry.value === '静态段落')
    const line = source.split('\n')[paragraph.locations[0].start.line - 1]
    assert.strictEqual(line.slice(paragraph.locations[0].start.column, paragraph.locations[0].end.column), '静态段落')

    const external = await compile(configFor(path.join(root, 'src/External.vue'), true))
    assert.strictEqual(external.hasErrors(), false, messages(external))
    const externalMap = readOutput(root).map
    const outside = externalMap.entries.find(entry => entry.value === '外部文案')
    assert.ok(outside)
    assert.strictEqual(outside.locations[0].path, 'src/copy.html')
    assert.strictEqual(outside.locations[0].kind, 'html-text')
    assert.ok(!externalMap.entries.some(entry => entry.value === '诱饵文案'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a Vue template parse error keeps the previous published output', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-vue-fail-'))
  fs.mkdirSync(path.join(root, 'src'))
  const vue = path.join(root, 'src/App.vue')
  const entry = path.join(root, 'src/main.js')
  fs.writeFileSync(vue, '<template><p>你好</p></template>\n')
  fs.writeFileSync(entry, 'require("./App.vue?vue&type=template&lang=html")\n')
  const pass = path.join(root, 'pass-loader.js')
  fs.writeFileSync(pass, 'module.exports = function () { this.callback(null, "module.exports = {}\\n") }\n')
  const collector = require.resolve('../myloader')
  const handle = start({
    ...project(root, entry),
    plugins: [new MyI18nPlugin()],
    module: {
      rules: [
        { test: /\.js$/, loader: collector },
        { test: /\.vue$/, resourceQuery: /type=template/, use: [pass, collector] }
      ]
    }
  })
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    const dictionary = fs.readFileSync(path.join(root, 'lang/zh_hash.json'))
    const sourceMap = fs.readFileSync(path.join(root, 'lang/zh_hash.map.json'))
    fs.writeFileSync(vue, '<template>\n  <p>{{ \'你好\' + }}</p>\n</template>\n')
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), true)
    const text = messages(second)
    assert.match(text, /src\/App\.vue/)
    assert.match(text, /template/)
    assert.match(text, /line 2/)
    assert.match(text, /column 15/)
    assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.json')), dictionary)
    assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.map.json')), sourceMap)
    assert.deepStrictEqual(
      fs.readdirSync(path.join(root, 'lang')).filter(name => name.includes('.tmp-') || name.includes('.bak-')),
      []
    )
  } finally {
    await handle.close()
  }
})

test('keeps cached snapshots for modules whose loaders do not rerun', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-cache-module-'))
  fs.mkdirSync(path.join(root, 'src'))
  const entry = path.join(root, 'src/main.js')
  const stable = path.join(root, 'src/stable.js')
  const edited = path.join(root, 'src/edited.js')
  fs.writeFileSync(entry, 'require("./stable")\nrequire("./edited")\n')
  fs.writeFileSync(stable, 'module.exports = "稳定词条"\n')
  fs.writeFileSync(edited, 'module.exports = "旧词条"\n')
  const handle = start(jsProject(root, entry))
  const counts = { '/src/stable.js': 0, '/src/edited.js': 0 }
  countLoaders(handle.compiler, counts)
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    const stableRuns = counts['/src/stable.js']
    assert.ok(stableRuns > 0)
    fs.writeFileSync(edited, 'module.exports = "新词条"\n')
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), false, messages(second))
    assert.strictEqual(counts['/src/stable.js'], stableRuns)
    assert.ok(counts['/src/edited.js'] > stableRuns)
    const values = Object.values(readOutput(root).dictionary)
    assert.deepStrictEqual(values.slice().sort(), ['新词条', '稳定词条'])
  } finally {
    await handle.close()
  }
})

test('drops a snapshot when its import is removed even if the file remains', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-unimport-'))
  fs.mkdirSync(path.join(root, 'src'))
  const entry = path.join(root, 'src/main.js')
  const orphan = path.join(root, 'src/orphan.js')
  fs.writeFileSync(entry, 'require("./kept")\nrequire("./orphan")\n')
  fs.writeFileSync(path.join(root, 'src/kept.js'), 'module.exports = "你好"\n')
  fs.writeFileSync(orphan, 'module.exports = "孤儿词条"\n')
  const handle = start(jsProject(root, entry))
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    assert.deepStrictEqual(Object.values(readOutput(root).dictionary).sort(), ['你好', '孤儿词条'])
    fs.writeFileSync(entry, 'require("./kept")\n')
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), false, messages(second))
    assert.strictEqual(fs.existsSync(orphan), true)
    assert.deepStrictEqual(Object.values(readOutput(root).dictionary), ['你好'])
  } finally {
    await handle.close()
  }
})

test('drops a snapshot when its file leaves the module graph', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-delete-'))
  fs.mkdirSync(path.join(root, 'src'))
  const entry = path.join(root, 'src/main.js')
  const gone = path.join(root, 'src/gone.js')
  fs.writeFileSync(entry, 'require("./kept")\nrequire("./gone")\n')
  fs.writeFileSync(path.join(root, 'src/kept.js'), 'module.exports = "你好"\n')
  fs.writeFileSync(gone, 'module.exports = "将删除"\n')
  const handle = start(jsProject(root, entry))
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    fs.writeFileSync(entry, 'require("./kept")\n')
    fs.unlinkSync(gone)
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), false, messages(second))
    assert.deepStrictEqual(Object.values(readOutput(root).dictionary), ['你好'])
  } finally {
    await handle.close()
  }
})

test('drops a deleted Vue block and a replaced style identity', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-evict-vue-'))
  fs.mkdirSync(path.join(root, 'src'))
  const vue = path.join(root, 'src/App.vue')
  const entry = path.join(root, 'src/main.js')
  fs.writeFileSync(vue, `<template>
  <div>{{ \`这是\${a}的名字呀\` }}</div>
</template>
<script>
export default { data () { return { b:"我不好" } } }
</script>
<style>
.badge { color: red; }
</style>
`)
  fs.writeFileSync(entry, [
    'require("./App.vue?vue&type=script&lang=js")',
    'require("./App.vue?vue&type=template&lang=html")',
    'require("./App.vue?vue&type=style&index=0&lang=css")',
    ''
  ].join('\n'))
  const pass = path.join(root, 'pass-loader.js')
  fs.writeFileSync(pass, 'module.exports = function () { this.callback(null, "module.exports = {}\\n") }\n')
  const collector = require.resolve('../myloader')
  const handle = start({
    ...project(root, entry),
    cache: { type: 'memory' },
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
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    assert.deepStrictEqual(Object.values(readOutput(root).dictionary).sort(), ['我不好', '的名字呀', '这是'])
    assert.ok(snapshotIdentities(first).includes('src/App.vue::style[index=0;lang=css]'))
    fs.writeFileSync(vue, `<script>
export default { data () { return { b:"我不好" } } }
</script>
<style lang="scss">
.badge { color: red; }
</style>
`)
    fs.writeFileSync(entry, [
      'require("./App.vue?vue&type=script&lang=js")',
      'require("./App.vue?vue&type=style&index=0&lang=scss")',
      ''
    ].join('\n'))
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), false, messages(second))
    assert.deepStrictEqual(Object.values(readOutput(root).dictionary), ['我不好'])
    const identities = snapshotIdentities(second)
    assert.ok(identities.includes('src/App.vue::script[lang=js]'))
    assert.ok(identities.includes('src/App.vue::style[index=0;lang=scss]'))
    assert.ok(!identities.includes('src/App.vue::template[lang=html]'))
    assert.ok(!identities.includes('src/App.vue::style[index=0;lang=css]'))
    const committed = getSession(handle.compiler).committedSnapshots().map(snapshot => snapshot.identity)
    assert.ok(!committed.includes('src/App.vue::template[lang=html]'))
    assert.ok(!committed.includes('src/App.vue::style[index=0;lang=css]'))
  } finally {
    await handle.close()
  }
})

test('a failed parse keeps the committed result and both published outputs', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-fail-'))
  fs.mkdirSync(path.join(root, 'src'))
  const file = path.join(root, 'src/app.js')
  fs.writeFileSync(file, 'module.exports = "你好"\n')
  const handle = start(jsProject(root, file))
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    const dictionary = fs.readFileSync(path.join(root, 'lang/zh_hash.json'))
    const sourceMap = fs.readFileSync(path.join(root, 'lang/zh_hash.map.json'))
    const committed = getSession(handle.compiler).committed.runtimeDictionary()
    fs.writeFileSync(file, 'const message = "你好\n')
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), true)
    const text = messages(second)
    assert.match(text, /src\/app\.js/)
    assert.match(text, /script/)
    assert.match(text, /line 1/)
    assert.match(text, /Unterminated string constant/)
    assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.json')), dictionary)
    assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.map.json')), sourceMap)
    assert.deepStrictEqual(getSession(handle.compiler).committed.runtimeDictionary(), committed)
    assert.deepStrictEqual(
      fs.readdirSync(path.join(root, 'lang')).filter(name => name.includes('.tmp-') || name.includes('.bak-')),
      []
    )
  } finally {
    await handle.close()
  }
})

test('invalid metadata fails the round without replacing the last output', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-bad-meta-'))
  fs.mkdirSync(path.join(root, 'src'))
  const file = path.join(root, 'src/app.js')
  fs.writeFileSync(file, 'module.exports = "你好"\n')
  let corrupt = false
  const handle = start({
    ...jsProject(root, file),
    plugins: [
      {
        apply(compiler) {
          compiler.hooks.thisCompilation.tap('corrupt-metadata', compilation => {
            compilation.hooks.seal.tap('corrupt-metadata', () => {
              if (!corrupt) return
              for (const mod of compilation.modules) {
                if (mod.buildInfo && mod.buildInfo.i18nCollect) mod.buildInfo.i18nCollect.schemaVersion = 0
              }
            })
          })
        }
      },
      new MyI18nPlugin()
    ]
  })
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    const dictionary = fs.readFileSync(path.join(root, 'lang/zh_hash.json'))
    corrupt = true
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), true)
    assert.match(messages(second), /schema/)
    assert.match(messages(second), /src\/app\.js/)
    assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.json')), dictionary)
  } finally {
    await handle.close()
  }
})

test('a configuration file change invalidates filtering and configHash', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-reconfig-'))
  fs.mkdirSync(path.join(root, 'src/kept'), { recursive: true })
  const configFile = path.join(root, 'i18n-collect.config.js')
  fs.writeFileSync(configFile, 'module.exports = { include: ["src/kept"] }\n')
  const file = path.join(root, 'src/kept/app.js')
  fs.writeFileSync(file, 'module.exports = "你好"\n')
  const handle = start(jsProject(root, file))
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    assert.deepStrictEqual(Object.values(readOutput(root).dictionary), ['你好'])
    const firstHash = readOutput(root).map.configHash
    fs.writeFileSync(configFile, 'module.exports = { include: ["src/other"] }\n')
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), false, messages(second))
    assert.deepStrictEqual(readOutput(root).dictionary, {})
    const secondHash = readOutput(root).map.configHash
    assert.notStrictEqual(secondHash, firstHash)
    assert.strictEqual(secondHash, loadConfig({ root }).configHash)
  } finally {
    await handle.close()
  }
})

test('filesystem cache matches an uncached build without a loader rerun', { timeout: 40000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-fscache-'))
  fs.mkdirSync(path.join(root, 'src'))
  const file = path.join(root, 'src/app.js')
  fs.writeFileSync(file, 'module.exports = "你好"\n')
  const cacheDirectory = path.join(root, '.cache')
  const cached = {
    ...jsProject(root, file),
    cache: { type: 'filesystem', cacheDirectory, name: 'i18n-collect-test' }
  }
  const first = await compile(cached)
  assert.strictEqual(first.hasErrors(), false, messages(first))
  const dictionary = fs.readFileSync(path.join(root, 'lang/zh_hash.json'))
  const sourceMap = fs.readFileSync(path.join(root, 'lang/zh_hash.map.json'))

  let loaderRuns = 0
  const second = await compile(cached, compiler => {
    compiler.hooks.compilation.tap('i18n-count', compilation => {
      NormalModule.getCompilationHooks(compilation).loader.tap('i18n-count', (loaderContext, mod) => {
        if (loaderResource(loaderContext, mod).endsWith('/src/app.js')) loaderRuns += 1
      })
    })
  })
  assert.strictEqual(second.hasErrors(), false, messages(second))
  assert.strictEqual(loaderRuns, 0)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.json')), dictionary)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.map.json')), sourceMap)

  const plainRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-nocache-'))
  fs.mkdirSync(path.join(plainRoot, 'src'))
  fs.writeFileSync(path.join(plainRoot, 'src/app.js'), 'module.exports = "你好"\n')
  const plain = await compile({ ...jsProject(plainRoot, path.join(plainRoot, 'src/app.js')), cache: false })
  assert.strictEqual(plain.hasErrors(), false, messages(plain))
  assert.deepStrictEqual(fs.readFileSync(path.join(plainRoot, 'lang/zh_hash.json')), dictionary)
  assert.deepStrictEqual(fs.readFileSync(path.join(plainRoot, 'lang/zh_hash.map.json')), sourceMap)
})

test('demo places the collector before thread-loader and the HTML template loader', () => {
  const Config = require('webpack-chain')
  const vueConfig = require('../../../apps/demo/vue.config')
  const config = new Config()
  const js = config.module.rule('js')
  js.use('thread-loader').loader('thread-loader')
  js.use('babel-loader').loader('babel-loader')
  const indexTemplate = path.join('public', 'index.html')
  const aboutTemplate = path.join('public', 'about.html')
  config.plugin('html').use(class HtmlWebpackPlugin {}, [{
    template: indexTemplate,
    title: 'demo',
    inject: true,
    scriptLoading: 'defer'
  }])
  config.plugin('html-about').use(class HtmlWebpackPlugin {}, [{
    template: aboutTemplate,
    title: 'about',
    inject: false
  }])
  config.plugin('define').use(class DefinePlugin {}, [{ 'process.env.NODE_ENV': '"test"' }])
  const css = config.module.rule('css')
  for (const name of ['vue-modules', 'vue', 'normal-modules', 'normal']) {
    const oneOf = css.oneOf(name)
    oneOf.use('css-loader').loader('css-loader')
    oneOf.use('postcss-loader').loader('postcss-loader')
  }
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
  assert.strictEqual(
    fs.realpathSync(config.module.rule('vue-style-i18n-collect').uses.get('i18n-auto-loader').get('loader')),
    collector
  )
  const loaderName = loader => {
    try {
      return fs.realpathSync(loader)
    } catch (error) {
      return loader
    }
  }
  for (const name of ['normal', 'normal-modules']) {
    const loaders = css.oneOf(name).uses.values().map(use => loaderName(use.get('loader')))
    assert.ok(loaders.indexOf('postcss-loader') < loaders.indexOf(collector))
  }
  for (const name of ['vue', 'vue-modules']) {
    const loaders = css.oneOf(name).uses.values().map(use => loaderName(use.get('loader')))
    assert.ok(!loaders.includes(collector))
  }
  for (const [name, templatePath, title, inject] of [
    ['html', indexTemplate, 'demo', true],
    ['html-about', aboutTemplate, 'about', false]
  ]) {
    const options = config.plugin(name).get('args')[0]
    assert.strictEqual(options.title, title)
    assert.strictEqual(options.inject, inject)
    assert.ok(options.template.startsWith('!!'))
    assert.ok(options.template.endsWith(templatePath))
    assert.match(options.template, /"force":true/)
    assert.ok(options.template.indexOf('html-webpack-plugin') < options.template.indexOf('myloader'))
    assert.ok(options.template.indexOf('myloader') < options.template.lastIndexOf(templatePath))
  }
  assert.strictEqual(config.plugins.has('define'), true)
})

function htmlTemplateRequest(template) {
  const htmlLoader = require.resolve('html-webpack-plugin/lib/loader.js')
  const collector = require.resolve('../myloader')
  return `!!${htmlLoader}?${JSON.stringify({ force: true })}!${collector}!${template}`
}

function countHtmlCollector(compiler, state) {
  compiler.hooks.thisCompilation.tap('i18n-html-count', compilation => {
    compilation.hooks.childCompiler.tap('i18n-html-count', childCompiler => {
      childCompiler.hooks.compilation.tap('i18n-html-count', childCompilation => {
        NormalModule.getCompilationHooks(childCompilation).loader.tap('i18n-html-count', (loaderContext, mod) => {
          const resource = loaderResource(loaderContext, mod)
          if (resource.endsWith('/public/index.html')) state.count += 1
        })
      })
    })
  })
}

function htmlPage(root, template) {
  const entry = path.join(root, 'src/main.js')
  return {
    ...project(root, entry),
    output: { path: path.join(root, 'dist'), filename: 'bundle.js', publicPath: '/' },
    cache: { type: 'memory' },
    plugins: [
      new HtmlWebpackPlugin({
        template: htmlTemplateRequest(template),
        filename: 'index.html',
        title: '演示标题',
        templateParameters: { BASE_URL: '/' },
        inject: true
      }),
      new MyI18nPlugin()
    ],
    module: { rules: [{ test: /\.js$/, loader: require.resolve('../myloader') }] }
  }
}

function pageHtml(body) {
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <link rel="icon" href="<%= BASE_URL %>favicon.ico">',
    '  <title><%= htmlWebpackPlugin.options.title %></title>',
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
    ''
  ].join('\n')
}

test('collects a raw HTMLWebpackPlugin template and retains it when the child cache hits', { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-html-plugin-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.mkdirSync(path.join(root, 'public'))
  const entry = path.join(root, 'src/main.js')
  const template = path.join(root, 'public/index.html')
  fs.writeFileSync(entry, 'module.exports = "脚本甲"\n')
  fs.writeFileSync(template, pageHtml([
    '  <p title="说明">页面文案</p>',
    "  <p><%= '隐藏中文' %></p>"
  ].join('\n')))
  const state = { count: 0 }
  const handle = start(htmlPage(root, template))
  countHtmlCollector(handle.compiler, state)
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    assert.ok(state.count > 0)
    const htmlPlugin = handle.compiler.options.plugins.find(plugin => plugin.constructor.name === 'HtmlWebpackPlugin')
    const request = htmlPlugin.options.template
    assert.ok(request.startsWith('!!'))
    assert.match(request, /"force":true/)
    assert.ok(request.indexOf('html-webpack-plugin') < request.indexOf('myloader'))
    const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8')
    assert.ok(!html.includes('<%'))
    assert.ok(html.includes('<title>演示标题</title>'))
    assert.ok(html.includes('href="/favicon.ico"'))
    assert.match(html, /src="\/bundle\.js"/)
    assert.ok(html.includes('页面文案'))
    const firstValues = Object.values(readOutput(root).dictionary)
    assert.deepStrictEqual(new Set(firstValues), new Set(['说明', '页面文案', '脚本甲']))
    assert.ok(!firstValues.includes('隐藏中文'))
    assert.ok(!firstValues.includes('演示标题'))
    const committed = getSession(handle.compiler).committedSnapshots().map(snapshot => snapshot.identity)
    assert.ok(committed.includes('public/index.html::html'))
    assert.ok(committed.includes('src/main.js::script'))

    state.count = 0
    fs.writeFileSync(entry, 'module.exports = "脚本乙"\n')
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), false, messages(second))
    assert.strictEqual(state.count, 0)
    assert.deepStrictEqual(new Set(Object.values(readOutput(root).dictionary)), new Set(['说明', '页面文案', '脚本乙']))

    fs.writeFileSync(template, pageHtml('  <p title="新说明">新页面</p>'))
    const third = await handle.run()
    assert.strictEqual(third.hasErrors(), false, messages(third))
    assert.deepStrictEqual(new Set(Object.values(readOutput(root).dictionary)), new Set(['新说明', '新页面', '脚本乙']))
    const thirdHtml = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8')
    assert.ok(!thirdHtml.includes('<%'))
    assert.ok(thirdHtml.includes('<title>演示标题</title>'))
  } finally {
    await handle.close()
  }
})

test('does not collect HTML that never enters the loader chain', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-html-orphan-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.mkdirSync(path.join(root, 'public'))
  fs.writeFileSync(path.join(root, 'src/main.js'), 'module.exports = "脚本"\n')
  fs.writeFileSync(path.join(root, 'public/index.html'), '<p>孤儿页面</p>\n')
  const stats = await compile({
    ...project(root, path.join(root, 'src/main.js')),
    plugins: [
      new HtmlWebpackPlugin({ templateContent: '<p>模板内容中文</p>', title: '演示标题' }),
      new MyI18nPlugin()
    ],
    module: { rules: [{ test: /\.js$/, loader: require.resolve('../myloader') }] }
  })
  assert.strictEqual(stats.hasErrors(), false, messages(stats))
  assert.deepStrictEqual(Object.values(readOutput(root).dictionary), ['脚本'])
})

test('evicts a static HTML snapshot when the template is no longer a dependency', { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-html-evict-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.mkdirSync(path.join(root, 'public'))
  const template = path.join(root, 'public/index.html')
  fs.writeFileSync(path.join(root, 'src/main.js'), 'module.exports = "脚本"\n')
  fs.writeFileSync(template, pageHtml('  <p>页面文案</p>'))
  let drop = false
  const config = htmlPage(root, template)
  config.plugins.unshift({
    apply(compiler) {
      compiler.hooks.done.tap('drop-html-dependency', stats => {
        if (!drop) return
        for (const file of [...stats.compilation.fileDependencies]) {
          if (String(file).replace(/\\/g, '/').endsWith('/public/index.html')) {
            stats.compilation.fileDependencies.delete(file)
          }
        }
      })
    }
  })
  const handle = start(config)
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    assert.ok(Object.values(readOutput(root).dictionary).includes('页面文案'))
    drop = true
    fs.writeFileSync(path.join(root, 'src/main.js'), 'module.exports = "脚本乙"\n')
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), false, messages(second))
    assert.deepStrictEqual(Object.values(readOutput(root).dictionary), ['脚本乙'])
    assert.ok(!getSession(handle.compiler).committedSnapshots().some(snapshot => snapshot.identity.endsWith('::html')))
  } finally {
    await handle.close()
  }
})

test('a static HTML parse failure preserves the previous collection output', { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-html-fail-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.mkdirSync(path.join(root, 'public'))
  const template = path.join(root, 'public/index.html')
  fs.writeFileSync(path.join(root, 'src/main.js'), 'module.exports = "脚本"\n')
  fs.writeFileSync(template, pageHtml('  <p>页面文案</p>'))
  const handle = start(htmlPage(root, template))
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    const dictionary = fs.readFileSync(path.join(root, 'lang/zh_hash.json'))
    const sourceMap = fs.readFileSync(path.join(root, 'lang/zh_hash.map.json'))
    const committed = getSession(handle.compiler).committed.runtimeDictionary()
    fs.writeFileSync(template, '<p title="甲" title="乙">文案</p>\n')
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), true)
    const text = messages(second).replace(/\s+/g, '')
    assert.match(text, /public\/index\.html/)
    assert.match(text, /duplicate-attribute/)
    assert.match(text, /line1/)
    assert.match(text, /column18/)
    assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.json')), dictionary)
    assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.map.json')), sourceMap)
    assert.deepStrictEqual(getSession(handle.compiler).committed.runtimeDictionary(), committed)
  } finally {
    await handle.close()
  }
})

function styleProject(root, entry) {
  const pass = path.join(root, 'pass-loader.js')
  fs.writeFileSync(pass, 'module.exports = function () { this.callback(null, "module.exports = {}\\n") }\n')
  const collector = require.resolve('../myloader')
  return {
    ...project(root, entry),
    cache: { type: 'memory' },
    plugins: [new MyI18nPlugin()],
    module: {
      rules: [
        { test: /\.js$/, loader: collector },
        { test: /\.css$/, use: [pass, collector] },
        { test: /\.vue$/, resourceQuery: /type=style/, use: [pass, collector] }
      ]
    }
  }
}

test('collects standalone CSS and each Vue style block, then drops only the deleted block', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-css-blocks-'))
  fs.mkdirSync(path.join(root, 'src'))
  const vue = path.join(root, 'src/App.vue')
  const css = path.join(root, 'src/base.css')
  const entry = path.join(root, 'src/main.js')
  fs.writeFileSync(css, '.badge::before { content: "独立"; }\n')
  fs.writeFileSync(vue, [
    '<template><p>模板</p></template>',
    '<style>',
    '.a { content: "第一"; }',
    '</style>',
    '<style>',
    '.a { content: "第一"; }',
    '</style>',
    '<style lang="css">',
    '.b { content: "第二"; }',
    '</style>',
    ''
  ].join('\n'))
  fs.writeFileSync(entry, [
    'require("./base.css")',
    'require("./App.vue?vue&type=style&index=0&lang=css")',
    'require("./App.vue?vue&type=style&index=1&lang=css")',
    'require("./App.vue?vue&type=style&index=2&lang=css")',
    ''
  ].join('\n'))
  const handle = start(styleProject(root, entry))
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    const { dictionary, map } = readOutput(root)
    assert.deepStrictEqual(Object.values(dictionary).sort(), ['独立', '第一', '第二'])
    const kinds = new Map(map.entries.map(item => [item.value, item.locations]))
    assert.deepStrictEqual(kinds.get('独立').map(location => location.kind), ['css-generated-content'])
    assert.strictEqual(kinds.get('独立')[0].path, 'src/base.css')
    assert.strictEqual(kinds.get('第一').length, 2)
    assert.ok(kinds.get('第一').every(location => location.kind === 'css-generated-content' && location.path === 'src/App.vue'))
    assert.strictEqual(new Set(kinds.get('第一').map(location => location.start.line)).size, 2)
    assert.deepStrictEqual(snapshotIdentities(first).filter(identity => identity.includes('::style')).sort(), [
      'src/App.vue::style[index=0;lang=css]',
      'src/App.vue::style[index=1;lang=css]',
      'src/App.vue::style[index=2;lang=css]',
      'src/base.css::style[index=0;lang=css]'
    ])
    fs.writeFileSync(vue, [
      '<style>',
      '.a { content: "第一"; }',
      '</style>',
      ''
    ].join('\n'))
    fs.writeFileSync(entry, [
      'require("./base.css")',
      'require("./App.vue?vue&type=style&index=0&lang=css")',
      ''
    ].join('\n'))
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), false, messages(second))
    const after = readOutput(root)
    assert.deepStrictEqual(Object.values(after.dictionary).sort(), ['独立', '第一'])
    const remaining = after.map.entries.find(item => item.value === '第一')
    assert.strictEqual(remaining.locations.length, 1)
    assert.ok(!snapshotIdentities(second).includes('src/App.vue::style[index=1;lang=css]'))
    assert.ok(!snapshotIdentities(second).includes('src/App.vue::style[index=2;lang=css]'))
    assert.ok(snapshotIdentities(second).includes('src/App.vue::style[index=0;lang=css]'))
    assert.ok(snapshotIdentities(second).includes('src/base.css::style[index=0;lang=css]'))
  } finally {
    await handle.close()
  }
})

test('a style index change evicts the previous identity', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-css-index-'))
  fs.mkdirSync(path.join(root, 'src'))
  const vue = path.join(root, 'src/App.vue')
  const entry = path.join(root, 'src/main.js')
  fs.writeFileSync(vue, [
    '<style>',
    '.a { content: "第一"; }',
    '</style>',
    '<style>',
    '.b { content: "第二"; }',
    '</style>',
    ''
  ].join('\n'))
  fs.writeFileSync(entry, [
    'require("./App.vue?vue&type=style&index=0&lang=css")',
    'require("./App.vue?vue&type=style&index=1&lang=css")',
    ''
  ].join('\n'))
  const handle = start(styleProject(root, entry))
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    assert.ok(snapshotIdentities(first).includes('src/App.vue::style[index=1;lang=css]'))
    fs.writeFileSync(vue, '<style>\n.b { content: "第二"; }\n</style>\n')
    fs.writeFileSync(entry, 'require("./App.vue?vue&type=style&index=0&lang=css")\n')
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), false, messages(second))
    assert.deepStrictEqual(Object.values(readOutput(root).dictionary), ['第二'])
    const identities = snapshotIdentities(second)
    assert.ok(identities.includes('src/App.vue::style[index=0;lang=css]'))
    assert.ok(!identities.includes('src/App.vue::style[index=1;lang=css]'))
    const location = readOutput(root).map.entries[0].locations[0]
    assert.strictEqual(location.kind, 'css-generated-content')
    assert.strictEqual(fs.readFileSync(vue, 'utf8').split('\n')[location.start.line - 1].includes('第二'), true)
  } finally {
    await handle.close()
  }
})

test('warns once for an unsupported style and still publishes an empty snapshot', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-css-scss-'))
  fs.mkdirSync(path.join(root, 'src'))
  const vue = path.join(root, 'src/App.vue')
  const entry = path.join(root, 'src/main.js')
  fs.writeFileSync(vue, '<style>\n.a { content: "样式文案"; }\n</style>\n')
  fs.writeFileSync(entry, 'require("./App.vue?vue&type=style&index=0&lang=css")\n')
  const handle = start(styleProject(root, entry))
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    assert.deepStrictEqual(Object.values(readOutput(root).dictionary), ['样式文案'])
    fs.writeFileSync(vue, '<style lang="scss">\n$color: red;\n.a { content: "样式文案"; }\n</style>\n')
    fs.writeFileSync(entry, 'require("./App.vue?vue&type=style&index=0&lang=scss")\n')
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), false, messages(second))
    assert.deepStrictEqual(readOutput(root).dictionary, {})
    const text = warningText(second)
    assert.match(text, /scss/)
    assert.match(text, /src\/App\.vue::style\[index=0;lang=scss\]/)
    assert.strictEqual(text.split('does not parse scss').length - 1, 1)
    const snapshot = [...second.compilation.modules]
      .map(mod => mod.buildInfo && mod.buildInfo.i18nCollect && mod.buildInfo.i18nCollect.snapshot)
      .find(item => item && item.identity === 'src/App.vue::style[index=0;lang=scss]')
    assert.ok(snapshot)
    assert.deepStrictEqual(snapshot.entries, [])
    assert.ok(!snapshotIdentities(second).includes('src/App.vue::style[index=0;lang=css]'))
  } finally {
    await handle.close()
  }
})

test('a CSS syntax error preserves the previous collection output', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-css-fail-'))
  fs.mkdirSync(path.join(root, 'src'))
  const css = path.join(root, 'src/base.css')
  fs.writeFileSync(css, '.a::before { content: "必填"; }\n')
  const handle = start(styleProject(root, css))
  try {
    const first = await handle.run()
    assert.strictEqual(first.hasErrors(), false, messages(first))
    const dictionary = fs.readFileSync(path.join(root, 'lang/zh_hash.json'))
    const sourceMap = fs.readFileSync(path.join(root, 'lang/zh_hash.map.json'))
    const committed = getSession(handle.compiler).committed.runtimeDictionary()
    fs.writeFileSync(css, '.a { content: "必填 }\n')
    const second = await handle.run()
    assert.strictEqual(second.hasErrors(), true)
    const text = messages(second)
    assert.match(text, /src\/base\.css/)
    assert.match(text, /style/)
    assert.match(text, /index 0/)
    assert.match(text, /lang css/)
    assert.match(text, /line 1/)
    assert.match(text, /column 14/)
    assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.json')), dictionary)
    assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.map.json')), sourceMap)
    assert.deepStrictEqual(getSession(handle.compiler).committed.runtimeDictionary(), committed)
  } finally {
    await handle.close()
  }
})

test('css-loader output stays unchanged when collection runs on the original source', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-css-passthrough-'))
  fs.mkdirSync(path.join(root, 'src'))
  const css = path.join(root, 'src/app.css')
  fs.writeFileSync(css, '.a::before {\n  content: "必填";\n  color: red;\n}\n')
  const record = path.join(root, 'record-loader.js')
  fs.writeFileSync(record, [
    'const fs = require("fs")',
    'module.exports = function (source, map, meta) {',
    '  fs.writeFileSync(this.getOptions().record, JSON.stringify({ source, map }))',
    '  this.callback(null, source, map, meta)',
    '}',
    ''
  ].join('\n'))
  const cssLoader = require.resolve('css-loader')
  const collector = require.resolve('../myloader')
  const compileCss = (withCollector, recordFile) => compile({
    ...project(root, css),
    plugins: withCollector ? [new MyI18nPlugin()] : [],
    module: {
      rules: [{
        test: /\.css$/,
        use: [
          { loader: record, options: { record: recordFile } },
          cssLoader,
          ...(withCollector ? [collector] : [])
        ]
      }]
    }
  })
  const plainFile = path.join(root, 'plain.json')
  const collectedFile = path.join(root, 'collected.json')
  const plain = await compileCss(false, plainFile)
  assert.strictEqual(plain.hasErrors(), false, messages(plain))
  const collected = await compileCss(true, collectedFile)
  assert.strictEqual(collected.hasErrors(), false, messages(collected))
  assert.deepStrictEqual(fs.readFileSync(collectedFile), fs.readFileSync(plainFile))
  const found = readOutput(root).map.entries.find(entry => entry.value === '必填')
  assert.ok(found)
  assert.strictEqual(found.locations[0].kind, 'css-generated-content')
  assert.strictEqual(found.locations[0].path, 'src/app.css')
})

test('vue style output stays unchanged and content keeps original block coordinates', { timeout: 30000 }, async () => {
  const MiniCssExtractPlugin = require('mini-css-extract-plugin')
  const root = fs.mkdtempSync(path.join(__dirname, '.tmp-vue-css-'))
  try {
    fs.mkdirSync(path.join(root, 'src'))
    const source = [
      '<template>',
      '  <p class="badge">收件箱</p>',
      '</template>',
      '<script>',
      'export default { name: "App" }',
      '</script>',
      '<style>',
      '.badge::after {',
      '  content: "（新）";',
      '}',
      '</style>',
      '<style lang="css">',
      '.badge::before { content: "必填"; }',
      '</style>',
      ''
    ].join('\n')
    fs.writeFileSync(path.join(root, 'src/App.vue'), source)
    const collector = require.resolve('../myloader')
    const vueLoader = require.resolve('@vue/vue-loader-v15')
    const cssLoader = require.resolve('css-loader')
    const configFor = withCollector => ({
      ...project(root, path.join(root, 'src/App.vue')),
      plugins: [
        new VueLoaderPlugin(),
        new MiniCssExtractPlugin({ filename: 'app.css' }),
        ...(withCollector ? [new MyI18nPlugin()] : [])
      ],
      module: {
        rules: [
          { test: /\.vue$/, loader: vueLoader },
          {
            resourceQuery: /type=style/,
            use: [
              MiniCssExtractPlugin.loader,
              cssLoader,
              ...(withCollector ? [collector] : [])
            ]
          }
        ]
      }
    })
    const stylesheet = file => fs.readFileSync(file, 'utf8').replace(/\/\*![\s\S]*?\*\//g, '').trim()
    const cssFiles = () => fs.readdirSync(path.join(root, 'dist')).filter(name => name.endsWith('.css')).sort()
    const plain = await compile(configFor(false))
    assert.strictEqual(plain.hasErrors(), false, messages(plain))
    const plainCss = cssFiles().map(name => stylesheet(path.join(root, 'dist', name)))
    const collected = await compile(configFor(true))
    assert.strictEqual(collected.hasErrors(), false, messages(collected))
    const collectedCss = cssFiles().map(name => stylesheet(path.join(root, 'dist', name)))
    assert.deepStrictEqual(collectedCss, plainCss)
    assert.ok(collectedCss.some(file => file.includes('content: "（新）"') && file.includes('content: "必填"')))
    const map = readOutput(root).map
    const fresh = map.entries.find(entry => entry.value === '（新）')
    const required = map.entries.find(entry => entry.value === '必填')
    assert.ok(fresh)
    assert.ok(required)
    assert.strictEqual(fresh.locations[0].kind, 'css-generated-content')
    assert.strictEqual(required.locations[0].kind, 'css-generated-content')
    const freshLine = source.split('\n')[fresh.locations[0].start.line - 1]
    const requiredLine = source.split('\n')[required.locations[0].start.line - 1]
    assert.strictEqual(freshLine.slice(fresh.locations[0].start.column, fresh.locations[0].end.column), '（新）')
    assert.strictEqual(requiredLine.slice(required.locations[0].start.column, required.locations[0].end.column), '必填')
    assert.notStrictEqual(fresh.locations[0].start.line, required.locations[0].start.line)
    const identities = snapshotIdentities(collected)
    assert.ok(identities.includes('src/App.vue::style[index=0;lang=css]'))
    assert.ok(identities.includes('src/App.vue::style[index=1;lang=css]'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
