const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { demoLocaleMessages, resolveDemoMessage } = require('../../../apps/demo/src/lang/resolve')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')
const fixture = path.join(__dirname, '../../../apps/demo/fixtures/keyed-migration')
const demoLang = path.join(__dirname, '../../../apps/demo/lang')

const WELCOME = '欢迎'
const WAIT = '请稍候'
const SHARED = '共享标题'
const WELCOME_MD5 = '47781b8a72bcbb7ecb1f955399a7e718'
const AUTO_KEY = /^auto\.[0-9A-HJKMNP-TV-Z]{26}$/

test('the committed demo catalogs resolve the stable key lifecycle page', () => {
  const zh = require('../../../apps/demo/lang/catalog/zh.json')
  const en = require('../../../apps/demo/lang/catalog/en.json')
  const hashDictionary = require('../../../apps/demo/lang/zh_hash.json')
  const meta = require('../../../apps/demo/lang/catalog/catalog.meta.json')

  assert.strictEqual(meta.version, 3)
  assert.strictEqual(zh['demo.visit.banner'], WELCOME)
  assert.strictEqual(zh['demo.visit.farewell'], WELCOME)
  assert.strictEqual(zh['demo.shared.title'], SHARED)
  assert.strictEqual(zh['demo.items.deleted'], '已删除 {count} 项')
  assert.strictEqual(zh['demo.terms.notice'], '请阅读我们的{terms}与{privacy}')
  assert.strictEqual(zh['demo.terms.link'], '服务条款')
  assert.strictEqual(zh['demo.privacy.link'], '隐私政策')
  assert.strictEqual(meta.entries['demo.visit.banner'].origin, 'explicit')
  assert.strictEqual(meta.entries['demo.visit.farewell'].origin, 'explicit')
  assert.strictEqual(meta.entries['demo.shared.title'].origin, 'explicit')
  assert.strictEqual(meta.entries['demo.items.deleted'].origin, 'explicit')
  assert.strictEqual(meta.entries['demo.terms.notice'].origin, 'explicit')
  assert.strictEqual(meta.entries['demo.terms.link'].origin, 'explicit')
  assert.strictEqual(meta.entries['demo.privacy.link'].origin, 'explicit')
  assert.strictEqual(meta.entries['demo.items.deleted'].representation, 'localized-call')
  assert.strictEqual(meta.entries['demo.terms.notice'].representation, 'localized-call')
  assert.deepStrictEqual(
    meta.entries['demo.items.deleted'].occurrences.map(item => item.representation),
    ['localized-call']
  )
  assert.deepStrictEqual(
    meta.entries['demo.visit.banner'].occurrences.map(item => item.representation).sort(),
    ['localized-call', 'source-text']
  )
  assert.deepStrictEqual(
    meta.entries['demo.shared.title'].occurrences.map(item => item.representation).sort(),
    ['localized-call', 'source-text']
  )

  const waitKeys = automaticKeysFor(zh, WAIT)
  assert.strictEqual(waitKeys.length, 2)
  assert.strictEqual(meta.entries[waitKeys[0]].origin, 'derived')
  assert.strictEqual(meta.entries[waitKeys[1]].origin, 'derived')
  assert.strictEqual(en['demo.visit.banner'], 'Welcome aboard')
  assert.strictEqual(en['demo.visit.farewell'], 'Welcome back')
  assert.strictEqual(en['demo.shared.title'], 'Shared title')
  assert.strictEqual(en['demo.items.deleted'], 'Deleted {count} items')
  assert.strictEqual(en['demo.terms.notice'], 'Please read our {terms} and {privacy}')
  assert.strictEqual(en['demo.terms.link'], 'Terms of Service')
  assert.strictEqual(en['demo.privacy.link'], 'Privacy Policy')
  assert.strictEqual(en[waitKeys[0]], 'Please wait')
  assert.strictEqual(en[waitKeys[1]], 'Please wait')

  const messages = demoLocaleMessages(en, hashDictionary)
  assert.strictEqual(resolveDemoMessage('demo.visit.banner', en, hashDictionary), 'Welcome aboard')
  assert.strictEqual(resolveDemoMessage('demo.shared.title', en, hashDictionary), 'Shared title')
  assert.strictEqual(resolveDemoMessage('demo.items.deleted', en, hashDictionary), 'Deleted {count} items')
  assert.strictEqual(resolveDemoMessage('demo.terms.notice', en, hashDictionary), 'Please read our {terms} and {privacy}')
  assert.strictEqual(resolveDemoMessage(waitKeys[0], en, hashDictionary), 'Please wait')
  assert.strictEqual(resolveDemoMessage(WELCOME_MD5, en, hashDictionary), WELCOME)
  assert.strictEqual(messages[WELCOME_MD5], WELCOME)

  const Vue = require('vue')
  const VueI18n = require('vue-i18n')
  Vue.use(VueI18n)
  const vm = new Vue({
    i18n: new VueI18n({
      locale: 'en',
      messages: { en: messages, zh: demoLocaleMessages(zh, hashDictionary) }
    })
  })
  assert.strictEqual(vm.$t('demo.visit.banner'), 'Welcome aboard')
  assert.strictEqual(vm.$t('demo.visit.farewell'), 'Welcome back')
  assert.strictEqual(vm.$t('demo.shared.title'), 'Shared title')
  assert.strictEqual(vm.$t('demo.items.deleted', { count: 3 }), 'Deleted 3 items')
  assert.strictEqual(
    vm.$t('demo.terms.notice', {
      terms: vm.$t('demo.terms.link'),
      privacy: vm.$t('demo.privacy.link')
    }),
    'Please read our Terms of Service and Privacy Policy'
  )
  assert.strictEqual(vm.$t(waitKeys[0]), 'Please wait')
  assert.strictEqual(vm.$t(waitKeys[1]), 'Please wait')
  assert.strictEqual(vm.$t(WELCOME_MD5), WELCOME)
  vm.$destroy()
})

