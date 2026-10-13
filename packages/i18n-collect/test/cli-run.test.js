const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { buildCatalog, catalogMetadata } = require('../mycommon/catalog')
const { extractScript } = require('../myloader/extract-script')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')

function run(args, cwd, extra = []) {
  return spawnSync(process.execPath, [...extra, bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function tempProject(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function write(root, name, contents) {
  const file = path.join(root, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
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

function assertUnchanged(root, before) {
  for (const [file, bytes] of before) assert.deepStrictEqual(fs.readFileSync(file), bytes)
  assert.deepStrictEqual(projectFiles(root), [...before.keys()].sort())
}

function keyed(entries, keys) {
  return entries.map(entry => {
    const key = keys[entry.value]
    if (!key) throw new Error(`missing key for ${JSON.stringify(entry.value)}`)
    return { ...entry, key }
  })
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
  return catalog
}

function jsFixture(root) {
  const source = [
    "import { t } from './i18n'",
    'const message = "你好"',
    'export default message',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, keyed(extractScript({ source, resource: { projectPath: 'src/app.js' }, config: {} }), { 你好: 'home.hello' }))
  return source
}

function writeWebpackProject(root, { source, files = {}, configSource = '' } = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  fs.writeFileSync(path.join(root, 'src/orphan.js'), 'module.exports = "孤儿词条"\n')
  for (const [name, contents] of Object.entries(files)) write(root, name, contents)
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
  if (configSource) fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), configSource)
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(root, 'dist/keep.txt'), 'keep\n')
}

const APP_SOURCE = [
  "const { t } = require('./i18n')",
  'const message = "你好"',
  'module.exports = message',
  ''
].join('\n')

const LOCAL_PROVIDER = `module.exports = {
  translate(request) {
    return {
      drafts: request.items.map(item => ({
        key: item.key,
        locale: item.locales[0],
        text: 'Hello'
      }))
    }
  }
}
`

function webpackWorkflow(root) {
  writeWebpackProject(root, {
    source: APP_SOURCE,
    files: {
      'src/i18n.js': 'function t(key) { return key }\nmodule.exports = { t }\n',
      'i18n/provider.js': LOCAL_PROVIDER
    },
    configSource: `module.exports = {\n  translationProvider: 'i18n/provider.js',\n  targetLocales: ['en']\n}\n`
  })
}

test('run help describes stage composition and keeps replacement dry-run by default', () => {
  const help = run(['run', '--help'])
  assert.strictEqual(help.status, 0)
  assert.strictEqual(help.stderr, '')
  assert.match(help.stdout, /i18n-collect run/)
  assert.match(help.stdout, /--collect/)
  assert.match(help.stdout, /--translate/)
  assert.match(help.stdout, /--replace/)
  assert.match(help.stdout, /--write/)
  assert.match(help.stdout, /--allow-network/)
  assert.match(help.stdout, /--strict/)
  assert.match(help.stdout, /dry-run/)
  assert.match(help.stdout, /collect, then translate, then replace/)
  const root = run(['--help'])
  assert.match(root.stdout, /\brun\b/)
})

test('run requires a selected stage and rejects options for a stage that is off', () => {
  const root = tempProject('i18n-run-config-')
  const missing = run(['run', '--json'], root)
  assert.strictEqual(missing.status, 1)
  assert.match(missing.stderr, /run requires --collect, --translate, or --replace/)
  const extra = run(['run', '--collect', '--adapter', 'js', '--json'], root)
  assert.strictEqual(extra.status, 1)
  assert.match(extra.stderr, /--adapter requires --replace/)
})

test('run --json keeps a replace configuration failure as that stage report', () => {
  const root = tempProject('i18n-run-replace-config-')
  jsFixture(root)
  const result = run(['run', '--replace', '--json'], root)
  assert.strictEqual(result.status, 1)
  assert.match(result.stderr, /^configuration: replace requires --adapter/)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'run')
  assert.strictEqual(report.ok, false)
  assert.strictEqual(report.failure, 'configuration')
  assert.match(report.message, /replace requires --adapter/)
  assert.strictEqual(report.results.length, 1)
  assert.strictEqual(report.results[0].command, 'replace')
  assert.strictEqual(report.results[0].ok, false)
  assert.strictEqual(report.results[0].failure, 'configuration')
  assert.match(report.results[0].message, /replace requires --adapter/)
})

test('run --collect collects without translating or rewriting source', { timeout: 20000 }, () => {
  const root = tempProject('i18n-run-collect-')
  webpackWorkflow(root)
  write(root, 'i18n/provider.js', `const fs = require('fs')
const path = require('path')
module.exports = {
  translate() {
    fs.writeFileSync(path.join(__dirname, 'called'), 'yes')
    throw new Error('translate ran during collect-only')
  }
}
`)
  const before = fs.readFileSync(path.join(root, 'src/app.js'))
  const result = run(['run', '--collect', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'run')
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.stages, ['collect'])
  assert.strictEqual(report.results.length, 1)
  assert.strictEqual(report.results[0].command, 'collect')
  assert.strictEqual(report.results[0].entries, 1)
  assert.strictEqual(report.results[0].ok, true)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'src/app.js')), before)
  assert.strictEqual(fs.existsSync(path.join(root, 'i18n/called')), false)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/en.json')), false)
  assert.strictEqual(fs.readFileSync(path.join(root, 'dist/keep.txt'), 'utf8'), 'keep\n')
  const messages = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/zh.json'), 'utf8'))
  assert.deepStrictEqual(Object.values(messages), ['你好'])
})

