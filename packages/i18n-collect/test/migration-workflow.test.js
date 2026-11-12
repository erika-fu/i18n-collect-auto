const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { extractHtml } = require('../myloader/extract-html')
const { extractVueScript } = require('../myloader/extract-vue-compat')
const { installVue2 } = require('./vue2-fixture')
const { installVue3 } = require('./vue3-fixture')
const { keyForSource, seedSourceCatalog } = require('./build-test-helpers')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
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
  if (name === 'vue2') installVue2(root)
  if (name === 'vue3') installVue3(root)
  return root
}

function readJson(root, name) {
  return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function vueEntries(projectPath, source, absolutePath) {
  const resource = { projectPath, absolutePath }
  const html = extractHtml({
    source,
    resource: { ...resource, block: 'template', lang: 'html', query: '?vue&type=template' },
    config: { attributeAllowlist: ALLOW }
  }).entries
  const script = extractVueScript({ source, resource, config: {} })
  return [...html, ...script]
}

function syncLocaleCatalog(root) {
  const catalog = seedSourceCatalog(root, { writeLocaleCatalog: true })
  return catalog
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

test('the migration fixture scans, protects an existing translation, and replaces only on write', { timeout: 60000 }, () => {
  const root = copyFixture('js')
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), APP_BEFORE)
  assert.strictEqual(fs.readFileSync(path.join(root, 'i18n/provider.js'), 'utf8').includes('network'), false)

  const scanned = run(['scan', '--json'], root)
  assert.strictEqual(scanned.status, 0, scanned.stderr)
  assert.deepStrictEqual(readJson(root, 'lang/catalog/source-catalog.json'), {
    version: 1,
    messages: {
      'home.hello': '你好',
      'home.note': '备注'
    }
  })
  fs.writeFileSync(
    path.join(root, 'lang/catalog/zh.json'),
    json(readJson(root, 'lang/catalog/source-catalog.json').messages)
  )
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
  const rescanned = run(['scan', '--json'], root)
  assert.strictEqual(rescanned.status, 0, rescanned.stderr)
  fs.writeFileSync(
    path.join(root, 'lang/catalog/zh.json'),
    json(readJson(root, 'lang/catalog/source-catalog.json').messages)
  )
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

  syncLocaleCatalog(root)
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
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/replacements.json')), false)
  assert.deepStrictEqual(committed.files.sort(), ['src/app.js', 'src/notes.js'].sort())

  fs.writeFileSync(path.join(root, 'lang/catalog/explicit-messages.json'), json({
    version: 1,
    messages: [
      { key: 'home.hello', source: '您好' },
      { key: 'home.note', source: '备注' }
    ]
  }))
  syncLocaleCatalog(root)
  const again = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(again.status, 0, again.stderr)
  const second = JSON.parse(again.stdout)
  assert.strictEqual(second.written, false)
  assert.deepStrictEqual(second.replacements, [])
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), APP_REPLACED)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/replacements.json')), false)
})

test('a failed replacement write restores the migration fixture', { timeout: 30000 }, () => {
  const root = copyFixture('js')
  assert.strictEqual(run(['scan', '--json'], root).status, 0)
  syncLocaleCatalog(root)
  const before = {
    app: fs.readFileSync(path.join(root, 'src/app.js')),
    note: fs.readFileSync(path.join(root, 'src/notes.js'))
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

function vue2Preview(root) {
  const title = keyForSource(root, '标题')
  const welcome = keyForSource(root, '欢迎')
  const hello = keyForSource(root, '你好')
  return [
    '<template>',
    `  <p :title="$t('${title}')">{{ $t('${welcome}') }}</p>`,
    '</template>',
    '<script>',
    'export default {',
    '  methods: {',
    '    greet() {',
    `      return this.$t('${hello}')`,
    '    }',
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
}

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

function vue3Preview(root) {
  const welcome = keyForSource(root, '欢迎')
  const title = keyForSource(root, '标题')
  return [
    '<template>',
    `  <p>{{ $t('${welcome}') }}</p>`,
    '</template>',
    '<script setup>',
    "import { t } from './i18n'",
    `const title = t('${title}')`,
    '</script>',
    ''
  ].join('\n')
}

test('the Vue 2 fixture previews and then keeps a committed replacement', () => {
  const root = copyFixture('vue2')
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), VUE2_SOURCE)
  syncLocaleCatalog(root)
  const vue2Expected = vue2Preview(root)
  const preview = run(['replace', '--adapter', 'vue2', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const previewReport = JSON.parse(preview.stdout)
  assert.strictEqual(previewReport.dryRun, true)
  assert.deepStrictEqual(previewReport.skipped, [])
  assert.strictEqual(previewReport.previews[0].content, vue2Expected)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), VUE2_SOURCE)

  const written = run(['replace', '--adapter', 'vue2', '--write', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  assert.strictEqual(JSON.parse(written.stdout).written, true)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), vue2Expected)

  const again = run(['replace', '--adapter', 'vue2', '--write', '--json'], root)
  assert.strictEqual(again.status, 0, again.stderr)
  const second = JSON.parse(again.stdout)
  assert.strictEqual(second.written, false)
  assert.deepStrictEqual(second.replacements, [])
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), vue2Expected)
})

