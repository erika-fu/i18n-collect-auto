const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const test = require('node:test')
const { demoLocaleMessages } = require('../../../apps/demo/src/lang/resolve')
const {
  assertSourcesUnchanged,
  leftoverArtifacts,
  snapshotSources
} = require('./source-snapshot')
const {
  assertLangUnchanged,
  keyForSource,
  seedSourceCatalog,
  snapshotLangTree
} = require('./build-test-helpers')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const vue2Root = path.resolve(__dirname, '../../../apps/demo')
const vue3Root = path.resolve(__dirname, '../../../apps/vue3-demo')
const SOURCE_OPTIONS = {
  skipNames: ['node_modules', 'dist', 'lang'],
  extensions: /\.(vue|js|jsx|css|html)$/
}

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

function snapshotDemoSources(root) {
  const files = []
  const visit = directory => {
    if (!fs.existsSync(directory)) return
    for (const name of fs.readdirSync(directory)) {
      if (SOURCE_OPTIONS.skipNames.includes(name)) continue
      const file = path.join(directory, name)
      if (fs.statSync(file).isDirectory()) visit(file)
      else if (SOURCE_OPTIONS.extensions.test(name)) files.push(file)
    }
  }
  visit(path.join(root, 'src'))
  visit(path.join(root, 'public'))
  const selected = new Map()
  for (const file of files.sort()) {
    const stat = fs.statSync(file)
    selected.set(file, { content: fs.readFileSync(file), mtimeMs: stat.mtimeMs })
  }
  return selected
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

function scrubBuildLeftovers(root) {
  for (const name of leftoverArtifacts(root)) {
    fs.rmSync(name, { recursive: true, force: true })
  }
}

test('Vue 2 demo package scripts expose collect, build, replace, and serial watch Build replacement', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(vue2Root, 'package.json'), 'utf8'))
  assert.match(pkg.scripts.collect, /i18n-collect(?:\.js)? collect/)
  assert.match(pkg.scripts.build, /i18n-collect(?:\.js)? build/)
  assert.match(pkg.scripts.watch || '', /i18n-collect(?:\.js)? build --watch/)
  assert.match(pkg.scripts.replace || '', /replace --adapter vue2/)
  const config = require(path.join(vue2Root, 'i18n-collect.config.js'))
  assert.strictEqual(config.buildReplacement.enabled, true)
  assert.strictEqual(config.buildReplacement.adapter, 'vue2')
  assert.ok(config.buildReplacement.runtimeModule)
})

test('Vue 3 demo package scripts expose collect, build, replace, and serial watch Build replacement', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(vue3Root, 'package.json'), 'utf8'))
  assert.match(pkg.scripts.collect, /i18n-collect(?:\.js)? collect/)
  assert.match(pkg.scripts.build, /i18n-collect(?:\.js)? build/)
  assert.match(pkg.scripts.watch || '', /i18n-collect(?:\.js)? build --watch/)
  assert.match(pkg.scripts.replace || '', /replace --adapter vue3/)
  const config = require(path.join(vue3Root, 'i18n-collect.config.js'))
  assert.strictEqual(config.buildReplacement.enabled, true)
  assert.strictEqual(config.buildReplacement.adapter, 'vue3')
})