test('the demo runtime prefers a keyed catalog and falls back to the MD5 dictionary', () => {
  const hashDictionary = { [WELCOME_MD5]: WELCOME, overlap: '哈希词条' }
  const catalog = {
    'demo.visit.banner': 'Welcome aboard',
    'demo.visit.farewell': 'Welcome back',
    'demo.shared.title': 'Shared title',
    overlap: '目录译文'
  }

  assert.strictEqual(resolveDemoMessage('demo.visit.banner', catalog, hashDictionary), 'Welcome aboard')
  assert.strictEqual(resolveDemoMessage('demo.visit.farewell', catalog, hashDictionary), 'Welcome back')
  assert.strictEqual(resolveDemoMessage('demo.shared.title', catalog, hashDictionary), 'Shared title')
  assert.notStrictEqual(
    resolveDemoMessage('demo.visit.banner', catalog, hashDictionary),
    resolveDemoMessage('demo.visit.farewell', catalog, hashDictionary)
  )
  assert.strictEqual(resolveDemoMessage('overlap', catalog, hashDictionary), '目录译文')
  assert.strictEqual(resolveDemoMessage(WELCOME_MD5, catalog, hashDictionary), WELCOME)
  assert.strictEqual(resolveDemoMessage('demo.visit.banner', { 'demo.visit.banner': '' }, hashDictionary), '')
  assert.strictEqual(resolveDemoMessage('missing', catalog, hashDictionary), undefined)

  const messages = demoLocaleMessages(catalog, hashDictionary)
  assert.strictEqual(messages['demo.visit.banner'], 'Welcome aboard')
  assert.strictEqual(messages['demo.visit.farewell'], 'Welcome back')
  assert.strictEqual(messages['demo.shared.title'], 'Shared title')
  assert.strictEqual(messages.overlap, '目录译文')
  assert.strictEqual(messages[WELCOME_MD5], WELCOME)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(messages, 'missing'), false)
})

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function copyFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-demo-runtime-'))
  fs.cpSync(fixture, root, { recursive: true })
  return root
}

