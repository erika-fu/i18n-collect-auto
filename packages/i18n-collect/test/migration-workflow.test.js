const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { buildCatalog, catalogMetadata } = require('../mycommon/catalog')
const { extractHtml } = require('../myloader/extract-html')
const { extractVueScript } = require('../myloader/extract-vue-compat')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')
const fixtures = path.join(__dirname, '../fixtures/replacement')
const ALLOW = ['title', 'placeholder', 'alt', 'aria-label', 'value']

function run(args, cwd, extra = []) {
  return spawnSync(process.execPath, [...extra, bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function copyFixture(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `i18n-migration-${name}-`))
  fs.cpSync(path.join(fixtures, name), root, { recursive: true })
  return root
}

function readJson(root, name) {
  return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))
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

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function keyed(entries, keys) {
  return entries.map(entry => {
    const key = keys[entry.value]
    if (!key) throw new Error(`missing key for ${JSON.stringify(entry.value)}`)
    return { ...entry, key }
  })
}

function vueEntries(projectPath, source) {
  const resource = { projectPath }
  const html = extractHtml({
    source,
    resource: { ...resource, block: 'template', lang: 'html', query: '?vue&type=template' },
    config: { attributeAllowlist: ALLOW }
  }).entries
  const script = extractVueScript({ source, resource, config: {} })
  return [...html, ...script]
}

function writeCatalog(root, entries) {
  const catalog = buildCatalog([{ entries }])
  assert.deepStrictEqual(catalog.conflicts, [])
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, 'lang/catalog/zh.json'), json(catalog.messages))
  fs.writeFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), json(catalogMetadata(catalog, {
    sourceLocale: 'zh',
    format: 'json'
  })))
}

const APP_BEFORE = [
  "const { t } = require('./i18n')",
  "require('./notes')",
  "require('./legacy/old')",
  "const message = /* i18n-key: home.hello */ '你好'",
  "const hidden = /* no-i18n-auto */ '机密'",
  'module.exports = { message, hidden }',
  ''
].join('\n')

const APP_CHANGED = APP_BEFORE.replace("'你好'", "'您好'")

const APP_REPLACED = [
  "const { t } = require('./i18n')",
  "require('./notes')",
  "require('./legacy/old')",
  "const message = /* i18n-key: home.hello */ t('home.hello')",
  "const hidden = /* no-i18n-auto */ '机密'",
  'module.exports = { message, hidden }',
  ''
].join('\n')

const NOTE_BEFORE = [
  "const { t } = require('./i18n')",
  "const note = /* i18n-key: home.note */ '备注'",
  'module.exports = note',
  ''
].join('\n')

const NOTE_REPLACED = [
  "const { t } = require('./i18n')",
  "const note = /* i18n-key: home.note */ t('home.note')",
  'module.exports = note',
  ''
].join('\n')

