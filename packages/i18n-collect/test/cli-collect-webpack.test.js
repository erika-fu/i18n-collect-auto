const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { keyFor } = require('../mycommon/store')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function writeCollectProject(root, {
  entry = './src/app.js',
  files = {
    'src/app.js': 'module.exports = function label() {\n  return "你好"\n}\n',
    'src/orphan.js': 'module.exports = function orphan() {\n  return "不可达文案"\n}\n'
  },
  configSource = 'module.exports = {}\n'
} = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), configSource)
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: 'development',
  devtool: false,
  entry: ${JSON.stringify(entry)},
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist') },
  module: { rules: [{ test: /\\.[cm]?[jt]sx?$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin()]
}
`)
}

test('collect runs a Webpack compilation and publishes reachable runtime messages', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-ok-'))
  writeCollectProject(root)
  const result = run(['collect', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.command, 'collect')
  const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'lang/zh_hash.json'), 'utf8'))
  assert.deepStrictEqual(dictionary, { [keyFor('你好')]: '你好' })
  assert.ok(!Object.values(dictionary).includes('不可达文案'))
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json'), 'utf8'))
  assert.deepStrictEqual(catalog, {
    version: 1,
    messages: { [keyFor('你好')]: '你好' }
  })
  assert.ok(!Object.values(catalog.messages).includes('不可达文案'))
  const analysis = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json'), 'utf8'))
  assert.strictEqual(analysis.version, 1)
  assert.ok(Array.isArray(analysis.runtimeMessages))
  assert.ok(Array.isArray(analysis.auditFindings))
  assert.ok(Array.isArray(analysis.diagnostics))
  assert.ok(analysis.coverage)
  assert.ok(analysis.runtimeMessages.some(item => item.text === '你好'))
})

test('collection failures leave previous dictionary outputs unchanged', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-fail-'))
  writeCollectProject(root)
  const ok = run(['collect', '--json'], root)
  assert.strictEqual(ok.status, 0, ok.stderr)
  const dictionaryPath = path.join(root, 'lang/zh_hash.json')
  const catalogPath = path.join(root, 'lang/catalog/source-catalog.json')
  const analysisPath = path.join(root, 'lang/catalog/analysis-report.json')
  const before = fs.readFileSync(dictionaryPath)
  const beforeCatalog = fs.readFileSync(catalogPath)
  const beforeAnalysis = fs.readFileSync(analysisPath)
  fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = "你好"\n%%%\n')
  const failed = run(['collect', '--json'], root)
  assert.notStrictEqual(failed.status, 0, failed.stdout)
  assert.deepStrictEqual(fs.readFileSync(dictionaryPath), before)
  assert.deepStrictEqual(fs.readFileSync(catalogPath), beforeCatalog)
  assert.deepStrictEqual(fs.readFileSync(analysisPath), beforeAnalysis)
})

test('collect publishes staticAudit findings without catalog keys and still succeeds', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-static-audit-'))
  writeCollectProject(root, {
    files: {
      'src/app.js': 'module.exports = function label() {\n  return "你好"\n}\n',
      'public/index.html': [
        '<!DOCTYPE html>',
        '<html><body>',
        '  <!-- i18n-ignore: brand stays Chinese -->',
        '  <p title="品牌">欢迎</p>',
        '  <p>未忽略</p>',
        '</body></html>',
        ''
      ].join('\n'),
      'legacy/badge.css': '.x::before { content: "角标"; }\n',
      'legacy/theme.scss': '.y::before { content: "待审"; }\n'
    },
    configSource: `module.exports = {
  staticAudit: {
    include: ['public/**/*.html', 'legacy/**/*.css', 'legacy/**/*.scss']
  }
}
`
  })
  const result = run(['collect', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr + result.stdout)
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json'), 'utf8'))
  assert.deepStrictEqual(catalog, {
    version: 1,
    messages: { [keyFor('你好')]: '你好' }
  })
  const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'lang/zh_hash.json'), 'utf8'))
  for (const text of ['欢迎', '未忽略', '品牌', '角标', '待审']) {
    assert.ok(!Object.values(catalog.messages).includes(text), text)
    assert.ok(!Object.values(dictionary).includes(text), text)
  }
  const analysis = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json'), 'utf8'))
  assert.ok(analysis.runtimeMessages.some(item => item.text === '你好'))
  const byText = new Map(analysis.auditFindings.map(item => [item.text, item]))
  assert.strictEqual(byText.get('欢迎').disposition, 'unresolved')
  assert.strictEqual(byText.get('未忽略').disposition, 'unresolved')
  assert.strictEqual(byText.get('品牌').disposition, 'intentionally-ignored')
  assert.strictEqual(byText.get('品牌').ignoreReason, 'brand stays Chinese')
  assert.strictEqual(byText.get('角标').semanticRole, 'css-generated-content')
  assert.strictEqual(byText.get('待审').semanticRole, 'css-preprocessor-candidate')
  assert.strictEqual(byText.get('待审').disposition, 'needs-review')
  assert.ok(analysis.auditFindings.every(item => item.key === undefined))
})

test('collect fails closed when a staticAudit input is missing and keeps prior outputs', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-static-missing-'))
  writeCollectProject(root, {
    configSource: `module.exports = {
  staticAudit: { include: ['public/index.html'] }
}
`
  })
  const ok = run(['collect', '--json'], root)
  assert.notStrictEqual(ok.status, 0, ok.stdout)
  assert.match(`${ok.stderr}\n${ok.stdout}`, /static audit|missing/i)

  writeCollectProject(root)
  const published = run(['collect', '--json'], root)
  assert.strictEqual(published.status, 0, published.stderr)
  const catalogPath = path.join(root, 'lang/catalog/source-catalog.json')
  const analysisPath = path.join(root, 'lang/catalog/analysis-report.json')
  const beforeCatalog = fs.readFileSync(catalogPath)
  const beforeAnalysis = fs.readFileSync(analysisPath)
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    `module.exports = {
  staticAudit: { include: ['public/missing.html'] }
}
`
  )
  const failed = run(['collect', '--json'], root)
  assert.notStrictEqual(failed.status, 0, failed.stdout)
  assert.match(`${failed.stderr}\n${failed.stdout}`, /static audit|missing/i)
  assert.deepStrictEqual(fs.readFileSync(catalogPath), beforeCatalog)
  assert.deepStrictEqual(fs.readFileSync(analysisPath), beforeAnalysis)
})