test('Vue 2 demo Build replacement keeps disk Chinese and localizes the formal bundle', { timeout: 300000 }, () => {
  scrubBuildLeftovers(vue2Root)
  seedSourceCatalog(vue2Root, { writeLegacyArtifacts: false })
  const before = snapshotDemoSources(vue2Root)
  const langBefore = snapshotLangTree(vue2Root)
  const home = path.join(vue2Root, 'src/pages/HomePage.vue')
  const homeSource = before.get(home).content.toString('utf8')
  assert.match(homeSource, /插值/)
  const result = run(['build', '--json'], vue2Root)
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
  const report = parseJsonReport(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.adapter, 'vue2')
  assert.strictEqual(fs.readFileSync(home, 'utf8'), homeSource)
  assertSourcesUnchanged(before, vue2Root)
  assertLangUnchanged(langBefore, vue2Root)
  assert.deepStrictEqual(leftoverArtifacts(vue2Root), [])
  assert.ok(!fs.existsSync(path.join(vue2Root, 'lang/catalog/replacements.json')))
  const titleKey = keyForSource(vue2Root, '插值')
  const bundle = fs.readFileSync(findBundle(vue2Root), 'utf8')
  assert.match(bundle, new RegExp(titleKey.replace(/\./g, '\\.')))
  const { sourceCatalogMessages } = require('../mycommon/source-catalog-freshness')
  const sourceCatalog = sourceCatalogMessages(
    JSON.parse(fs.readFileSync(path.join(vue2Root, 'lang/catalog/source-catalog.json'), 'utf8'))
  )
  assert.strictEqual(sourceCatalog['demo.build.title'], '构建替换演示')
  assert.match(bundle, /demo\.build\.title/)
})

test('Vue 3 demo Build replacement keeps disk Chinese and localizes the formal bundle', { timeout: 300000 }, () => {
  scrubBuildLeftovers(vue3Root)
  seedSourceCatalog(vue3Root, { writeLegacyArtifacts: false })
  const before = snapshotDemoSources(vue3Root)
  const langBefore = snapshotLangTree(vue3Root)
  const app = path.join(vue3Root, 'src/App.vue')
  const appSource = before.get(app).content.toString('utf8')
  assert.match(appSource, /原生 Vue 三模板/)
  const result = run(['build', '--json'], vue3Root)
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
  const report = parseJsonReport(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.adapter, 'vue3')
  assert.strictEqual(fs.readFileSync(app, 'utf8'), appSource)
  assertSourcesUnchanged(before, vue3Root)
  assertLangUnchanged(langBefore, vue3Root)
  assert.deepStrictEqual(leftoverArtifacts(vue3Root), [])
  assert.ok(!fs.existsSync(path.join(vue3Root, 'lang/catalog/replacements.json')))
  const { sourceCatalogMessages } = require('../mycommon/source-catalog-freshness')
  const sourceCatalog = sourceCatalogMessages(
    JSON.parse(fs.readFileSync(path.join(vue3Root, 'lang/catalog/source-catalog.json'), 'utf8'))
  )
  assert.strictEqual(sourceCatalog['vue3.heading'], '原生 Vue 三模板')
  const bundle = fs.readFileSync(findBundle(vue3Root), 'utf8')
  assert.match(bundle, /vue3\.heading/)
  // Catalog JSON is bundled for runtime lookup, so Chinese source text may still
  // appear there. The disk SFC stays Chinese while the call site uses the key.
  assert.match(appSource, /原生 Vue 三模板/)
})

test('Vue demo rebuild leaves business sources and formal outputs byte-stable', { timeout: 600000 }, () => {
  for (const root of [vue2Root, vue3Root]) {
    scrubBuildLeftovers(root)
    seedSourceCatalog(root, { writeLegacyArtifacts: false })
    const sourcesBefore = snapshotDemoSources(root)
    const langBefore = snapshotLangTree(root)
    const first = run(['build', '--json'], root)
    assert.strictEqual(first.status, 0, first.stderr || first.stdout)
    assertSourcesUnchanged(sourcesBefore, root)
    assertLangUnchanged(langBefore, root)
    const formalAfterFirst = snapshotSources(path.join(root, 'lang'), { skipNames: ['node_modules'] })
    const second = run(['build', '--json'], root)
    assert.strictEqual(second.status, 0, second.stderr || second.stdout)
    assertSourcesUnchanged(sourcesBefore, root)
    assertLangUnchanged(langBefore, root)
    for (const [file, entry] of formalAfterFirst) {
      assert.deepStrictEqual(
        fs.readFileSync(file),
        entry.content,
        `formal output changed on rebuild ${path.relative(root, file)}`
      )
    }
    assert.deepStrictEqual(leftoverArtifacts(root), [])
  }
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