test('the Vue 3 fixture previews, commits, and keeps the replacement', () => {
  const root = copyFixture('vue3')
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), VUE3_SOURCE)
  syncLocaleCatalog(root)
  const vue3Expected = vue3Preview(root)
  const preview = run(['replace', '--adapter', 'vue3', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const previewReport = JSON.parse(preview.stdout)
  assert.strictEqual(previewReport.adapter, 'vue3')
  assert.strictEqual(previewReport.dryRun, true)
  assert.deepStrictEqual(previewReport.skipped, [])
  assert.strictEqual(previewReport.previews[0].content, vue3Expected)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), VUE3_SOURCE)

  const written = run(['replace', '--adapter', 'vue3', '--write', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  assert.strictEqual(JSON.parse(written.stdout).written, true)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), vue3Expected)

  const again = run(['replace', '--adapter', 'vue3', '--write', '--json'], root)
  assert.strictEqual(again.status, 0, again.stderr)
  const second = JSON.parse(again.stdout)
  assert.strictEqual(second.written, false)
  assert.deepStrictEqual(second.replacements, [])
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), vue3Expected)
})

test('Vue replacement shares collection ranges for directives, entities, CRLF, and expression fragments', () => {
  const source = [
    '<template>',
    '  <!-- no-i18n-auto -->',
    '  <p>跳过</p>',
    '  <p title="保存&nbsp;成功">{{ \'欢迎\' }}</p>',
    '  <input :placeholder="\'请输入\' + suffix">',
    '  <p>{{ `前缀${name}` }}</p>',
    '</template>',
    ''
  ].join('\r\n')
  for (const [fixture, adapter] of [['vue2', 'vue2'], ['vue3', 'vue3']]) {
    const root = copyFixture(fixture)
    const file = path.join(root, 'src/Home.vue')
    fs.writeFileSync(file, source)
    const entries = vueEntries('src/Home.vue', source, file)
    assert.deepStrictEqual(entries.map(entry => entry.value), [
      '保存\u00A0成功',
      '欢迎',
      '请输入',
      '前缀'
    ])
    syncLocaleCatalog(root)

    const saved = keyForSource(root, '保存\u00A0成功')
    const welcome = keyForSource(root, '欢迎')
    const placeholder = keyForSource(root, '请输入')
    const prefix = keyForSource(root, '前缀')
    const expected = [
      '<template>',
      '  <!-- no-i18n-auto -->',
      '  <p>跳过</p>',
      `  <p :title="$t('${saved}')">{{ $t('${welcome}') }}</p>`,
      `  <input :placeholder="$t('${placeholder}') + suffix">`,
      `  <p>{{ \`\${$t('${prefix}')}\${name}\` }}</p>`,
      '</template>',
      ''
    ].join('\r\n')

    const preview = run(['replace', '--adapter', adapter, '--json'], root)

    assert.strictEqual(preview.status, 0, preview.stderr)
    const report = JSON.parse(preview.stdout)
    assert.deepStrictEqual(report.skipped, [])
    assert.strictEqual(report.previews[0].content, expected)
    for (const entry of entries) {
      const catalogKey = keyForSource(root, entry.value)
      const replacement = report.replacements.find(item => item.key === catalogKey)
      assert.deepStrictEqual(replacement.start, entry.locations[0].start)
      assert.deepStrictEqual(replacement.end, entry.locations[0].end)
    }
  }
})
