const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const test = require('node:test')
const { demoLocaleMessages } = require('../../../apps/demo/src/lang/resolve')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const vue2Root = path.resolve(__dirname, '../../../apps/demo')
const vue3Root = path.resolve(__dirname, '../../../apps/vue3-demo')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', NODE_ENV: 'production', VUE_CLI_TEST: 'true' },
    timeout: 300000
  })
}

function parseJsonReport(stdout) {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  assert.ok(start >= 0 && end > start, `expected JSON report in stdout:\n${stdout}`)
  return JSON.parse(stdout.slice(start, end + 1))
}

function listSourceFiles(root) {
  const files = []
  const visit = directory => {
    for (const name of fs.readdirSync(directory)) {
      if (name === 'node_modules' || name === 'dist' || name === 'lang') continue
      const file = path.join(directory, name)
      if (fs.statSync(file).isDirectory()) visit(file)
      else if (/\.(vue|js|jsx|css|html)$/.test(name)) files.push(file)
    }
  }
  visit(path.join(root, 'src'))
  if (fs.existsSync(path.join(root, 'public'))) visit(path.join(root, 'public'))
  return files.sort()
}

function snapshotSources(root) {
  return new Map(listSourceFiles(root).map(file => [file, fs.readFileSync(file)]))
}

function assertSourcesUnchanged(before, root) {
  const after = snapshotSources(root)
  assert.strictEqual(after.size, before.size)
  for (const [file, contents] of before) {
    assert.ok(after.has(file), `missing ${path.relative(root, file)}`)
    assert.deepStrictEqual(after.get(file), contents, `changed ${path.relative(root, file)}`)
  }
}

function findBundle(root) {
  const dist = path.join(root, 'dist')
  assert.ok(fs.existsSync(dist), 'expected dist output')
  const stack = [dist]
  while (stack.length) {
    const directory = stack.pop()
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name)
      if (fs.statSync(file).isDirectory()) stack.push(file)
      else if (/\.js$/.test(name) && !name.endsWith('.map')) return file
    }
  }
  throw new Error('formal bundle js not found')
}

test('Vue 2 demo package scripts expose two-phase build and serial watch Build replacement', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(vue2Root, 'package.json'), 'utf8'))
  assert.match(pkg.scripts.build, /i18n-collect(?:\.js)? build/)
  assert.match(pkg.scripts.watch || '', /i18n-collect(?:\.js)? build --watch/)
  const config = require(path.join(vue2Root, 'i18n-collect.config.js'))
  assert.strictEqual(config.buildReplacement.enabled, true)
  assert.strictEqual(config.buildReplacement.adapter, 'vue2')
  assert.ok(config.buildReplacement.runtimeModule)
})

test('Vue 3 demo package scripts expose two-phase build and serial watch Build replacement', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(vue3Root, 'package.json'), 'utf8'))
  assert.match(pkg.scripts.build, /i18n-collect(?:\.js)? build/)
  assert.match(pkg.scripts.watch || '', /i18n-collect(?:\.js)? build --watch/)
  const config = require(path.join(vue3Root, 'i18n-collect.config.js'))
  assert.strictEqual(config.buildReplacement.enabled, true)
  assert.strictEqual(config.buildReplacement.adapter, 'vue3')
})

test('Vue 2 demo Build replacement keeps disk Chinese and localizes the formal bundle', { timeout: 300000 }, () => {
  const before = snapshotSources(vue2Root)
  const home = path.join(vue2Root, 'src/pages/HomePage.vue')
  const homeSource = fs.readFileSync(home, 'utf8')
  assert.match(homeSource, /插值/)
  const result = run(['build', '--json'], vue2Root)
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
  const report = parseJsonReport(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.adapter, 'vue2')
  assert.strictEqual(fs.readFileSync(home, 'utf8'), homeSource)
  assertSourcesUnchanged(before, vue2Root)
  assert.ok(!fs.existsSync(path.join(vue2Root, 'lang/catalog/replacements.json')))
  const metadata = JSON.parse(fs.readFileSync(path.join(vue2Root, 'lang/catalog/catalog.meta.json'), 'utf8'))
  const titleKey = Object.keys(metadata.entries).find(key => metadata.entries[key].source === '插值')
  assert.ok(titleKey, 'expected HomePage title in catalog')
  const bundle = fs.readFileSync(findBundle(vue2Root), 'utf8')
  assert.match(bundle, new RegExp(titleKey.replace(/\./g, '\\.')))
  const buildTitle = metadata.entries['demo.build.title']
  assert.ok(buildTitle, 'expected demo.build.title')
  assert.match(bundle, /demo\.build\.title/)
})

