const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { seedSourceCatalog } = require('./build-test-helpers')

const bin = path.join(__dirname, '../bin/i18n-collect.js')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function tempProject(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function jsFixture(root) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src/app.js'),
    "const { t } = require('./i18n')\nmodule.exports = '你好'\n"
  )
  fs.writeFileSync(path.join(root, 'src/i18n.js'), 'function t(key) { return key }\nmodule.exports = { t }\n')
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), [
    'module.exports = {',
    '  targetLocales: ["en"],',
    '  translationProvider: "provider.js",',
    '  buildReplacement: {',
    '    enabled: true,',
    '    adapter: "js",',
    '    runtimeModule: "src/i18n.js",',
    '    runtimeExport: "t"',
    '  }',
    '}',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'provider.js'), [
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
  seedSourceCatalog(root, { writeLocaleCatalog: true })
}

test('run help no longer advertises collect as a live stage', () => {
  const help = run(['run', '--help'])
  assert.strictEqual(help.status, 0)
  assert.strictEqual(help.stderr, '')
  assert.match(help.stdout, /i18n-collect run/)
  assert.match(help.stdout, /collect stage is removed|Removed collect|use i18n-collect scan/i)
  assert.match(help.stdout, /--translate/)
  assert.match(help.stdout, /--replace/)
  assert.match(help.stdout, /--write/)
})

test('run --collect fails with migration guidance', () => {
  const root = tempProject('i18n-run-collect-gone-')
  jsFixture(root)
  const result = run(['run', '--collect', '--json'], root)
  assert.strictEqual(result.status, 1, result.stderr)
  assert.match(result.stderr, /run --collect is removed|collect is removed/i)
  assert.match(result.stderr, /scan/i)
})

test('run requires a selected stage and rejects options for a stage that is off', () => {
  const root = tempProject('i18n-run-config-')
  const missing = run(['run', '--json'], root)
  assert.strictEqual(missing.status, 1)
  assert.match(missing.stderr, /run requires --collect, --translate, or --replace/)
  const extra = run(['run', '--translate', '--adapter', 'js', '--json'], root)
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
})

test('run --translate fills a catalog without rewriting source', { timeout: 20000 }, () => {
  const root = tempProject('i18n-run-translate-')
  jsFixture(root)
  const before = fs.readFileSync(path.join(root, 'src/app.js'))
  const result = run(['run', '--translate', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.stages, ['translate'])
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js')).equals(before), true)
  assert.ok(fs.existsSync(path.join(root, 'lang/catalog/en.json')))
})

test('run --translate --replace --write commits replacements after translation', { timeout: 30000 }, () => {
  const root = tempProject('i18n-run-translate-replace-')
  jsFixture(root)
  const result = run([
    'run',
    '--translate',
    '--replace',
    '--adapter',
    'js',
    '--write',
    '--json'
  ], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.stages, ['translate', 'replace'])
  assert.match(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), /t\(/)
})
