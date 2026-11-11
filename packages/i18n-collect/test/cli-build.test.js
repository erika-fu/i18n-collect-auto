const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { installVue2 } = require('./vue2-fixture')
const { installVue3 } = require('./vue3-fixture')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')
const vue3DemoRoot = path.resolve(__dirname, '../../../apps/vue3-demo')
const vueLoaderPath = require.resolve('vue-loader', { paths: [vue3DemoRoot] })
const vueLoaderCompilerPath = require.resolve('vue-loader/dist/compiler', { paths: [vue3DemoRoot] })
const vuePath = require.resolve('vue', { paths: [vue3DemoRoot] })
const vueI18nPath = require.resolve('vue-i18n', { paths: [vue3DemoRoot] })
const compilerSfcPath = require.resolve('@vue/compiler-sfc')
const vue2LoaderPath = require.resolve('@vue/vue-loader-v15')
const vue2Path = require.resolve('vue')
const vue2I18nPath = require.resolve('vue-i18n')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function projectFiles(root) {
  const files = []
  const visit = directory => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name)
      if (fs.statSync(file).isDirectory()) visit(file)
      else files.push(file)
    }
  }
  visit(root)
  return files.sort()
}

function snapshotFiles(root) {
  return new Map(projectFiles(root).map(file => [file, fs.readFileSync(file)]))
}

function assertUnchanged(before, root, ignore = []) {
  const ignored = new Set(ignore.map(file => path.resolve(root, file)))
  const after = snapshotFiles(root)
  for (const [file, contents] of before) {
    if (ignored.has(file) || file.startsWith(path.join(root, 'dist')) || file.startsWith(path.join(root, 'lang'))) {
      continue
    }
    assert.ok(after.has(file), `missing ${file}`)
    assert.deepStrictEqual(after.get(file), contents, `changed ${path.relative(root, file)}`)
  }
}

function writeBuildProject(root, {
  source = 'module.exports = function label() {\n  return "你好"\n}\n',
  files = {},
  entry = './src/app.js',
  configSource = [
    'module.exports = {',
    '  buildReplacement: {',
    '    enabled: true,',
    '    adapter: "js",',
    '    runtimeModule: "src/i18n.js",',
    '    runtimeExport: "t"',
    '  }',
    '}',
    ''
  ].join('\n')
} = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  fs.writeFileSync(path.join(root, 'src/i18n.js'), [
    'function t(key) { return key }',
    'module.exports = { t }',
    ''
  ].join('\n'))
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), configSource)
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: 'development',
  devtool: false,
  entry: ${JSON.stringify(entry)},
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  module: { rules: [{ test: /\\.[cm]?[jt]sx?$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin()]
}
`)
}

test('build help describes the two-phase Build replacement command', () => {
  const result = run(['build', '--help'])
  assert.strictEqual(result.status, 0)
  assert.match(result.stdout, /i18n-collect build/)
  assert.match(result.stdout, /Phase 1/)
  assert.match(result.stdout, /Phase 2/)
  assert.match(result.stdout, /buildReplacement/)
  assert.match(result.stdout, /does not modify|not modified/i)
})

test('build requires buildReplacement to be enabled', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-off-'))
  writeBuildProject(root, { configSource: 'module.exports = {}\n' })
  const result = run(['build', '--json'], root)
  assert.strictEqual(result.status, 1)
  assert.match(result.stderr, /buildReplacement\.enabled/)
})

test('build publishes a stable key into the formal bundle without rewriting source files', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-ok-'))
  writeBuildProject(root)
  const before = snapshotFiles(root)
  const result = run(['build', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(result.stderr, '')
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'build')
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.adapter, 'js')
  assert.ok(report.collection.catalog.keys >= 1)
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), 'utf8'))
  const key = Object.keys(metadata.entries).find(name => metadata.entries[name].source === '你好')
  assert.ok(key)
  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(bundle, new RegExp(key.replace(/\./g, '\\.')))
  assert.doesNotMatch(bundle, /你好/)
  assertUnchanged(before, root)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), before.get(path.join(root, 'src/app.js')).toString())
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/replacements.json')))
})

test('build fails the first phase on a key conflict and does not emit a formal bundle', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-conflict-'))
  writeBuildProject(root, {
    source: 'require("./other")\nmodule.exports = /* i18n-key: shared.title */ "首页"\n',
    files: {
      'src/other.js': 'module.exports = /* i18n-key: shared.title */ "主页"\n'
    }
  })
  const before = snapshotFiles(root)
  const result = run(['build', '--json'], root)
  assert.strictEqual(result.status, 2, result.stderr)
  assert.match(result.stderr, /localization key conflict|collection:/)
  const body = JSON.parse(result.stdout)
  assert.strictEqual(body.ok, false)
  assert.strictEqual(body.command, 'build')
  assert.ok(!fs.existsSync(path.join(root, 'dist/bundle.js')))
  assertUnchanged(before, root)
})

test('build ESM entry injects runtime import into the formal bundle', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-esm-'))
  writeBuildProject(root, {
    source: 'export function label() {\n  return "你好"\n}\n',
    entry: './src/app.js',
    files: {
      'src/i18n.js': 'export function t(key) { return key }\n'
    }
  })
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: 'development',
  devtool: false,
  entry: './src/app.js',
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  module: { rules: [{ test: /\\.js$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin()],
  experiments: { outputModule: false }
}
`)
  const before = snapshotFiles(root)
  const result = run(['build', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), 'utf8'))
  const key = Object.keys(metadata.entries).find(name => metadata.entries[name].source === '你好')
  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(bundle, new RegExp(key.replace(/\./g, '\\.')))
  assertUnchanged(before, root)
})