test('run --translate fills a catalog without collecting or rewriting source', () => {
  const root = tempProject('i18n-run-translate-')
  const source = jsFixture(root)
  write(root, 'src/extra.js', 'module.exports = "旁路"\n')
  write(root, 'i18n/provider.js', LOCAL_PROVIDER)
  write(root, 'i18n-collect.config.js', `module.exports = {\n  translationProvider: 'i18n/provider.js',\n  targetLocales: ['en']\n}\n`)
  const result = run(['run', '--translate', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.stages, ['translate'])
  assert.strictEqual(report.results[0].command, 'translate')
  assert.strictEqual(report.results[0].ok, true)
  assert.deepStrictEqual(report.results[0].created, [{ key: 'home.hello', locale: 'en' }])
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), source)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/extra.js'), 'utf8'), 'module.exports = "旁路"\n')
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/zh_hash.json')), false)
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8'))['home.hello'], 'Hello')
})

test('run replacement stays a dry-run until --write and forwards strict mode', () => {
  const root = tempProject('i18n-run-replace-')
  const source = jsFixture(root)
  const preview = run(['run', '--replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const dry = JSON.parse(preview.stdout)
  assert.deepStrictEqual(dry.stages, ['replace'])
  assert.strictEqual(dry.results[0].dryRun, true)
  assert.strictEqual(dry.results[0].written, false)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), source)

  const written = run(['run', '--replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  const report = JSON.parse(written.stdout)
  assert.strictEqual(report.results[0].dryRun, false)
  assert.strictEqual(report.results[0].written, true)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), [
    "import { t } from './i18n'",
    "const message = t('home.hello')",
    'export default message',
    ''
  ].join('\n'))

  const strictRoot = tempProject('i18n-run-strict-')
  const skipped = [
    "import { t } from './i18n'",
    "const labels = { '标题': '你好' }",
    'export default labels',
    ''
  ].join('\n')
  write(strictRoot, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(strictRoot, 'src/app.js', skipped)
  writeCatalog(strictRoot, keyed(extractScript({
    source: skipped,
    resource: { projectPath: 'src/app.js' },
    config: {}
  }), { 标题: 'home.title', 你好: 'home.hello' }))
  const before = snapshotFiles(strictRoot)
  const strict = run(['run', '--replace', '--adapter', 'js', '--strict', '--write', '--json'], strictRoot)
  assert.strictEqual(strict.status, 7)
  assert.match(strict.stderr, /^replacement: skipped candidates fail strict mode/)
  const strictReport = JSON.parse(strict.stdout)
  assert.strictEqual(strictReport.ok, false)
  assert.strictEqual(strictReport.failure, 'replacement')
  assert.strictEqual(strictReport.results.length, 1)
  assert.strictEqual(strictReport.results[0].failure, 'replacement')
  assertUnchanged(strictRoot, before)
})

test('run stops before replacement when network translation is not authorized', () => {
  const root = tempProject('i18n-run-network-')
  const source = jsFixture(root)
  write(root, 'i18n/provider.js', `const fs = require('fs')
const path = require('path')
module.exports = {
  network: true,
  translate(request) {
    fs.writeFileSync(path.join(__dirname, 'sent.json'), JSON.stringify(request.items))
    return { drafts: [{ key: 'home.hello', locale: 'en', text: 'Hello' }] }
  }
}
`)
  write(root, 'i18n-collect.config.js', `module.exports = {\n  translationProvider: 'i18n/provider.js',\n  targetLocales: ['en']\n}\n`)
  const denied = run(['run', '--translate', '--replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(denied.status, 5, denied.stderr)
  assert.match(denied.stderr, /^authorization: /)
  const deniedReport = JSON.parse(denied.stdout)
  assert.deepStrictEqual(deniedReport.stages, ['translate', 'replace'])
  assert.strictEqual(deniedReport.ok, false)
  assert.strictEqual(deniedReport.failure, 'authorization')
  assert.strictEqual(deniedReport.results.length, 1)
  assert.strictEqual(deniedReport.results[0].command, 'translate')
  assert.strictEqual(fs.existsSync(path.join(root, 'i18n/sent.json')), false)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), source)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/en.json')), false)

  const allowed = run(['run', '--translate', '--replace', '--adapter', 'js', '--write', '--allow-network', '--json'], root)
  assert.strictEqual(allowed.status, 0, allowed.stderr)
  const report = JSON.parse(allowed.stdout)
  assert.deepStrictEqual(report.stages, ['translate', 'replace'])
  assert.deepStrictEqual(report.results.map(item => item.command), ['translate', 'replace'])
  assert.strictEqual(report.results[1].written, true)
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'i18n/sent.json'), 'utf8')), [
    { key: 'home.hello', source: '你好', locales: ['en'] }
  ])
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8'))['home.hello'], 'Hello')
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), [
    "import { t } from './i18n'",
    "const message = t('home.hello')",
    'export default message',
    ''
  ].join('\n'))
})