test('the migration fixture collects, protects an existing translation, and replaces only on write', { timeout: 60000 }, () => {
  const root = copyFixture('js')
  writeWebpack(root)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), APP_BEFORE)
  assert.strictEqual(fs.readFileSync(path.join(root, 'i18n/provider.js'), 'utf8').includes('network'), false)

  const collected = run(['collect', '--json'], root)
  assert.strictEqual(collected.status, 0, collected.stderr)
  const collectReport = JSON.parse(collected.stdout)
  assert.deepStrictEqual(collectReport.exclude, ['src/legacy/**/*.js'])
  assert.deepStrictEqual(collectReport.include, [])
  assert.deepStrictEqual(readJson(root, 'lang/catalog/zh.json'), {
    'home.hello': '你好',
    'home.note': '备注'
  })
  const dictionary = readJson(root, 'lang/zh_hash.json')
  assert.deepStrictEqual(Object.values(dictionary).sort(), ['你好', '备注'])
  assert.deepStrictEqual(Object.keys(dictionary).includes('home.hello'), false)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/legacy/old.js'), 'utf8').includes('旧文案'), true)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), APP_BEFORE)

  fs.writeFileSync(path.join(root, 'lang/catalog/en.json'), json({ 'home.hello': 'Hello there' }))
  const translated = run(['translate', '--json'], root)
  assert.strictEqual(translated.status, 4, translated.stderr)
  assert.match(translated.stderr, /home\.note \[en\]: glossary rejected 备注/)
  assert.doesNotMatch(translated.stderr, /authorization/)
  const firstReport = JSON.parse(translated.stdout)
  assert.strictEqual(firstReport.policy, 'partial')
  assert.deepStrictEqual(firstReport.failures, [{
    key: 'home.note',
    locale: 'en',
    message: 'glossary rejected 备注'
  }])
  assert.deepStrictEqual(readJson(root, 'lang/catalog/en.json'), { 'home.hello': 'Hello there' })
  const reviewState = readJson(root, 'lang/catalog/translation-state.json')
  assert.strictEqual(reviewState.locales.en['home.hello'].review, 'current')
  assert.strictEqual(reviewState.locales.en['home.note'], undefined)
  const acceptedFingerprint = reviewState.locales.en['home.hello'].sourceFingerprint

  fs.writeFileSync(path.join(root, 'src/app.js'), APP_CHANGED)
  const recollected = run(['collect', '--json'], root)
  assert.strictEqual(recollected.status, 0, recollected.stderr)
  assert.deepStrictEqual(JSON.parse(recollected.stdout).catalog.changed, ['home.hello'])
  assert.deepStrictEqual(readJson(root, 'lang/catalog/zh.json'), {
    'home.hello': '您好',
    'home.note': '备注'
  })

  const reviewed = run(['translate', '--json'], root)
  assert.strictEqual(reviewed.status, 4, reviewed.stderr)
  assert.deepStrictEqual(readJson(root, 'lang/catalog/en.json'), { 'home.hello': 'Hello there' })
  const reviewedState = readJson(root, 'lang/catalog/translation-state.json')
  assert.deepStrictEqual(reviewedState.locales.en['home.hello'], {
    sourceFingerprint: acceptedFingerprint,
    review: 'needs-review'
  })
  assert.deepStrictEqual(JSON.parse(reviewed.stdout).needsReview, [{ key: 'home.hello', locale: 'en' }])

  const preview = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const previewReport = JSON.parse(preview.stdout)
  assert.strictEqual(previewReport.dryRun, true)
  assert.strictEqual(previewReport.written, false)
  assert.deepStrictEqual(previewReport.skipped, [])
  assert.deepStrictEqual(previewReport.previews.map(item => item.path), ['src/app.js', 'src/notes.js'])
  assert.strictEqual(previewReport.previews[0].content, APP_REPLACED)
  assert.strictEqual(previewReport.previews[1].content, NOTE_REPLACED)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), APP_CHANGED)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/notes.js'), 'utf8'), NOTE_BEFORE)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/replacements.json')), false)

  const written = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  const committed = JSON.parse(written.stdout)
  assert.strictEqual(committed.dryRun, false)
  assert.strictEqual(committed.written, true)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), APP_REPLACED)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/notes.js'), 'utf8'), NOTE_REPLACED)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/legacy/old.js'), 'utf8').includes('旧文案'), true)
  assert.deepStrictEqual(readJson(root, 'lang/catalog/en.json'), { 'home.hello': 'Hello there' })
  const metadata = readJson(root, 'lang/catalog/replacements.json')
  assert.strictEqual(metadata.version, 1)
  assert.strictEqual(metadata.adapter, 'js')
  assert.deepStrictEqual(metadata.replacements.map(item => item.call).sort(), [
    "t('home.hello')",
    "t('home.note')"
  ])

  const again = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(again.status, 0, again.stderr)
  const second = JSON.parse(again.stdout)
  assert.strictEqual(second.written, false)
  assert.deepStrictEqual(second.replacements, [])
  assert.deepStrictEqual(second.recognized.map(item => item.call).sort(), [
    "t('home.hello')",
    "t('home.note')"
  ])
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), APP_REPLACED)
  assert.deepStrictEqual(readJson(root, 'lang/catalog/replacements.json'), metadata)
})

test('a failed replacement write restores the migration fixture', { timeout: 30000 }, () => {
  const root = copyFixture('js')
  writeWebpack(root)
  const collected = run(['collect', '--json'], root)
  assert.strictEqual(collected.status, 0, collected.stderr)
  const before = {
    app: fs.readFileSync(path.join(root, 'src/app.js')),
    note: fs.readFileSync(path.join(root, 'src/notes.js')),
    catalog: fs.readFileSync(path.join(root, 'lang/catalog/zh.json')),
    meta: fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'))
  }
  const hook = path.join(root, 'fail-replacement.js')
  fs.writeFileSync(hook, `const fs = require('fs')
const rename = fs.renameSync.bind(fs)
let replaced = 0
fs.renameSync = (from, to) => {
  if (String(from).includes('.tmp-')) {
    replaced += 1
    if (replaced === 2) {
      const error = new Error('simulated storage failure')
      error.code = 'EIO'
      throw error
    }
  }
  return rename(from, to)
}
`)
  const result = run(['replace', '--adapter', 'js', '--write', '--json'], root, ['-r', hook])
  assert.strictEqual(result.status, 6, result.stderr)
  assert.match(result.stderr, /^storage: /)
  assert.match(result.stderr, /restored after a write failure/)
  assert.strictEqual(JSON.parse(result.stdout).failure, 'storage')
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'src/app.js')), before.app)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'src/notes.js')), before.note)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/zh.json')), before.catalog)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json')), before.meta)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/replacements.json')), false)
})