function writeWebpack(root) {
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: 'development',
  entry: './src/app.js',
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  module: { rules: [{ test: /\\.js$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin()]
}
`)
}

function readJson(root, name) {
  return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))
}

function snapshotDemoLang() {
  const files = [
    'zh_hash.json',
    'zh_hash.map.json',
    'catalog/zh.json',
    'catalog/en.json',
    'catalog/catalog.meta.json'
  ]
  return Object.fromEntries(files.map(file => {
    const full = path.join(demoLang, file)
    return [file, fs.existsSync(full) ? fs.readFileSync(full) : null]
  }))
}

function assertDemoLangUnchanged(before) {
  const after = snapshotDemoLang()
  for (const file of Object.keys(before)) {
    assert.deepStrictEqual(after[file], before[file], `committed demo lang changed: ${file}`)
  }
}

function automaticKeysFor(catalog, source) {
  return Object.keys(catalog).filter(key => catalog[key] === source && AUTO_KEY.test(key)).sort()
}

const APP_BEFORE = [
  "const { t } = require('./i18n')",
  "const banner = /* i18n-key: demo.visit.banner */ '欢迎'",
  "const farewell = /* i18n-key: demo.visit.farewell */ '欢迎'",
  "const waitA = '请稍候'",
  "const waitB = '请稍候'",
  "const sharedSource = /* i18n-key: demo.shared.title */ '共享标题'",
  "const sharedCall = t('demo.shared.title')",
  "const bannerCall = t('demo.visit.banner')",
  `const legacy = t('${WELCOME_MD5}')`,
  'module.exports = { banner, farewell, waitA, waitB, sharedSource, sharedCall, bannerCall, legacy }',
  ''
].join('\n')

test('collect, translate, and replace let equal source text use different demo translations', { timeout: 60000 }, () => {
  const beforeDemoLang = snapshotDemoLang()
  const root = copyFixture()
  writeWebpack(root)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), APP_BEFORE)
  assert.strictEqual(fs.readFileSync(path.join(root, 'i18n/provider.js'), 'utf8').includes('network'), false)

  const collected = run(['collect', '--json'], root)
  assert.strictEqual(collected.status, 0, collected.stderr)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), APP_BEFORE)
  const sourceCatalog = readJson(root, 'lang/catalog/zh.json')
  assert.strictEqual(sourceCatalog['demo.visit.banner'], WELCOME)
  assert.strictEqual(sourceCatalog['demo.visit.farewell'], WELCOME)
  assert.strictEqual(sourceCatalog['demo.shared.title'], SHARED)
  const waitKeys = automaticKeysFor(sourceCatalog, WAIT)
  assert.strictEqual(waitKeys.length, 2, 'equal source text gets independent automatic keys')
  const dictionary = readJson(root, 'lang/zh_hash.json')
  assert.strictEqual(dictionary[WELCOME_MD5], WELCOME)
  assert.strictEqual(Object.values(dictionary).filter(value => value === WELCOME).length, 1)

  const metadata = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(metadata.version, 3)
  assert.strictEqual(metadata.entries['demo.visit.banner'].origin, 'explicit')
  assert.strictEqual(metadata.entries['demo.shared.title'].representation, 'source-text')
  const sharedRepresentations = metadata.entries['demo.shared.title'].occurrences
    .map(item => item.representation)
    .sort()
  assert.deepStrictEqual(sharedRepresentations, ['localized-call', 'source-text'])
  assert.ok(
    metadata.entries['demo.visit.banner'].occurrences.some(item => item.representation === 'localized-call'),
    'banner keeps a runtime localization call occurrence'
  )
  assert.strictEqual(metadata.entries[waitKeys[0]].origin, 'derived')
  assert.strictEqual(metadata.entries[waitKeys[1]].origin, 'derived')
  assert.notStrictEqual(waitKeys[0], waitKeys[1])

  const translated = run(['translate', '--json'], root)
  assert.strictEqual(translated.status, 0, translated.stderr)
  const english = readJson(root, 'lang/catalog/en.json')
  assert.strictEqual(english['demo.visit.banner'], 'Welcome aboard')
  assert.strictEqual(english['demo.visit.farewell'], 'Welcome back')
  assert.strictEqual(english['demo.shared.title'], 'Shared title')
  assert.strictEqual(english[waitKeys[0]], 'Please wait')
  assert.strictEqual(english[waitKeys[1]], 'Please wait')

  const written = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  const replaced = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8')
  assert.match(replaced, /t\('demo\.visit\.banner'\)/)
  assert.match(replaced, /t\('demo\.visit\.farewell'\)/)
  assert.match(replaced, /t\('demo\.shared\.title'\)/)
  assert.match(replaced, new RegExp(`t\\('${waitKeys[0]}'\\)`))
  assert.match(replaced, new RegExp(`t\\('${waitKeys[1]}'\\)`))
  assert.match(replaced, new RegExp(`t\\('${WELCOME_MD5}'\\)`))
  assert.strictEqual(readJson(root, 'lang/zh_hash.json')[WELCOME_MD5], WELCOME)

  const hashDictionary = readJson(root, 'lang/zh_hash.json')
  assert.strictEqual(resolveDemoMessage('demo.visit.banner', english, hashDictionary), 'Welcome aboard')
  assert.strictEqual(resolveDemoMessage('demo.visit.farewell', english, hashDictionary), 'Welcome back')
  assert.strictEqual(resolveDemoMessage('demo.shared.title', english, hashDictionary), 'Shared title')
  assert.strictEqual(resolveDemoMessage(waitKeys[0], english, hashDictionary), 'Please wait')
  assert.strictEqual(resolveDemoMessage(WELCOME_MD5, english, hashDictionary), WELCOME)
  const messages = demoLocaleMessages(english, hashDictionary)
  assert.strictEqual(messages['demo.visit.banner'], 'Welcome aboard')
  assert.strictEqual(messages['demo.visit.farewell'], 'Welcome back')
  assert.strictEqual(messages['demo.shared.title'], 'Shared title')
  assert.strictEqual(messages[WELCOME_MD5], WELCOME)

  const Vue = require('vue')
  const VueI18n = require('vue-i18n')
  Vue.use(VueI18n)
  const vm = new Vue({
    i18n: new VueI18n({
      locale: 'en',
      messages: { en: messages }
    })
  })
  assert.strictEqual(vm.$t('demo.visit.banner'), 'Welcome aboard')
  assert.strictEqual(vm.$t('demo.visit.farewell'), 'Welcome back')
  assert.strictEqual(vm.$t('demo.shared.title'), 'Shared title')
  assert.strictEqual(vm.$t(waitKeys[0]), 'Please wait')
  assert.strictEqual(vm.$t(waitKeys[1]), 'Please wait')
  assert.strictEqual(vm.$t(WELCOME_MD5), WELCOME)
  vm.$destroy()
  assertDemoLangUnchanged(beforeDemoLang)
})

test('demo fixture keeps keys after ordinary moves without replace and marks review after source change', { timeout: 60000 }, () => {
  const beforeDemoLang = snapshotDemoLang()
  const root = copyFixture()
  writeWebpack(root)

  assert.strictEqual(run(['collect', '--json'], root).status, 0)
  assert.strictEqual(run(['translate', '--json'], root).status, 0)
  const waitKeys = automaticKeysFor(readJson(root, 'lang/catalog/zh.json'), WAIT)
  assert.strictEqual(waitKeys.length, 2)
  const bannerFingerprint = readJson(root, 'lang/catalog/catalog.meta.json').entries['demo.visit.banner'].fingerprint

  const replaced = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(replaced.status, 0, replaced.stderr)
  const afterReplace = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8')

  fs.writeFileSync(path.join(root, 'src/app.js'), [
    "const { t } = require('./i18n')",
    'module.exports = require("./moved")',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'src/moved.js'), afterReplace)

  const moved = run(['collect', '--json'], root)
  assert.strictEqual(moved.status, 0, moved.stderr)
  const movedReport = JSON.parse(moved.stdout).catalog
  assert.deepStrictEqual(movedReport.added, [])
  assert.deepStrictEqual(movedReport.changed, [])
  assert.deepStrictEqual(movedReport.removed, [])
  const movedCatalog = readJson(root, 'lang/catalog/zh.json')
  assert.strictEqual(movedCatalog['demo.visit.banner'], WELCOME)
  assert.strictEqual(movedCatalog['demo.shared.title'], SHARED)
  assert.deepStrictEqual(automaticKeysFor(movedCatalog, WAIT), waitKeys)
  const movedMeta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(movedMeta.entries['demo.visit.banner'].fingerprint, bannerFingerprint)
  assert.ok(
    movedMeta.entries['demo.visit.banner'].occurrences.every(item => item.representation === 'localized-call'),
    'replaced banner occurrences stay localized-call after the move'
  )
  assert.ok(
    movedMeta.entries['demo.shared.title'].occurrences.every(item => item.representation === 'localized-call')
  )

  fs.writeFileSync(path.join(root, 'src/moved.js'), afterReplace
    .replace("/* i18n-key: demo.shared.title */ t('demo.shared.title')", "/* i18n-key: demo.shared.title */ '共享标题已改'")
  )
  // Keep one localized-call for the shared key so source-text and call can coexist again.
  if (!fs.readFileSync(path.join(root, 'src/moved.js'), 'utf8').includes("t('demo.shared.title')")) {
    fs.appendFileSync(
      path.join(root, 'src/moved.js'),
      "const sharedCallAgain = t('demo.shared.title')\nmodule.exports.sharedCallAgain = sharedCallAgain\n"
    )
  }

  const changed = run(['collect', '--json'], root)
  assert.strictEqual(changed.status, 0, changed.stderr)
  const changedMeta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(changedMeta.entries['demo.shared.title'].source, '共享标题已改')
  assert.notStrictEqual(changedMeta.entries['demo.shared.title'].fingerprint, movedMeta.entries['demo.shared.title'].fingerprint)
  const sharedAfterChange = changedMeta.entries['demo.shared.title'].occurrences
    .map(item => item.representation)
    .sort()
  assert.deepStrictEqual(sharedAfterChange, ['localized-call', 'source-text'])

  const reviewed = run(['translate', '--json'], root)
  assert.strictEqual(reviewed.status, 0, reviewed.stderr)
  const state = readJson(root, 'lang/catalog/translation-state.json')
  assert.strictEqual(state.locales.en['demo.shared.title'].review, 'needs-review')
  assert.strictEqual(readJson(root, 'lang/catalog/en.json')['demo.shared.title'], 'Shared title')
  assertDemoLangUnchanged(beforeDemoLang)
})
