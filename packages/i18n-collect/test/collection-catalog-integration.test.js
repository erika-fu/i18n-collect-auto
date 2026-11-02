const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')
const fixtures = path.join(__dirname, '../fixtures/replacement')

const FORMAL_OUTPUTS = [
  'lang/zh_hash.json',
  'lang/zh_hash.map.json',
  'lang/catalog/zh.json',
  'lang/catalog/catalog.meta.json'
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

function snapshotFormal(root) {
  return Object.fromEntries(FORMAL_OUTPUTS.map(file => [file, fs.readFileSync(path.join(root, file))]))
}

function assertFormalUnchanged(root, before) {
  for (const file of FORMAL_OUTPUTS) {
    assert.deepStrictEqual(fs.readFileSync(path.join(root, file)), before[file], file)
  }
}

function derivedKeyFor(catalog, source) {
  const keys = Object.keys(catalog).filter(key => catalog[key] === source && /^auto\.[0-9A-HJKMNP-TV-Z]{26}$/.test(key))
  assert.strictEqual(keys.length, 1, `one automatic key for ${source}`)
  return keys[0]
}

function writeWebpackProject(root, { entry = './src/app.js', source, files = {}, configSource = '' } = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: 'development',
  entry: ${JSON.stringify(entry)},
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  module: { rules: [{ test: /\\.js$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin()]
}
`)
  if (configSource) fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), configSource)
}

test('collection preserves automatic keys across formatting, ordinary moves, and wording through the collect pipeline', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-catalog-move-'))
  writeWebpackProject(root, {
    source: [
      'const hello = "你好"',
      'const welcome = "欢迎"',
      'module.exports = { hello, welcome }',
      ''
    ].join('\n')
  })

  const first = run(['collect', '--json'], root)
  assert.strictEqual(first.status, 0, first.stderr)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/zh_hash.json')), true)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/zh_hash.map.json')), true)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/zh.json')), true)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/catalog.meta.json')), true)
  const dictionary = readJson(root, 'lang/zh_hash.json')
  assert.deepStrictEqual(Object.values(dictionary).sort(), ['你好', '欢迎'])
  const catalog = readJson(root, 'lang/catalog/zh.json')
  const helloKey = derivedKeyFor(catalog, '你好')
  const welcomeKey = derivedKeyFor(catalog, '欢迎')
  const metadata = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(metadata.version, 3)
  assert.strictEqual(metadata.entries[helloKey].source, '你好')
  assert.strictEqual(metadata.entries[welcomeKey].source, '欢迎')
  const helloOccurrenceId = metadata.entries[helloKey].occurrences[0].id
  const welcomeOccurrenceId = metadata.entries[welcomeKey].occurrences[0].id
  assert.deepStrictEqual(JSON.parse(first.stdout).catalog.added.sort(), [helloKey, welcomeKey].sort())

  fs.writeFileSync(path.join(root, 'src/app.js'), [
    '',
    '',
    'const hello = "你好"',
    '',
    'const welcome = "欢迎"',
    'module.exports = { hello, welcome }',
    ''
  ].join('\n'))
  const formatted = run(['collect', '--json'], root)
  assert.strictEqual(formatted.status, 0, formatted.stderr)
  assert.deepStrictEqual(JSON.parse(formatted.stdout).catalog.unchanged.sort(), [helloKey, welcomeKey].sort())
  assert.deepStrictEqual(readJson(root, 'lang/catalog/zh.json'), {
    [helloKey]: '你好',
    [welcomeKey]: '欢迎'
  })
  const afterFormat = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(afterFormat.entries[helloKey].occurrences[0].id, helloOccurrenceId)
  assert.strictEqual(afterFormat.entries[welcomeKey].occurrences[0].id, welcomeOccurrenceId)
  assert.notDeepStrictEqual(
    afterFormat.entries[helloKey].occurrences[0].location,
    metadata.entries[helloKey].occurrences[0].location
  )

  fs.writeFileSync(path.join(root, 'src/app.js'), [
    'require("./moved")',
    'module.exports = {}',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'src/moved.js'), [
    'const hello = "您好"',
    'const welcome = "欢迎"',
    'module.exports = { hello, welcome }',
    ''
  ].join('\n'))
  const moved = run(['collect', '--json'], root)
  assert.strictEqual(moved.status, 0, moved.stderr)
  const movedCatalog = readJson(root, 'lang/catalog/zh.json')
  assert.strictEqual(movedCatalog[helloKey], '您好')
  assert.strictEqual(movedCatalog[welcomeKey], '欢迎')
  const movedReport = JSON.parse(moved.stdout).catalog
  assert.deepStrictEqual(movedReport.changed.sort(), [helloKey].sort())
  assert.deepStrictEqual(movedReport.unchanged.sort(), [welcomeKey].sort())
  assert.deepStrictEqual(movedReport.added, [])
  assert.deepStrictEqual(movedReport.removed, [])
  const movedMeta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(movedMeta.entries[helloKey].occurrences[0].semanticHost, 'src/moved.js::script')
  assert.strictEqual(movedMeta.entries[welcomeKey].occurrences[0].semanticHost, 'src/moved.js::script')
  assert.deepStrictEqual(Object.values(readJson(root, 'lang/zh_hash.json')).sort(), ['您好', '欢迎'])
  assert.strictEqual(readJson(root, 'lang/zh_hash.map.json').entries.length, 2)
})

test('a source replaced with a localized call stays consistent after ordinary collection', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-catalog-localized-'))
  fs.cpSync(path.join(fixtures, 'js'), root, { recursive: true })
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

  const collected = run(['collect', '--json'], root)
  assert.strictEqual(collected.status, 0, collected.stderr)
  assert.deepStrictEqual(readJson(root, 'lang/catalog/zh.json'), {
    'home.hello': '你好',
    'home.note': '备注'
  })
  const beforeMeta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(beforeMeta.entries['home.hello'].representation, 'source-text')
  assert.strictEqual(beforeMeta.entries['home.hello'].source, '你好')
  const helloFingerprint = beforeMeta.entries['home.hello'].fingerprint
  const helloOccurrenceId = beforeMeta.entries['home.hello'].occurrences[0].id

  const replaced = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(replaced.status, 0, replaced.stderr)
  assert.match(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), /t\('home\.hello'\)/)
  assert.match(fs.readFileSync(path.join(root, 'src/notes.js'), 'utf8'), /t\('home\.note'\)/)

  const after = run(['collect', '--json'], root)
  assert.strictEqual(after.status, 0, after.stderr)
  const afterReport = JSON.parse(after.stdout).catalog
  assert.deepStrictEqual(afterReport.unchanged.sort(), ['home.hello', 'home.note'].sort())
  assert.deepStrictEqual(afterReport.added, [])
  assert.deepStrictEqual(afterReport.changed, [])
  assert.deepStrictEqual(afterReport.removed, [])
  assert.deepStrictEqual(readJson(root, 'lang/catalog/zh.json'), {
    'home.hello': '你好',
    'home.note': '备注'
  })
  const afterMeta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(afterMeta.entries['home.hello'].source, '你好')
  assert.strictEqual(afterMeta.entries['home.hello'].fingerprint, helloFingerprint)
  assert.strictEqual(afterMeta.entries['home.hello'].representation, 'localized-call')
  assert.strictEqual(afterMeta.entries['home.hello'].occurrences[0].representation, 'localized-call')
  assert.strictEqual(afterMeta.entries['home.hello'].occurrences[0].id, helloOccurrenceId)
  assert.strictEqual(afterMeta.entries['home.note'].representation, 'localized-call')
})

test('an occurrence identity ambiguity fails as identity recovery and keeps every formal output', { timeout: 30000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-catalog-identity-'))
  writeWebpackProject(root, {
    source: 'const a = "你好"\nconst b = "你好"\nmodule.exports = [a, b]\n'
  })
  const first = run(['collect', '--json'], root)
  assert.strictEqual(first.status, 0, first.stderr)
  const before = snapshotFormal(root)

  fs.writeFileSync(path.join(root, 'src/app.js'), 'const a = "你好"\nconst b = "你好"\nconst c = "你好"\nmodule.exports = [a, b, c]\n')
  const ambiguous = run(['collect', '--json'], root)
  assert.strictEqual(ambiguous.status, 2, ambiguous.stderr)
  assert.strictEqual(JSON.parse(ambiguous.stdout).failure, 'collection')
  assert.match(ambiguous.stderr, /occurrence identity/)
  assert.match(ambiguous.stderr, /identity-ambiguities\.json/)
  assertFormalUnchanged(root, before)
})

test('a localization key conflict fails as catalog lifecycle and keeps every formal output', { timeout: 30000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-catalog-lifecycle-'))
  writeWebpackProject(root, {
    source: 'require("./other")\nmodule.exports = /* i18n-key: shared.title */ "首页"\n',
    files: { 'src/other.js': 'module.exports = "其他"\n' }
  })
  const first = run(['collect', '--json'], root)
  assert.strictEqual(first.status, 0, first.stderr)
  const before = snapshotFormal(root)

  fs.writeFileSync(path.join(root, 'src/other.js'), 'module.exports = /* i18n-key: shared.title */ "主页"\n')
  const conflict = run(['collect', '--json'], root)
  assert.strictEqual(conflict.status, 2, conflict.stderr)
  assert.strictEqual(JSON.parse(conflict.stdout).failure, 'collection')
  assert.match(conflict.stderr, /localization key conflict/)
  assertFormalUnchanged(root, before)
})

test('a parse failure keeps dictionary, source map, catalog, and metadata at previous versions', { timeout: 30000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-catalog-parse-'))
  writeWebpackProject(root, {
    source: 'const message = "你好"\nmodule.exports = message\n'
  })
  const first = run(['collect', '--json'], root)
  assert.strictEqual(first.status, 0, first.stderr)
  const before = snapshotFormal(root)

  fs.writeFileSync(path.join(root, 'src/app.js'), 'const message = "你好\n')
  const parseFailed = run(['collect', '--json'], root)
  assert.strictEqual(parseFailed.status, 2, parseFailed.stderr)
  assert.strictEqual(JSON.parse(parseFailed.stdout).failure, 'collection')
  assert.match(parseFailed.stderr, /i18n-collect failed for src\/app\.js/)
  assertFormalUnchanged(root, before)
})

test('a transactional write failure fails as build output and restores every formal output', { timeout: 30000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-catalog-tx-'))
  writeWebpackProject(root, {
    source: 'const message = "你好"\nmodule.exports = message\n'
  })
  const first = run(['collect', '--json'], root)
  assert.strictEqual(first.status, 0, first.stderr)
  const before = snapshotFormal(root)

  fs.writeFileSync(path.join(root, 'src/app.js'), 'const message = "您好"\nmodule.exports = message\n')
  const hook = path.join(root, 'fail-collect-write.js')
  fs.writeFileSync(hook, `const fs = require('fs')
const rename = fs.renameSync.bind(fs)
let replaced = 0
fs.renameSync = (from, to) => {
  if (String(from).includes('.tmp-')) {
    replaced += 1
    if (replaced === 2) {
      const error = new Error('simulated catalog write failure')
      error.code = 'EIO'
      throw error
    }
  }
  return rename(from, to)
}
`)
  const writeFailed = run(['collect', '--json'], root, ['-r', hook])
  assert.strictEqual(writeFailed.status, 3, writeFailed.stderr)
  assert.strictEqual(JSON.parse(writeFailed.stdout).failure, 'build')
  assert.match(writeFailed.stderr, /^build: /)
  assert.match(writeFailed.stderr, /simulated catalog write failure/)
  assertFormalUnchanged(root, before)
})

test('repeated collection reuses catalog identity from metadata without key churn', { timeout: 45000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-catalog-churn-'))
  writeWebpackProject(root, {
    source: [
      'const hello = "你好"',
      'const welcome = "欢迎"',
      'module.exports = { hello, welcome }',
      ''
    ].join('\n')
  })

  const first = run(['collect', '--json'], root)
  assert.strictEqual(first.status, 0, first.stderr)
  const firstCatalog = readJson(root, 'lang/catalog/zh.json')
  const firstMeta = fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'))
  const keys = Object.keys(firstCatalog).sort()
  assert.strictEqual(keys.length, 2)
  assert.ok(keys.every(key => /^auto\.[0-9A-HJKMNP-TV-Z]{26}$/.test(key)))

  const second = run(['collect', '--json'], root)
  assert.strictEqual(second.status, 0, second.stderr)
  assert.deepStrictEqual(JSON.parse(second.stdout).catalog.unchanged.sort(), keys)
  assert.deepStrictEqual(JSON.parse(second.stdout).catalog.added, [])
  assert.deepStrictEqual(readJson(root, 'lang/catalog/zh.json'), firstCatalog)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json')), firstMeta)

  const third = run(['collect', '--json'], root)
  assert.strictEqual(third.status, 0, third.stderr)
  assert.deepStrictEqual(Object.keys(readJson(root, 'lang/catalog/zh.json')).sort(), keys)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json')), firstMeta)
})
