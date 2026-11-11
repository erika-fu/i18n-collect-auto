const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { keyFor } = require('../mycommon/store')
const { installVue3 } = require('./vue3-fixture')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')
const HELLO = keyFor('你好')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function writeScanProject(root, { source = 'const message = "你好"\n', files = {} } = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = { include: ["src"] }\n')
}

test('scan help describes source analysis outputs', () => {
  const result = run(['scan', '--help'])
  assert.strictEqual(result.status, 0, result.stderr)
  assert.match(result.stdout, /i18n-collect scan/)
  assert.match(result.stdout, /source catalog/)
  assert.match(result.stdout, /analysis report/)
  assert.match(result.stdout, /--json/)
})

test('scan writes a deterministic source catalog and machine-readable analysis report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-scan-'))
  writeScanProject(root, {
    source: 'const message = "你好"\nconst label = t("nav.home")\n'
  })

  const result = run(['scan', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(result.stderr, '')

  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'scan')
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.coverage, {
    sourceDiscovery: { total: 2 },
    runtimeLocalization: {
      total: 2,
      automaticallyRuntimeLocalizable: 1,
      alreadyLocalized: 1
    },
    chineseSourceAudit: {
      total: 0,
      unresolved: 0,
      needsReview: 0,
      intentionallyIgnored: 0
    }
  })

  const catalogPath = path.join(root, 'lang/catalog/source-catalog.json')
  const analysisPath = path.join(root, 'lang/catalog/analysis-report.json')
  assert.ok(fs.existsSync(catalogPath))
  assert.ok(fs.existsSync(analysisPath))
  assert.strictEqual(report.sourceCatalog, 'lang/catalog/source-catalog.json')
  assert.strictEqual(report.analysisReport, 'lang/catalog/analysis-report.json')

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  assert.deepStrictEqual(catalog, { [HELLO]: '你好' })

  const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'))
  assert.strictEqual(analysis.version, 1)
  assert.strictEqual(analysis.runtimeMessages.length, 1)
  assert.strictEqual(analysis.localizedCallFindings.length, 1)
  assert.strictEqual(analysis.localizedCallFindings[0].key, 'nav.home')
  assert.deepStrictEqual(analysis.coverage, report.coverage)
})

test('repeated scans over unchanged source produce byte-stable outputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-scan-stable-'))
  writeScanProject(root)

  const first = run(['scan', '--json'], root)
  assert.strictEqual(first.status, 0, first.stderr)
  const catalogFirst = fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json'))
  const analysisFirst = fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json'))

  const second = run(['scan', '--json'], root)
  assert.strictEqual(second.status, 0, second.stderr)
  const catalogSecond = fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json'))
  const analysisSecond = fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json'))

  assert.deepStrictEqual(catalogSecond, catalogFirst)
  assert.deepStrictEqual(analysisSecond, analysisFirst)
  assert.strictEqual(second.stdout, first.stdout)
})

test('scan classifies Vue template copy through the CLI without webpack', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-scan-vue-'))
  installVue3(root)
  writeScanProject(root, {
    source: 'module.exports = {}\n',
    files: {
      'src/App.vue': [
        '<template><p title="提示">标题</p></template>',
        '<script>export default {}</script>',
        ''
      ].join('\n')
    }
  })
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { include: ["src"], vueVersion: 3 }\n'
  )

  const result = run(['scan', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.ok(report.coverage.sourceDiscovery.total >= 2)
  assert.ok(report.coverage.runtimeLocalization.automaticallyRuntimeLocalizable >= 2)

  const analysis = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json'), 'utf8'))
  const texts = analysis.runtimeMessages.map(item => item.text).sort()
  assert.ok(texts.includes('标题'))
  assert.ok(texts.includes('提示'))
  assert.ok(analysis.runtimeMessages.every(item => item.capability === 'automatically-runtime-localizable'))
})