test('Vue 3 demo Build replacement keeps disk Chinese and localizes the formal bundle', { timeout: 300000 }, () => {
  const before = snapshotSources(vue3Root)
  const app = path.join(vue3Root, 'src/App.vue')
  const appSource = fs.readFileSync(app, 'utf8')
  assert.match(appSource, /原生 Vue 三模板/)
  const result = run(['build', '--json'], vue3Root)
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
  const report = parseJsonReport(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.adapter, 'vue3')
  assert.strictEqual(fs.readFileSync(app, 'utf8'), appSource)
  assertSourcesUnchanged(before, vue3Root)
  assert.ok(!fs.existsSync(path.join(vue3Root, 'lang/catalog/replacements.json')))
  const metadata = JSON.parse(fs.readFileSync(path.join(vue3Root, 'lang/catalog/catalog.meta.json'), 'utf8'))
  assert.strictEqual(metadata.entries['vue3.heading'].source, '原生 Vue 三模板')
  const bundle = fs.readFileSync(findBundle(vue3Root), 'utf8')
  assert.match(bundle, /vue3\.heading/)
  // Catalog JSON is bundled for runtime lookup, so Chinese source text may still
  // appear there. The disk SFC stays Chinese while the call site uses the key.
  assert.match(appSource, /原生 Vue 三模板/)
})

test('Vue demos combine Build replacement keys with runtime catalog locale switching', () => {
  const vue2Zh = require('../../../apps/demo/lang/catalog/zh.json')
  const vue2En = require('../../../apps/demo/lang/catalog/en.json')
  const hash = require('../../../apps/demo/lang/zh_hash.json')
  assert.strictEqual(vue2Zh['demo.build.title'], '构建替换演示')
  assert.strictEqual(vue2En['demo.build.title'], 'Build replacement demo')
  const Vue = require('vue')
  const VueI18n = require('vue-i18n')
  Vue.use(VueI18n)
  const i18n = new VueI18n({
    locale: 'zh',
    messages: {
      zh: demoLocaleMessages(vue2Zh, hash),
      en: demoLocaleMessages(vue2En, hash)
    }
  })
  assert.strictEqual(i18n.t('demo.build.title'), '构建替换演示')
  i18n.locale = 'en'
  assert.strictEqual(i18n.t('demo.build.title'), 'Build replacement demo')

  const vue3Zh = require('../../../apps/vue3-demo/lang/catalog/zh.json')
  const vue3En = require('../../../apps/vue3-demo/lang/catalog/en.json')
  assert.strictEqual(vue3Zh['vue3.build.title'], '构建替换演示')
  assert.strictEqual(vue3En['vue3.build.title'], 'Build replacement demo')
  assert.strictEqual(vue3Zh['vue3.heading'], '原生 Vue 三模板')
  assert.strictEqual(vue3En['vue3.heading'], 'Native Vue 3 template')
})

test('React demo documents that JSX Build replacement is out of scope for v1', () => {
  const readme = fs.readFileSync(path.resolve(__dirname, '../../../README.md'), 'utf8')
  const reactReadme = fs.existsSync(path.resolve(__dirname, '../../../apps/react-demo/README.md'))
    ? fs.readFileSync(path.resolve(__dirname, '../../../apps/react-demo/README.md'), 'utf8')
    : ''
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../apps/react-demo/package.json'), 'utf8'))
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /i18n-collect build/)
  assert.match(readme + reactReadme, /React JSX[\s\S]*Build replacement|Build replacement[\s\S]*React JSX/i)
  assert.match(readme + reactReadme, /not supported|outside|out of scope|第一版不支持/i)
})
