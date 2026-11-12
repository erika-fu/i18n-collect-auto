const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const {
  COLLECT_REMOVED,
  LEGACY_IDENTITY_METADATA,
  PLUGIN_COLLECTION_REMOVED,
  PRUNE_ORPHANED_REMOVED,
  VERIFY_REMOVED,
  assertNoLegacyIdentityMetadata,
  hasOccurrenceIdentity
} = require('../mycommon/legacy-contraction')
const { loadConfig } = require('../mycommon/config')
const { analyzeProject, buildSourceCatalog } = require('../mycommon/project-analysis')
const { extractCss } = require('../myloader/extract-css')
const { keyFor } = require('../mycommon/store')

const bin = path.join(__dirname, '../bin/i18n-collect.js')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

test('collect fails with migration guidance instead of allocating occurrence identities', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-contract-collect-'))
  fs.writeFileSync(path.join(root, 'webpack.config.js'), 'module.exports = {}\n')
  const result = run(['collect', '--json'], root)
  assert.strictEqual(result.status, 1, result.stderr)
  assert.match(result.stderr, /collect is removed/i)
  assert.match(result.stderr, /scan/i)
  assert.match(result.stderr, /migrate-keys/i)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.strictEqual(report.command, 'collect')
  assert.strictEqual(report.message, COLLECT_REMOVED)
})

test('verify fails with migration guidance pointing at scan and check', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-contract-verify-'))
  const result = run(['verify', '--json'], root)
  assert.strictEqual(result.status, 1, result.stderr)
  assert.match(result.stderr, /verify is removed/i)
  assert.match(result.stderr, /scan/i)
  assert.match(result.stderr, /check/i)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.message, VERIFY_REMOVED)
})

test('run fails with migration guidance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-contract-run-'))
  const result = run(['run', '--collect', '--json'], root)
  assert.strictEqual(result.status, 1, result.stderr)
  assert.match(result.stderr, /run is removed/i)
  assert.match(result.stderr, /scan/i)
})
test('config rejects pruneOrphaned with migration guidance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-contract-prune-'))
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { pruneOrphaned: true }\n'
  )
  assert.throws(
    () => loadConfig({ root }),
    error => {
      assert.match(error.message, /pruneOrphaned/)
      assert.match(error.message, /removed|migrate|scan|translate/i)
      assert.ok(error.message.includes(PRUNE_ORPHANED_REMOVED) || /pruneOrphaned is removed/.test(error.message))
      return true
    }
  )
})

test('catalog schemas reject per-occurrence identity metadata with a migration diagnostic', () => {
  const metadata = {
    version: 3,
    sourceLocale: 'zh',
    format: 'json',
    entries: {
      'auto.01M6D71KFV03PK11J86A275RFG': {
        source: '你好',
        status: 'active',
        occurrences: [
          {
            id: 'e2ccbe3fba3b67a8',
            semanticHost: 'src/a.js::script',
            childRole: 'script-string',
            localContext: 'sibling:0',
            location: {
              path: 'src/a.js',
              kind: 'script-string',
              start: { line: 1, column: 0 },
              end: { line: 1, column: 2 }
            }
          }
        ]
      }
    }
  }
  assert.strictEqual(hasOccurrenceIdentity(metadata), true)
  assert.throws(
    () => assertNoLegacyIdentityMetadata(metadata),
    error => {
      assert.strictEqual(error.message, LEGACY_IDENTITY_METADATA)
      assert.match(error.message, /migrate-keys/)
      return true
    }
  )
})

test('MyI18nPlugin refuses catalog collection with migration guidance', () => {
  const MyI18nPlugin = require('../myplugin')
  const plugin = new MyI18nPlugin()
  const compiler = { hooks: {} }
  compiler.root = compiler
  assert.throws(
    () => plugin.apply(compiler),
    error => {
      assert.strictEqual(error.message, PLUGIN_COLLECTION_REMOVED)
      return true
    }
  )
})

test('buildSourceCatalog never admits HTML or style audit findings', () => {
  const analysis = analyzeProject({
    files: [
      { path: 'src/page.html', source: '<p>页面文案</p>\n' },
      { path: 'src/app.css', source: '.x::before { content: "样式文案"; }\n' },
      { path: 'src/theme.scss', source: '.y::after { content: "预处理"; }\n' },
      { path: 'src/app.js', source: 'module.exports = "你好"\n' }
    ],
    config: {
      root: os.tmpdir(),
      include: [],
      exclude: [],
      contextFilters: [],
      attributeAllowlist: ['title', 'placeholder', 'alt', 'aria-label', 'value'],
      styleExtensions: ['.css', '.scss'],
      vueVersion: null,
      catalogDir: 'lang/catalog',
      sourceLocale: 'zh'
    }
  })
  const catalog = buildSourceCatalog(analysis)
  assert.deepStrictEqual(catalog, { [keyFor('你好')]: '你好' })
  assert.ok(analysis.auditFindings.some(item => item.semanticRole === 'static-html-text'))
  assert.ok(analysis.auditFindings.some(item => item.semanticRole === 'css-generated-content'))
  assert.ok(analysis.auditFindings.some(item => item.semanticRole === 'css-preprocessor-candidate'))
})

test('extractCss no longer runs full preprocessor Style IR collection', () => {
  const resource = {
    projectPath: 'src/theme.scss',
    lang: 'scss',
    block: 'style',
    styleIndex: 0,
    identity: 'src/theme.scss::style'
  }
  const result = extractCss({
    source: '.banner::before { content: "样式"; }\n',
    resource,
    config: { styleExtensions: ['.css', '.scss'] }
  })
  assert.deepStrictEqual(result.entries, [])
  assert.ok(result.warnings.length >= 1)
  assert.match(result.warnings[0].message, /scss|Style IR|audit|does not parse/i)
})
