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

const WELCOME = '欢迎'
const WELCOME_MD5 = '47781b8a72bcbb7ecb1f955399a7e718'

test('the demo runtime prefers a keyed catalog and falls back to the MD5 dictionary', () => {
  const hashDictionary = { [WELCOME_MD5]: WELCOME, overlap: '哈希词条' }
  const catalog = {
    'demo.visit.banner': 'Welcome aboard',
    'demo.visit.farewell': 'Welcome back',
    overlap: '目录译文'
  }

  assert.strictEqual(resolveDemoMessage('demo.visit.banner', catalog, hashDictionary), 'Welcome aboard')
  assert.strictEqual(resolveDemoMessage('demo.visit.farewell', catalog, hashDictionary), 'Welcome back')
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

const APP_BEFORE = [
  "const { t } = require('./i18n')",
  "const banner = /* i18n-key: demo.visit.banner */ '欢迎'",
  "const farewell = /* i18n-key: demo.visit.farewell */ '欢迎'",
  `const legacy = t('${WELCOME_MD5}')`,
  'module.exports = { banner, farewell, legacy }',
  ''
].join('\n')

const APP_REPLACED = [
  "const { t } = require('./i18n')",
  "const banner = /* i18n-key: demo.visit.banner */ t('demo.visit.banner')",
  "const farewell = /* i18n-key: demo.visit.farewell */ t('demo.visit.farewell')",
  `const legacy = t('${WELCOME_MD5}')`,
  'module.exports = { banner, farewell, legacy }',
  ''
].join('\n')

test('collect, translate, and replace let equal source text use different demo translations', { timeout: 60000 }, () => {
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
  const dictionary = readJson(root, 'lang/zh_hash.json')
  assert.strictEqual(dictionary[WELCOME_MD5], WELCOME)
  assert.strictEqual(Object.values(dictionary).filter(value => value === WELCOME).length, 1)

  const translated = run(['translate', '--json'], root)
  assert.strictEqual(translated.status, 0, translated.stderr)
  const english = readJson(root, 'lang/catalog/en.json')
  assert.strictEqual(english['demo.visit.banner'], 'Welcome aboard')
  assert.strictEqual(english['demo.visit.farewell'], 'Welcome back')

  const written = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), APP_REPLACED)
  assert.strictEqual(readJson(root, 'lang/zh_hash.json')[WELCOME_MD5], WELCOME)

  const hashDictionary = readJson(root, 'lang/zh_hash.json')
  assert.strictEqual(resolveDemoMessage('demo.visit.banner', english, hashDictionary), 'Welcome aboard')
  assert.strictEqual(resolveDemoMessage('demo.visit.farewell', english, hashDictionary), 'Welcome back')
  assert.strictEqual(resolveDemoMessage(WELCOME_MD5, english, hashDictionary), WELCOME)
  const messages = demoLocaleMessages(english, hashDictionary)
  assert.strictEqual(messages['demo.visit.banner'], 'Welcome aboard')
  assert.strictEqual(messages['demo.visit.farewell'], 'Welcome back')
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
  assert.strictEqual(vm.$t(WELCOME_MD5), WELCOME)
  vm.$destroy()
})