function writeProxyPackage(root, name, version, entry) {
  const packageRoot = path.join(root, 'node_modules', ...name.split('/'))
  fs.mkdirSync(packageRoot, { recursive: true })
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
    name,
    version,
    main: 'index.js'
  }))
  fs.writeFileSync(
    path.join(packageRoot, 'index.js'),
    `module.exports = require(${JSON.stringify(entry)})\n`
  )
}

function writeVue3BuildProject(root, {
  vueSource = [
    '<template>',
    '  <p title="提示">欢迎</p>',
    '</template>',
    '<script setup>',
    "const tip = '说明'",
    "function greet() { return '你好' }",
    '</script>',
    ''
  ].join('\n')
} = {}) {
  installVue3(root)
  writeProxyPackage(root, 'vue', '3.5.42', vuePath)
  writeProxyPackage(root, 'vue-i18n', '9.14.5', vueI18nPath)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'vue3-build-fixture',
    private: true,
    dependencies: {
      vue: '3.5.42',
      'vue-i18n': '9.14.5'
    }
  }, null, 2))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/Home.vue'), vueSource)
  fs.writeFileSync(path.join(root, 'src/i18n.js'), [
    'export function t(key) { return key }',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'src/main.js'), [
    "import { createApp } from 'vue'",
    "import { createI18n } from 'vue-i18n'",
    "import Home from './Home.vue'",
    'const i18n = createI18n({ legacy: false, locale: "zh", messages: { zh: {} } })',
    'createApp(Home).use(i18n).mount("#app")',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), [
    'module.exports = {',
    '  buildReplacement: {',
    '    enabled: true,',
    '    adapter: "vue3",',
    '    runtimeModule: "src/i18n.js",',
    '    runtimeExport: "t"',
    '  }',
    '}',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const vueLoaderCompiler = require(${JSON.stringify(vueLoaderCompilerPath)})
vueLoaderCompiler.compiler = require(${JSON.stringify(compilerSfcPath)})
const { VueLoaderPlugin } = require(${JSON.stringify(vueLoaderPath)})
const MyI18nPlugin = require(${JSON.stringify(plugin)})
const collector = ${JSON.stringify(loader)}
module.exports = {
  context: __dirname,
  mode: 'development',
  devtool: false,
  entry: './src/main.js',
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  resolve: { extensions: ['.js', '.vue'] },
  module: {
    rules: [
      { test: /\\.vue$/, loader: ${JSON.stringify(vueLoaderPath)} },
      { test: /\\.m?js$/, exclude: /node_modules/, use: [collector] },
      { test: /\\.vue$/, resourceQuery: /type=template/, use: [collector] },
      { test: /\\.vue$/, resourceQuery: /type=script/, use: [collector] }
    ]
  },
  plugins: [new VueLoaderPlugin(), new MyI18nPlugin()]
}
`)
}

test('build fails when Vue 3 runtime integration is missing', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-vue3-runtime-'))
  writeVue3BuildProject(root)
  fs.writeFileSync(path.join(root, 'src/main.js'), "import Home from './Home.vue'\n")
  const before = snapshotFiles(root)
  const result = run(['build', '--json'], root)
  assert.strictEqual(result.status, 1)
  assert.match(result.stderr, /createI18n/)
  assert.match(result.stderr, /does not install dependencies or rewrite application bootstrap/)
  assertUnchanged(before, root)
})

test('build rejects commented or non-call createI18n lookalikes for Vue 3 runtime validation', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-vue3-fake-runtime-'))
  writeVue3BuildProject(root)
  fs.writeFileSync(path.join(root, 'src/main.js'), [
    "import Home from './Home.vue'",
    '// createI18n({})',
    "const createI18n = 'not a call'",
    'export default Home',
    ''
  ].join('\n'))
  const before = snapshotFiles(root)
  const result = run(['build', '--json'], root)
  assert.strictEqual(result.status, 1)
  assert.match(result.stderr, /createI18n/)
  assertUnchanged(before, root)
})

test('build replaces Vue 3 SFC content in memory without rewriting disk sources', { timeout: 120000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-vue3-ok-'))
  writeVue3BuildProject(root)
  const before = snapshotFiles(root)
  const homeBefore = fs.readFileSync(path.join(root, 'src/Home.vue'))
  const result = run(['build', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.adapter, 'vue3')
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), 'utf8'))
  const welcome = Object.keys(metadata.entries).find(name => metadata.entries[name].source === '欢迎')
  const hint = Object.keys(metadata.entries).find(name => metadata.entries[name].source === '提示')
  const tip = Object.keys(metadata.entries).find(name => metadata.entries[name].source === '说明')
  const hello = Object.keys(metadata.entries).find(name => metadata.entries[name].source === '你好')
  assert.ok(welcome, 'expected template text in catalog')
  assert.ok(hint, 'expected template attribute in catalog')
  assert.ok(tip, 'expected script setup text in catalog')
  assert.ok(hello, 'expected script setup function text in catalog')
  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  for (const key of [welcome, hint, tip, hello]) {
    assert.match(bundle, new RegExp(key.replace(/\./g, '\\.')))
  }
  assert.doesNotMatch(bundle, /欢迎/)
  assert.doesNotMatch(bundle, /说明/)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'src/Home.vue')), homeBefore)
  assertUnchanged(before, root)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/replacements.json')))
})

function writeVue2BuildProject(root, {
  vueSource = [
    '<template>',
    '  <p title="提示">欢迎</p>',
    '</template>',
    '<script>',
    'export default {',
    '  methods: {',
    "    greet() { return '你好' }",
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
} = {}) {
  const vueVersion = require('vue/package.json').version
  const vueI18nVersion = require('vue-i18n/package.json').version
  installVue2(root)
  writeProxyPackage(root, 'vue', vueVersion, vue2Path)
  writeProxyPackage(root, 'vue-i18n', vueI18nVersion, vue2I18nPath)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'vue2-build-fixture',
    private: true,
    dependencies: {
      vue: vueVersion,
      'vue-i18n': vueI18nVersion
    }
  }, null, 2))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/Home.vue'), vueSource)
  fs.writeFileSync(path.join(root, 'src/i18n.js'), [
    'export function t(key) { return key }',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'src/main.js'), [
    "import Vue from 'vue'",
    "import VueI18n from 'vue-i18n'",
    "import Home from './Home.vue'",
    'Vue.use(VueI18n)',
    'const i18n = new VueI18n({ locale: "zh", messages: { zh: {} } })',
    'new Vue({ i18n, render: h => h(Home) }).$mount("#app")',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), [
    'module.exports = {',
    '  buildReplacement: {',
    '    enabled: true,',
    '    adapter: "vue2",',
    '    runtimeModule: "src/i18n.js",',
    '    runtimeExport: "t"',
    '  }',
    '}',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const { VueLoaderPlugin } = require(${JSON.stringify(vue2LoaderPath)})
const MyI18nPlugin = require(${JSON.stringify(plugin)})
const collector = ${JSON.stringify(loader)}
module.exports = {
  context: __dirname,
  mode: 'development',
  devtool: false,
  entry: './src/main.js',
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  resolve: {
    extensions: ['.js', '.vue'],
    alias: { vue$: ${JSON.stringify(require.resolve('vue/dist/vue.esm.js'))} }
  },
  module: {
    rules: [
      { test: /\\.vue$/, loader: ${JSON.stringify(vue2LoaderPath)} },
      { test: /\\.m?js$/, exclude: /node_modules/, use: [collector] },
      { test: /\\.vue$/, resourceQuery: /type=template/, use: [collector] },
      { test: /\\.vue$/, resourceQuery: /type=script/, use: [collector] }
    ]
  },
  plugins: [new VueLoaderPlugin(), new MyI18nPlugin()]
}
`)
}