const VUE2_SOURCE = [
  '<template>',
  '  <p title="标题">欢迎</p>',
  '</template>',
  '<script>',
  'export default {',
  '  methods: {',
  '    greet() {',
  "      return '你好'",
  '    }',
  '  }',
  '}',
  '</script>',
  ''
].join('\n')

const VUE2_PREVIEW = [
  '<template>',
  '  <p :title="$t(\'home.title\')">{{ $t(\'home.welcome\') }}</p>',
  '</template>',
  '<script>',
  'export default {',
  '  methods: {',
  '    greet() {',
  "      return this.$t('home.hello')",
  '    }',
  '  }',
  '}',
  '</script>',
  ''
].join('\n')

const VUE3_SOURCE = [
  '<template>',
  '  <p>欢迎</p>',
  '</template>',
  '<script setup>',
  "import { t } from './i18n'",
  "const title = '标题'",
  '</script>',
  ''
].join('\n')

const VUE3_PREVIEW = [
  '<template>',
  '  <p>{{ $t(\'home.welcome\') }}</p>',
  '</template>',
  '<script setup>',
  "import { t } from './i18n'",
  "const title = t('home.title')",
  '</script>',
  ''
].join('\n')

test('the Vue 2 fixture previews and then keeps a committed replacement', () => {
  const root = copyFixture('vue2')
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), VUE2_SOURCE)
  writeCatalog(root, keyed(vueEntries('src/Home.vue', VUE2_SOURCE), {
    标题: 'home.title',
    欢迎: 'home.welcome',
    你好: 'home.hello'
  }))
  const preview = run(['replace', '--adapter', 'vue2', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const previewReport = JSON.parse(preview.stdout)
  assert.strictEqual(previewReport.dryRun, true)
  assert.deepStrictEqual(previewReport.skipped, [])
  assert.strictEqual(previewReport.previews[0].content, VUE2_PREVIEW)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), VUE2_SOURCE)

  const written = run(['replace', '--adapter', 'vue2', '--write', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  assert.strictEqual(JSON.parse(written.stdout).written, true)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), VUE2_PREVIEW)

  const again = run(['replace', '--adapter', 'vue2', '--write', '--json'], root)
  assert.strictEqual(again.status, 0, again.stderr)
  const second = JSON.parse(again.stdout)
  assert.strictEqual(second.written, false)
  assert.deepStrictEqual(second.replacements, [])
  assert.deepStrictEqual(second.recognized.map(item => item.call).sort(), [
    "$t('home.title')",
    "$t('home.welcome')",
    "this.$t('home.hello')"
  ])
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), VUE2_PREVIEW)
})

test('the Vue 3 fixture previews, commits, and keeps the replacement', () => {
  const root = copyFixture('vue3')
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), VUE3_SOURCE)
  writeCatalog(root, keyed(vueEntries('src/Home.vue', VUE3_SOURCE), {
    欢迎: 'home.welcome',
    标题: 'home.title'
  }))
  const preview = run(['replace', '--adapter', 'vue3', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const previewReport = JSON.parse(preview.stdout)
  assert.strictEqual(previewReport.adapter, 'vue3')
  assert.strictEqual(previewReport.dryRun, true)
  assert.deepStrictEqual(previewReport.skipped, [])
  assert.strictEqual(previewReport.previews[0].content, VUE3_PREVIEW)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), VUE3_SOURCE)

  const written = run(['replace', '--adapter', 'vue3', '--write', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  assert.strictEqual(JSON.parse(written.stdout).written, true)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), VUE3_PREVIEW)

  const again = run(['replace', '--adapter', 'vue3', '--write', '--json'], root)
  assert.strictEqual(again.status, 0, again.stderr)
  const second = JSON.parse(again.stdout)
  assert.strictEqual(second.written, false)
  assert.deepStrictEqual(second.replacements, [])
  assert.deepStrictEqual(second.recognized.map(item => item.call).sort(), [
    "$t('home.welcome')",
    "t('home.title')"
  ])
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), VUE3_PREVIEW)
})
