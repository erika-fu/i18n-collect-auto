const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { keyForSource, seedSourceCatalog } = require('./build-test-helpers')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')
const demoLang = path.join(__dirname, '../../../apps/demo/lang')

const FORMAL_COLLECT = [
  'lang/zh_hash.json',
  'lang/zh_hash.map.json',
  'lang/catalog/zh.json',
  'lang/catalog/catalog.meta.json'
]
const FORMAL_TRANSLATE = [
  'lang/catalog/en.json',
  'lang/catalog/translation-state.json'
]

function run(args, cwd, extra = []) {
  return spawnSync(process.execPath, [...extra, bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function readJson(root, file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
}

function snapshotFiles(root, files) {
  return Object.fromEntries(files.map(file => {
    const full = path.join(root, file)
    return [file, fs.existsSync(full) ? fs.readFileSync(full) : null]
  }))
}

function assertFilesUnchanged(root, before, files = Object.keys(before)) {
  const after = snapshotFiles(root, files)
  for (const file of files) {
    assert.deepStrictEqual(after[file], before[file], `formal output changed: ${file}`)
  }
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

function writeProject(root, { source, files = {} } = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'i18n'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  fs.writeFileSync(path.join(root, 'src/i18n.js'), [
    'function t(key) { return key }',
    'module.exports = { t }',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'i18n/provider.js'), [
    'module.exports = {',
    '  translate(request) {',
    '    const drafts = []',
    '    for (const item of request.items) {',
    '      for (const locale of item.locales) {',
    "        drafts.push({ key: item.key, locale, text: `EN:${item.source}` })",
    '      }',
    '    }',
    '    return { drafts, failures: [] }',
    '  }',
    '}',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), [
    'module.exports = {',
    "  translationProvider: 'i18n/provider.js',",
    "  targetLocales: ['en'],",
    "  translationFailure: 'partial'",
    '}',
    ''
  ].join('\n'))
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
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
}

const APP_BEFORE = [
  "const { t } = require('./i18n')",
  "const greeting = /* i18n-key: home.hello */ '你好'",
  "const wait = '请稍候'",
  'module.exports = { greeting, wait }',
  ''
].join('\n')

test('collect, translate, and source replacement with --write succeed through the ordinary migration workflow', { timeout: 90000 }, () => {
  const beforeDemoLang = snapshotDemoLang()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-e2e-migrate-'))
  writeProject(root, { source: APP_BEFORE })

  const collected = run(['collect', '--json'], root)
  assert.strictEqual(collected.status, 0, collected.stderr)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), APP_BEFORE)
  let sourceCatalog = readJson(root, 'lang/catalog/zh.json')
  assert.strictEqual(sourceCatalog['home.hello'], '你好')
  let waitKey = Object.keys(sourceCatalog).find(key => sourceCatalog[key] === '请稍候')
  assert.ok(waitKey, 'collect assigns a catalog key for 请稍候')
  fs.writeFileSync(path.join(root, 'src/app.js'), APP_BEFORE.replace(
    "const wait = '请稍候'",
    `const wait = /* i18n-key: ${waitKey} */ '请稍候'`
  ))
  const rebound = run(['collect', '--json'], root)
  assert.strictEqual(rebound.status, 0, rebound.stderr)
  sourceCatalog = readJson(root, 'lang/catalog/zh.json')
  waitKey = Object.keys(sourceCatalog).find(key => sourceCatalog[key] === '请稍候')
  assert.ok(waitKey, 'rebound collect keeps the wait catalog key')
  const meta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(meta.version, 3)
  assert.strictEqual(meta.entries['home.hello'].origin, 'explicit')
  assert.strictEqual(meta.entries[waitKey].origin, 'explicit')
  assert.strictEqual(meta.entries['home.hello'].representation, 'source-text')
  assert.strictEqual(meta.entries[waitKey].representation, 'source-text')

  const translated = run(['translate', '--json'], root)
  assert.strictEqual(translated.status, 0, translated.stderr)
  const english = readJson(root, 'lang/catalog/en.json')
  assert.strictEqual(english['home.hello'], 'EN:你好')
  assert.strictEqual(english[waitKey], 'EN:请稍候')
  const review = readJson(root, 'lang/catalog/translation-state.json')
  assert.strictEqual(review.locales.en['home.hello'].review, 'current')
  assert.strictEqual(review.locales.en[waitKey].review, 'current')
  const helloFingerprint = review.locales.en['home.hello'].sourceFingerprint

  seedSourceCatalog(root, { writeLegacyArtifacts: false })
  const written = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  const committed = JSON.parse(written.stdout)
  assert.strictEqual(committed.written, true)
  const replaced = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8')
  assert.match(replaced, /\/\* i18n-key: home\.hello \*\/ t\('home\.hello'\)/)
  assert.match(replaced, new RegExp(`t\\('${waitKey}'\\)`))
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/replacements.json')))

  const afterReplace = run(['collect', '--json'], root)
  assert.strictEqual(afterReplace.status, 0, afterReplace.stderr)
  const afterReplaceReport = JSON.parse(afterReplace.stdout).catalog
  assert.deepStrictEqual(afterReplaceReport.added, [])
  assert.deepStrictEqual(afterReplaceReport.changed, [])
  assert.deepStrictEqual(afterReplaceReport.removed, [])
  assert.deepStrictEqual(afterReplaceReport.orphaned, [])
  const afterReplaceCatalog = readJson(root, 'lang/catalog/zh.json')
  assert.strictEqual(afterReplaceCatalog['home.hello'], '你好')
  assert.strictEqual(afterReplaceCatalog[waitKey], '请稍候')
  const afterReplaceMeta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(afterReplaceMeta.entries[waitKey].source, '请稍候')
  assert.strictEqual(afterReplaceMeta.entries['home.hello'].status, 'active')
  assert.strictEqual(afterReplaceMeta.entries[waitKey].status, 'active')
  assert.strictEqual(afterReplaceMeta.entries['home.hello'].representation, 'localized-call')
  assert.strictEqual(afterReplaceMeta.entries[waitKey].representation, 'localized-call')
  assert.ok(
    afterReplaceMeta.entries['home.hello'].occurrences.every(item => item.representation === 'localized-call'),
    'replaced occurrences stay localized-call without the original source text'
  )
  assert.ok(
    afterReplaceMeta.entries[waitKey].occurrences.every(item => item.representation === 'localized-call')
  )

  fs.writeFileSync(path.join(root, 'src/app.js'), [
    "const { t } = require('./i18n')",
    '',
    "const greeting = /* i18n-key: home.hello */ t('home.hello')",
    '',
    `const wait = t('${waitKey}')`,
    'module.exports = { greeting, wait }',
    ''
  ].join('\n'))
  const formatted = run(['collect', '--json'], root)
  assert.strictEqual(formatted.status, 0, formatted.stderr)
  const formattedReport = JSON.parse(formatted.stdout).catalog
  assert.deepStrictEqual(formattedReport.added, [])
  assert.deepStrictEqual(formattedReport.changed, [])
  assert.deepStrictEqual(formattedReport.removed, [])
  assert.deepStrictEqual(formattedReport.orphaned, [])
  assert.deepStrictEqual(Object.keys(readJson(root, 'lang/catalog/zh.json')).sort(), ['home.hello', waitKey].sort())

  fs.writeFileSync(path.join(root, 'src/app.js'), [
    "const { t } = require('./i18n')",
    'module.exports = require("./moved")',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'src/moved.js'), [
    "const { t } = require('./i18n')",
    "const greeting = /* i18n-key: home.hello */ t('home.hello')",
    `const wait = t('${waitKey}')`,
    'module.exports = { greeting, wait }',
    ''
  ].join('\n'))
  const moved = run(['collect', '--json'], root)
  assert.strictEqual(moved.status, 0, moved.stderr)
  const movedReport = JSON.parse(moved.stdout).catalog
  assert.deepStrictEqual(movedReport.added, [])
  assert.deepStrictEqual(movedReport.changed, [])
  assert.deepStrictEqual(movedReport.removed, [])
  assert.deepStrictEqual(movedReport.orphaned, [])
  const movedCatalog = readJson(root, 'lang/catalog/zh.json')
  assert.strictEqual(movedCatalog['home.hello'], '你好')
  assert.strictEqual(movedCatalog[waitKey], '请稍候')
  const movedMeta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(movedMeta.entries['home.hello'].status, 'active')
  assert.strictEqual(movedMeta.entries[waitKey].status, 'active')
  assert.notStrictEqual(movedMeta.entries['home.hello'].status, 'orphaned')
  assert.notStrictEqual(movedMeta.entries[waitKey].status, 'orphaned')
  assert.ok(
    movedMeta.entries['home.hello'].occurrences.every(item => item.representation === 'localized-call')
  )

  fs.writeFileSync(path.join(root, 'src/moved.js'), [
    "const { t } = require('./i18n')",
    "const greeting = /* i18n-key: home.hello */ '您好'",
    `const wait = t('${waitKey}')`,
    "const greetingCall = t('home.hello')",
    'module.exports = { greeting, wait, greetingCall }',
    ''
  ].join('\n'))
  const wording = run(['collect', '--json'], root)
  assert.strictEqual(wording.status, 0, wording.stderr)
  const wordingReport = JSON.parse(wording.stdout).catalog
  assert.deepStrictEqual(wordingReport.changed.sort(), ['home.hello'].sort())
  assert.deepStrictEqual(wordingReport.added, [])
  assert.deepStrictEqual(wordingReport.removed, [])
  assert.strictEqual(readJson(root, 'lang/catalog/zh.json')['home.hello'], '您好')
  assert.strictEqual(readJson(root, 'lang/catalog/zh.json')[waitKey], '请稍候')
  const wordingMeta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(wordingMeta.entries['home.hello'].source, '您好')
  assert.notStrictEqual(wordingMeta.entries['home.hello'].fingerprint, meta.entries['home.hello'].fingerprint)
  assert.deepStrictEqual(
    wordingMeta.entries['home.hello'].occurrences.map(item => item.representation).sort(),
    ['localized-call', 'source-text']
  )

  const reviewed = run(['translate', '--json'], root)
  assert.strictEqual(reviewed.status, 0, reviewed.stderr)
  assert.strictEqual(readJson(root, 'lang/catalog/en.json')['home.hello'], 'EN:你好')
  assert.strictEqual(readJson(root, 'lang/catalog/en.json')[waitKey], 'EN:请稍候')
  const reviewedState = readJson(root, 'lang/catalog/translation-state.json')
  assert.deepStrictEqual(reviewedState.locales.en['home.hello'], {
    sourceFingerprint: helloFingerprint,
    review: 'needs-review'
  })
  assert.strictEqual(reviewedState.locales.en[waitKey].review, 'current')
  assert.deepStrictEqual(JSON.parse(reviewed.stdout).needsReview, [{ key: 'home.hello', locale: 'en' }])

  assertDemoLangUnchanged(beforeDemoLang)
})

test('deletion orphans a key while replacement by a localized call keeps it active', { timeout: 90000 }, () => {
  const beforeDemoLang = snapshotDemoLang()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-e2e-delete-vs-replace-'))
  writeProject(root, {
    source: [
      "const { t } = require('./i18n')",
      "const keep = /* i18n-key: home.keep */ '保留'",
      "const drop = /* i18n-key: home.drop */ '删除'",
      'module.exports = { keep, drop }',
      ''
    ].join('\n')
  })

  assert.strictEqual(run(['collect', '--json'], root).status, 0)
  assert.strictEqual(run(['translate', '--json'], root).status, 0)
  seedSourceCatalog(root, { writeLegacyArtifacts: false })
  const replaced = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(replaced.status, 0, replaced.stderr)

  const afterReplace = run(['collect', '--json'], root)
  assert.strictEqual(afterReplace.status, 0, afterReplace.stderr)
  const afterReplaceMeta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(afterReplaceMeta.entries['home.keep'].status, 'active')
  assert.strictEqual(afterReplaceMeta.entries['home.drop'].status, 'active')
  assert.strictEqual(afterReplaceMeta.entries['home.keep'].representation, 'localized-call')
  assert.strictEqual(afterReplaceMeta.entries['home.drop'].representation, 'localized-call')
  assert.deepStrictEqual(JSON.parse(afterReplace.stdout).catalog.orphaned, [])
  assert.deepStrictEqual(readJson(root, 'lang/catalog/zh.json'), {
    'home.keep': '保留',
    'home.drop': '删除'
  })

  fs.writeFileSync(path.join(root, 'src/app.js'), [
    "const { t } = require('./i18n')",
    "const keep = /* i18n-key: home.keep */ t('home.keep')",
    'module.exports = { keep }',
    ''
  ].join('\n'))
  const deleted = run(['collect', '--json'], root)
  assert.strictEqual(deleted.status, 0, deleted.stderr)
  const deletedReport = JSON.parse(deleted.stdout).catalog
  assert.deepStrictEqual(deletedReport.orphaned, ['home.drop'])
  assert.deepStrictEqual(deletedReport.removed, [])
  assert.deepStrictEqual(deletedReport.unchanged.sort(), ['home.keep'].sort())
  assert.deepStrictEqual(readJson(root, 'lang/catalog/zh.json'), {
    'home.keep': '保留'
  })
  const deletedMeta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(deletedMeta.entries['home.keep'].status, 'active')
  assert.strictEqual(deletedMeta.entries['home.keep'].representation, 'localized-call')
  assert.strictEqual(deletedMeta.entries['home.drop'].status, 'orphaned')
  assert.ok(
    deletedMeta.entries['home.keep'].occurrences.every(item => item.representation === 'localized-call'),
    'kept localized-call is not treated as an orphan'
  )
  assert.strictEqual(readJson(root, 'lang/catalog/en.json')['home.drop'], 'EN:删除')

  assertDemoLangUnchanged(beforeDemoLang)
})

test('a failed collect, translate, or replace stage after migration leaves formal outputs unchanged', { timeout: 120000 }, () => {
  const beforeDemoLang = snapshotDemoLang()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-e2e-failed-stage-'))
  writeProject(root, { source: APP_BEFORE })

  assert.strictEqual(run(['collect', '--json'], root).status, 0)
  assert.strictEqual(run(['translate', '--json'], root).status, 0)
  seedSourceCatalog(root, { writeLegacyArtifacts: false })
  const beforeFirstReplace = {
    app: fs.readFileSync(path.join(root, 'src/app.js')),
    catalog: fs.readFileSync(path.join(root, 'lang/catalog/zh.json')),
    meta: fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json')),
    english: fs.readFileSync(path.join(root, 'lang/catalog/en.json')),
    state: fs.readFileSync(path.join(root, 'lang/catalog/translation-state.json'))
  }
  const replaceHook = path.join(root, 'fail-replace.js')
  fs.writeFileSync(replaceHook, `const fs = require('fs')
const rename = fs.renameSync.bind(fs)
let replaced = 0
fs.renameSync = (from, to) => {
  if (String(from).includes('.tmp-')) {
    replaced += 1
    if (replaced === 1) {
      const error = new Error('simulated storage failure')
      error.code = 'EIO'
      throw error
    }
  }
  return rename(from, to)
}
`)
  const failedReplace = run(['replace', '--adapter', 'js', '--write', '--json'], root, ['-r', replaceHook])
  assert.strictEqual(failedReplace.status, 6, failedReplace.stderr)
  assert.strictEqual(JSON.parse(failedReplace.stdout).failure, 'storage')
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'src/app.js')), beforeFirstReplace.app)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/zh.json')), beforeFirstReplace.catalog)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json')), beforeFirstReplace.meta)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/en.json')), beforeFirstReplace.english)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/translation-state.json')), beforeFirstReplace.state)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/replacements.json')), false)

  assert.strictEqual(run(['replace', '--adapter', 'js', '--write', '--json'], root).status, 0)
  assert.strictEqual(run(['collect', '--json'], root).status, 0)

  const beforeCollect = snapshotFiles(root, FORMAL_COLLECT)
  const beforeTranslate = snapshotFiles(root, FORMAL_TRANSLATE)
  const beforeSource = fs.readFileSync(path.join(root, 'src/app.js'))
  fs.writeFileSync(path.join(root, 'src/app.js'), "const broken = '你好\n")
  const failedCollect = run(['collect', '--json'], root)
  assert.strictEqual(failedCollect.status, 2, failedCollect.stderr)
  assert.strictEqual(JSON.parse(failedCollect.stdout).failure, 'collection')
  assertFilesUnchanged(root, beforeCollect)
  assertFilesUnchanged(root, beforeTranslate)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/replacements.json')))

  fs.writeFileSync(path.join(root, 'src/app.js'), beforeSource)
  assert.strictEqual(run(['collect', '--json'], root).status, 0)

  fs.writeFileSync(path.join(root, 'src/app.js'), [
    "const { t } = require('./i18n')",
    "const greeting = /* i18n-key: home.hello */ t('home.hello')",
    "const wait = '请稍候已改'",
    'module.exports = { greeting, wait }',
    ''
  ].join('\n'))
  assert.strictEqual(run(['collect', '--json'], root).status, 0)
  const beforeFailedTranslate = snapshotFiles(root, [...FORMAL_COLLECT, ...FORMAL_TRANSLATE])
  const translateHook = path.join(root, 'fail-translate.js')
  fs.writeFileSync(translateHook, `const fs = require('fs')
const path = require('path')
const rename = fs.renameSync.bind(fs)
const write = fs.writeFileSync.bind(fs)
const finals = new Set(['en.json', 'translation-state.json'])
let replaced = 0
function noteFinal(file) {
  if (!finals.has(path.basename(String(file)))) return
  replaced += 1
  if (replaced === 2) {
    const error = new Error('simulated storage failure')
    error.code = 'EIO'
    throw error
  }
}
fs.writeFileSync = (file, ...args) => {
  noteFinal(file)
  return write(file, ...args)
}
fs.renameSync = (from, to) => {
  if (String(from).includes('.tmp-')) noteFinal(to)
  return rename(from, to)
}
`)
  const failedTranslate = run(['translate', '--json'], root, ['-r', translateHook])
  assert.strictEqual(failedTranslate.status, 6, failedTranslate.stderr)
  assert.strictEqual(JSON.parse(failedTranslate.stdout).failure, 'storage')
  assertFilesUnchanged(root, beforeFailedTranslate)

  assertDemoLangUnchanged(beforeDemoLang)
})