test('scan reports standalone HTML as audit findings without catalog keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-scan-html-'))
  writeScanProject(root, {
    source: 'const message = "你好"\n',
    files: {
      'public/index.html': [
        '<!DOCTYPE html>',
        '<html><body>',
        '  <!-- i18n-ignore: brand stays Chinese -->',
        '  <p title="品牌">欢迎</p>',
        '  <p>未忽略</p>',
        '</body></html>',
        ''
      ].join('\n')
    }
  })
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { include: ["src", "public"], attributeAllowlist: ["title"] }\n'
  )

  const result = run(['scan', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.coverage.chineseSourceAudit, {
    total: 3,
    unresolved: 2,
    needsReview: 0,
    intentionallyIgnored: 1
  })
  assert.strictEqual(report.coverage.runtimeLocalization.automaticallyRuntimeLocalizable, 1)

  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json'), 'utf8'))
  assert.deepStrictEqual(catalog, { [HELLO]: '你好' })
  assert.ok(!Object.values(catalog).includes('品牌'))
  assert.ok(!Object.values(catalog).includes('欢迎'))
  assert.ok(!Object.values(catalog).includes('未忽略'))

  const analysis = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json'), 'utf8'))
  assert.strictEqual(analysis.auditFindings.length, 3)
  const ignored = analysis.auditFindings.find(item => item.disposition === 'intentionally-ignored')
  assert.strictEqual(ignored.text, '品牌')
  assert.strictEqual(ignored.ignoreReason, 'brand stays Chinese')
  assert.strictEqual(ignored.key, undefined)
  assert.ok(analysis.auditFindings.every(item => item.capability === 'chinese-source-audit'))
  assert.ok(analysis.auditFindings.every(item => item.key === undefined))
})

test('scan reports CSS and preprocessor style audit findings without catalog keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-scan-style-'))
  writeScanProject(root, {
    source: 'const message = "你好"\n',
    files: {
      'src/theme.css': '.a::before { content: "必填"; }\n',
      'src/theme.scss': '.b::after { content: "待审"; }\n'
    }
  })
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { include: ["src"] }\n'
  )

  const result = run(['scan', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.coverage.chineseSourceAudit, {
    total: 2,
    unresolved: 1,
    needsReview: 1,
    intentionallyIgnored: 0
  })

  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json'), 'utf8'))
  assert.deepStrictEqual(catalog, { [HELLO]: '你好' })
  assert.ok(!Object.values(catalog).includes('必填'))
  assert.ok(!Object.values(catalog).includes('待审'))

  const analysis = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json'), 'utf8'))
  assert.strictEqual(analysis.auditFindings.length, 2)
  const proven = analysis.auditFindings.find(item => item.disposition === 'unresolved')
  const review = analysis.auditFindings.find(item => item.disposition === 'needs-review')
  assert.strictEqual(proven.text, '必填')
  assert.strictEqual(proven.semanticRole, 'css-generated-content')
  assert.match(proven.diagnostic, /proven|generated content/i)
  assert.strictEqual(review.text, '待审')
  assert.strictEqual(review.semanticRole, 'css-preprocessor-candidate')
  assert.match(review.diagnostic, /conservative|without semantic proof/i)
  assert.ok(analysis.auditFindings.every(item => item.key === undefined))
})

test('scan fails with an actionable diagnostic for a malformed HTML i18n-ignore', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-scan-ignore-fail-'))
  writeScanProject(root, {
    source: 'module.exports = {}\n',
    files: {
      'public/index.html': '<!-- i18n-ignore -->\n<p>文案</p>\n'
    }
  })
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { include: ["src", "public"] }\n'
  )
  const result = run(['scan', '--json'], root)
  assert.notStrictEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /i18n-ignore/)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.match(report.message, /i18n-ignore/)
})

test('collect remains operational alongside scan', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-scan-collect-'))
  writeScanProject(root)
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
  const scanResult = run(['scan', '--json'], root)
  assert.strictEqual(scanResult.status, 0, scanResult.stderr)
  const collectResult = run(['collect', '--json'], root)
  assert.strictEqual(collectResult.status, 0, collectResult.stderr)
  const collectReport = JSON.parse(collectResult.stdout)
  assert.strictEqual(collectReport.command, 'collect')
  assert.ok(collectReport.catalog.keys >= 1)
  assert.ok(fs.existsSync(path.join(root, 'lang/zh_hash.json')))
  assert.ok(fs.existsSync(path.join(root, 'lang/catalog/analysis-report.json')))
})