test('run --collect --translate translates the collected catalog and leaves source unchanged', { timeout: 20000 }, () => {
  const root = tempProject('i18n-run-both-')
  webpackWorkflow(root)
  const before = fs.readFileSync(path.join(root, 'src/app.js'))
  const result = run(['run', '--translate', '--collect', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.stages, ['collect', 'translate'])
  assert.deepStrictEqual(report.results.map(item => item.command), ['collect', 'translate'])
  assert.strictEqual(report.results[1].ok, true)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'src/app.js')), before)
  const messages = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/zh.json'), 'utf8'))
  const [key, text] = Object.entries(messages)[0]
  assert.strictEqual(text, '你好')
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8'))[key], 'Hello')
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/orphan.js'), 'utf8'), 'module.exports = "孤儿词条"\n')
})

test('run --collect --replace previews the collected source until --write commits it', { timeout: 20000 }, () => {
  const root = tempProject('i18n-run-collect-replace-')
  webpackWorkflow(root)
  const before = fs.readFileSync(path.join(root, 'src/app.js'))
  const preview = run(['run', '--collect', '--replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const dry = JSON.parse(preview.stdout)
  assert.deepStrictEqual(dry.stages, ['collect', 'replace'])
  assert.strictEqual(dry.results[1].command, 'replace')
  assert.strictEqual(dry.results[1].dryRun, true)
  assert.strictEqual(dry.results[1].written, false)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'src/app.js')), before)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/en.json')), false)

  const written = run(['run', '--replace', '--adapter', 'js', '--write', '--collect', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  const report = JSON.parse(written.stdout)
  assert.deepStrictEqual(report.stages, ['collect', 'replace'])
  assert.strictEqual(report.results[1].written, true)
  const messages = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/zh.json'), 'utf8'))
  const [key, text] = Object.entries(messages)[0]
  assert.strictEqual(text, '你好')
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), [
    "const { t } = require('./i18n')",
    `const message = t('${key}')`,
    'module.exports = message',
    ''
  ].join('\n'))
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/en.json')), false)
})

test('run collects, translates, and writes replacements in that order', { timeout: 20000 }, () => {
  const root = tempProject('i18n-run-full-')
  webpackWorkflow(root)
  const result = run([
    'run',
    '--replace',
    '--adapter', 'js',
    '--write',
    '--translate',
    '--collect',
    '--json'
  ], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.stages, ['collect', 'translate', 'replace'])
  assert.deepStrictEqual(report.results.map(item => item.command), ['collect', 'translate', 'replace'])
  assert.strictEqual(report.results[2].dryRun, false)
  assert.strictEqual(report.results[2].written, true)
  const messages = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/zh.json'), 'utf8'))
  assert.strictEqual(Object.keys(messages).length, 1)
  const [key, text] = Object.entries(messages)[0]
  assert.strictEqual(text, '你好')
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), [
    "const { t } = require('./i18n')",
    `const message = t('${key}')`,
    'module.exports = message',
    ''
  ].join('\n'))
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8'))[key], 'Hello')
  const recorded = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/replacements.json'), 'utf8'))
  assert.strictEqual(recorded.version, 1)
  assert.strictEqual(recorded.adapter, 'js')
  assert.strictEqual(recorded.replacements.length, 1)
  assert.strictEqual(recorded.replacements[0].key, key)
  assert.strictEqual(recorded.replacements[0].call, `t('${key}')`)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/orphan.js'), 'utf8'), 'module.exports = "孤儿词条"\n')
})

test('a failed write through run restores the project and exits with the storage code', () => {
  const root = tempProject('i18n-run-rollback-')
  const source = jsFixture(root)
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
  const before = snapshotFiles(root)
  const result = run(['run', '--replace', '--adapter', 'js', '--write', '--json'], root, ['-r', hook])
  assert.strictEqual(result.status, 6, result.stderr)
  assert.match(result.stderr, /^storage: /)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'run')
  assert.strictEqual(report.ok, false)
  assert.strictEqual(report.failure, 'storage')
  assert.strictEqual(report.results.length, 1)
  assert.strictEqual(report.results[0].failure, 'storage')
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), source)
  for (const [file, bytes] of before) {
    if (file === hook) continue
    assert.deepStrictEqual(fs.readFileSync(file), bytes)
  }
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/replacements.json')), false)
})