test('build fails when Vue 2 runtime integration is missing', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-vue2-runtime-'))
  writeVue2BuildProject(root)
  fs.writeFileSync(path.join(root, 'src/main.js'), "import Home from './Home.vue'\n")
  const before = snapshotFiles(root)
  const result = run(['build', '--json'], root)
  assert.strictEqual(result.status, 1)
  assert.match(result.stderr, /Vue\.use\(VueI18n\)|new VueI18n/)
  assert.match(result.stderr, /does not install dependencies or rewrite application bootstrap/)
  assertUnchanged(before, root)
})

test('build rejects commented or non-call VueI18n lookalikes for Vue 2 runtime validation', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-vue2-fake-runtime-'))
  writeVue2BuildProject(root)
  fs.writeFileSync(path.join(root, 'src/main.js'), [
    "import Home from './Home.vue'",
    '// Vue.use(VueI18n)',
    '// new VueI18n({})',
    "const VueI18n = 'not a call'",
    'export default Home',
    ''
  ].join('\n'))
  const before = snapshotFiles(root)
  const result = run(['build', '--json'], root)
  assert.strictEqual(result.status, 1)
  assert.match(result.stderr, /Vue\.use\(VueI18n\)|new VueI18n/)
  assertUnchanged(before, root)
})

test('build replaces Vue 2 SFC content in memory without rewriting disk sources', { timeout: 120000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-vue2-ok-'))
  writeVue2BuildProject(root)
  const before = snapshotFiles(root)
  const homeBefore = fs.readFileSync(path.join(root, 'src/Home.vue'))
  const result = run(['build', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.adapter, 'vue2')
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), 'utf8'))
  const welcome = Object.keys(metadata.entries).find(name => metadata.entries[name].source === '欢迎')
  const hint = Object.keys(metadata.entries).find(name => metadata.entries[name].source === '提示')
  const hello = Object.keys(metadata.entries).find(name => metadata.entries[name].source === '你好')
  assert.ok(welcome, 'expected template text in catalog')
  assert.ok(hint, 'expected template attribute in catalog')
  assert.ok(hello, 'expected Options API method text in catalog')
  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  for (const key of [welcome, hint, hello]) {
    assert.match(bundle, new RegExp(key.replace(/\./g, '\\.')))
  }
  assert.doesNotMatch(bundle, /欢迎/)
  assert.doesNotMatch(bundle, /你好/)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'src/Home.vue')), homeBefore)
  assertUnchanged(before, root)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/replacements.json')))
})
