/**
 * Webpack runtime collection end-to-end regression (issue 09).
 * Seams: CLI collect/build, formal collection outputs, session isolation, root regression gate.
 */
const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { collect } = require('../cli/collect')
const { loadConfig } = require('../mycommon/config')
const {
  formalOutputsSemanticallyEqual,
  readFormalCollectionOutputs,
  verifyFormalCollectionOutputs
} = require('../mycommon/formal-collection-compare')
const { getSession } = require('../mycommon/session')
const { keyFor } = require('../mycommon/store')
const {
  assertLangUnchanged,
  keyForSource,
  seedSourceCatalog,
  snapshotLangTree
} = require('./build-test-helpers')
const { assertSourcesUnchanged, snapshotSources } = require('./source-snapshot')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')
const workspaceRoot = path.resolve(__dirname, '../../..')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function writeFile(root, name, contents) {
  const file = path.join(root, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
  return file
}

function writeWebpackConfig(root, {
  entry = './src/app.js',
  mode = 'development',
  extraPlugins = ''
} = {}) {
  writeFile(root, 'webpack.config.js', `const path = require('path')
const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: ${JSON.stringify(mode)},
  devtool: false,
  entry: ${JSON.stringify(entry)},
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  module: { rules: [{ test: /\\.[cm]?[jt]sx?$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin()${extraPlugins}],
  watchOptions: { aggregateTimeout: 50, poll: 100 }
}
`)
}

function writeCollectProject(root, {
  files = {
    'src/app.js': 'module.exports = function label() {\n  return "你好"\n}\n',
    'src/orphan.js': 'module.exports = function orphan() {\n  return "不可达文案"\n}\n'
  },
  configSource = 'module.exports = {}\n',
  entry = './src/app.js',
  mode = 'development',
  extraPlugins = ''
} = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  for (const [name, contents] of Object.entries(files)) {
    writeFile(root, name, contents)
  }
  writeFile(root, 'i18n-collect.config.js', configSource)
  writeWebpackConfig(root, { entry, mode, extraPlugins })
}

function writeBuildProject(root, {
  source = 'const { t } = require("./i18n.js")\nmodule.exports = function label() {\n  return "你好"\n}\n',
  files = {},
  mode = 'production',
  configSource = [
    'module.exports = {',
    '  buildReplacement: {',
    '    enabled: true,',
    '    adapter: "js",',
    '    runtimeModule: "src/i18n.js",',
    '    runtimeExport: "t"',
    '  }',
    '}',
    ''
  ].join('\n')
} = {}) {
  writeFile(root, 'src/app.js', source)
  writeFile(root, 'src/i18n.js', [
    'function t(key) { return key }',
    'module.exports = { t }',
    ''
  ].join('\n'))
  for (const [name, contents] of Object.entries(files)) {
    writeFile(root, name, contents)
  }
  writeFile(root, 'i18n-collect.config.js', configSource)
  writeWebpackConfig(root, { mode })
}

function catalogMessages(root) {
  return JSON.parse(
    fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json'), 'utf8')
  ).messages
}

function analysisReport(root) {
  return JSON.parse(
    fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json'), 'utf8')
  )
}

function applicationSnapshot(root) {
  return snapshotSources(root, {
    skipNames: ['node_modules', 'dist', 'lang'],
    extensions: /\.(js|jsx|ts|tsx|vue|html|css|scss|sass|less|styl|json)$/i
  })
}

test('unreachable modules never enter the runtime catalog', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-unreachable-'))
  writeCollectProject(root)
  const result = run(['collect', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const messages = catalogMessages(root)
  assert.deepStrictEqual(messages, { [keyFor('你好')]: '你好' })
  assert.ok(!Object.values(messages).includes('不可达文案'))
  const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'lang/zh_hash.json'), 'utf8'))
  assert.ok(!Object.values(dictionary).includes('不可达文案'))
})

test('watch removal or reachability changes remove stale findings', { timeout: 120000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-watch-'))
  writeCollectProject(root, {
    files: {
      'src/app.js': 'require("./side")\nrequire("./drop")\nmodule.exports = function label() {\n  return "你好"\n}\n',
      'src/side.js': 'module.exports = function side() {\n  return "侧栏"\n}\n',
      'src/drop.js': 'module.exports = function drop() {\n  return "将删除"\n}\n'
    }
  })
  const outcome = await collect(['--watch', '--json', '--cwd', root])
  assert.ok(outcome.watch)
  try {
    await outcome.watch.waitForOkRound(0)
    assert.deepStrictEqual(catalogMessages(root), {
      [keyFor('你好')]: '你好',
      [keyFor('侧栏')]: '侧栏',
      [keyFor('将删除')]: '将删除'
    })

    const okBefore = outcome.watch.state.okRounds
    writeFile(
      root,
      'src/app.js',
      'module.exports = function label() {\n  return "你好"\n}\n'
    )
    fs.rmSync(path.join(root, 'src/drop.js'))
    await outcome.watch.waitForOkRound(okBefore)
    assert.deepStrictEqual(catalogMessages(root), { [keyFor('你好')]: '你好' })
    assert.ok(!Object.values(catalogMessages(root)).includes('侧栏'))
    assert.ok(!Object.values(catalogMessages(root)).includes('将删除'))
  } finally {
    await outcome.watch.close()
  }
})

test('failed compilations do not publish partial snapshots or formal outputs', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-fail-'))
  writeCollectProject(root, {
    files: {
      'src/app.js': 'module.exports = function label() {\n  return "你好"\n}\n'
    }
  })
  const ok = run(['collect', '--json'], root)
  assert.strictEqual(ok.status, 0, ok.stderr)
  const catalogPath = path.join(root, 'lang/catalog/source-catalog.json')
  const analysisPath = path.join(root, 'lang/catalog/analysis-report.json')
  const dictionaryPath = path.join(root, 'lang/zh_hash.json')
  const beforeCatalog = fs.readFileSync(catalogPath)
  const beforeAnalysis = fs.readFileSync(analysisPath)
  const beforeDictionary = fs.readFileSync(dictionaryPath)

  writeFile(root, 'src/app.js', 'module.exports = "你好"\n%%%\n')
  const failed = run(['collect', '--json'], root)
  assert.notStrictEqual(failed.status, 0, failed.stdout)
  assert.deepStrictEqual(fs.readFileSync(catalogPath), beforeCatalog)
  assert.deepStrictEqual(fs.readFileSync(analysisPath), beforeAnalysis)
  assert.deepStrictEqual(fs.readFileSync(dictionaryPath), beforeDictionary)
})

test('collection and build replacement use the same findings', { timeout: 90000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-same-'))
  writeBuildProject(root)
  const collected = run(['collect', '--json'], root)
  assert.strictEqual(collected.status, 0, collected.stderr)
  const collectedKey = Object.keys(catalogMessages(root))[0]
  assert.strictEqual(catalogMessages(root)[collectedKey], '你好')

  const beforeSource = applicationSnapshot(root)
  const langBefore = snapshotLangTree(root)
  const built = run(['build', '--json'], root)
  assert.strictEqual(built.status, 0, built.stderr)
  const key = keyForSource(root, '你好')
  assert.strictEqual(key, collectedKey)
  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(bundle, new RegExp(key.replace(/\./g, '\\.')))
  assert.doesNotMatch(bundle, /你好/)
  assertSourcesUnchanged(beforeSource, root)
  assertLangUnchanged(langBefore, root)
})

test('collect --replace publishes collection outputs and immediately replaces the emitted bundle', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-collect-replace-'))
  writeBuildProject(root)
  const beforeSource = applicationSnapshot(root)

  const result = run(['collect', '--replace', '--json'], root)

  assert.strictEqual(result.status, 0, result.stderr)
  const key = keyForSource(root, '你好')
  assert.deepStrictEqual(catalogMessages(root), { [key]: '你好' })
  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(bundle, new RegExp(key.replace(/\./g, '\\.')))
  assert.doesNotMatch(bundle, /你好/)
  assertSourcesUnchanged(beforeSource, root)
})

test('plain collect publishes collection outputs without replacing its disposable compilation', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-collect-only-'))
  writeBuildProject(root)

  const result = run(['collect', '--json'], root)

  assert.strictEqual(result.status, 0, result.stderr)
  assert.ok(!fs.existsSync(path.join(root, 'dist/bundle.js')))
})

test('standalone HTML and CSS never enter the runtime catalog', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-audit-'))
  writeCollectProject(root, {
    files: {
      'src/app.js': 'module.exports = function label() {\n  return "你好"\n}\n',
      'public/index.html': '<!DOCTYPE html><html><body><p>欢迎页</p></body></html>\n',
      'legacy/badge.css': '.x::before { content: "角标"; }\n'
    },
    configSource: `module.exports = {
  staticAudit: {
    include: ['public/**/*.html', 'legacy/**/*.css']
  }
}
`
  })
  const result = run(['collect', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr + result.stdout)
  const messages = catalogMessages(root)
  assert.deepStrictEqual(messages, { [keyFor('你好')]: '你好' })
  for (const text of ['欢迎页', '角标']) {
    assert.ok(!Object.values(messages).includes(text), text)
  }
  const report = analysisReport(root)
  assert.ok(report.auditFindings.some(item => item.text === '欢迎页'))
  assert.ok(report.auditFindings.some(item => item.text === '角标'))
  assert.ok(report.auditFindings.every(item => item.key === undefined))
})

test('key conflicts fail closed without publishing formal outputs', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-key-'))
  writeCollectProject(root, {
    files: {
      'src/app.js': [
        'require("./other")',
        'module.exports = /* i18n-key: shared.title */ "首页"',
        ''
      ].join('\n'),
      'src/other.js': 'module.exports = /* i18n-key: shared.title */ "主页"\n'
    }
  })
  const conflict = run(['collect', '--json'], root)
  assert.notStrictEqual(conflict.status, 0, conflict.stdout)
  assert.match(`${conflict.stderr}\n${conflict.stdout}`, /conflict|hash collision|shared\.title/i)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/source-catalog.json')))
})

test('placeholder conflicts fail closed without publishing formal outputs', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-ph-'))
  writeCollectProject(root, {
    files: {
      'src/app.js': "module.exports = () => t('terms.notice', { link, policy })\n",
      'lang/catalog/explicit-messages.json': `${JSON.stringify({
        version: 1,
        messages: [
          { key: 'terms.notice', source: '请阅读我们的{terms}与{privacy}' }
        ]
      }, null, 2)}\n`
    }
  })
  const placeholder = run(['collect', '--json'], root)
  assert.notStrictEqual(placeholder.status, 0, placeholder.stdout)
  assert.match(`${placeholder.stderr}\n${placeholder.stdout}`, /placeholder/i)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/source-catalog.json')))
})

test('unsafe replacement fails closed without emitting a formal bundle', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-unsafe-'))
  writeBuildProject(root, {
    source: [
      'const { t } = require("./i18n.js")',
      'module.exports = {',
      '  table: { "你好": 1 },',
      '  label: "欢迎"',
      '}',
      ''
    ].join('\n')
  })
  seedSourceCatalog(root)
  const before = applicationSnapshot(root)
  const langBefore = snapshotLangTree(root)
  const unsafe = run(['build', '--json'], root)
  assert.notStrictEqual(unsafe.status, 0, unsafe.stdout)
  assert.match(`${unsafe.stderr}\n${unsafe.stdout}`, /object key|supported semantic position|fail-closed|unsafe/i)
  assert.ok(!fs.existsSync(path.join(root, 'dist/bundle.js')))
  assertSourcesUnchanged(before, root)
  assertLangUnchanged(langBefore, root)
})

test('collect and build do not modify application source', { timeout: 90000 }, () => {
  const collectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-collect-ro-'))
  writeCollectProject(collectRoot, {
    files: {
      'src/app.js': 'module.exports = function label() {\n  return "你好"\n}\n'
    }
  })
  const collectBefore = applicationSnapshot(collectRoot)
  const collected = run(['collect', '--json'], collectRoot)
  assert.strictEqual(collected.status, 0, collected.stderr)
  assertSourcesUnchanged(collectBefore, collectRoot)

  const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-build-ro-'))
  writeBuildProject(buildRoot)
  seedSourceCatalog(buildRoot)
  const buildBefore = applicationSnapshot(buildRoot)
  const built = run(['build', '--json'], buildRoot)
  assert.strictEqual(built.status, 0, built.stderr)
  assertSourcesUnchanged(buildBefore, buildRoot)
})

test('translation providers, network requests, and credentials do not enter compilation', {
  timeout: 90000
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-translate-'))
  const marker = path.join(root, 'provider-loaded.marker')
  writeFile(root, 'i18n/provider.js', `const fs = require('fs')
const path = require('path')
fs.writeFileSync(path.join(__dirname, '..', 'provider-loaded.marker'), 'loaded')
module.exports = {
  network: true,
  async translate() {
    throw new Error('provider must not run during compilation')
  }
}
`)
  writeBuildProject(root, {
    configSource: [
      'module.exports = {',
      '  translationProvider: "i18n/provider.js",',
      '  targetLocales: ["en"],',
      '  buildReplacement: {',
      '    enabled: true,',
      '    adapter: "js",',
      '    runtimeModule: "src/i18n.js",',
      '    runtimeExport: "t"',
      '  }',
      '}',
      ''
    ].join('\n')
  })

  const collected = run(['collect', '--json'], root)
  assert.strictEqual(collected.status, 0, collected.stderr)
  assert.ok(!fs.existsSync(marker), 'collect must not load the translation provider')

  seedSourceCatalog(root)
  if (fs.existsSync(marker)) fs.unlinkSync(marker)
  const built = run(['build', '--json'], root)
  assert.strictEqual(built.status, 0, built.stderr)
  assert.ok(!fs.existsSync(marker), 'build must not load the translation provider')

  const networkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-net-'))
  writeCollectProject(networkRoot, {
    files: {
      'src/app.js': 'module.exports = function label() {\n  return "你好"\n}\n'
    },
    extraPlugins: `, {
  apply(compiler) {
    compiler.hooks.compilation.tap('ProbeNetwork', () => {
      require('https').request('https://example.invalid/')
    })
  }
}`
  })
  const blocked = run(['collect', '--json'], networkRoot)
  assert.notStrictEqual(blocked.status, 0, blocked.stdout)
  assert.match(
    `${blocked.stderr}\n${blocked.stdout}`,
    /does not make network requests|https\.request/i
  )
  assert.ok(!fs.existsSync(path.join(networkRoot, 'lang/catalog/source-catalog.json')))
})

test('schemas and output ordering are stable, and production verification is semantic', {
  timeout: 60000
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-schema-'))
  writeCollectProject(root, {
    files: {
      'src/app.js': [
        'module.exports = {',
        '  a: "你好",',
        '  b: "世界"',
        '}',
        ''
      ].join('\n')
    }
  })
  const first = run(['collect', '--json'], root)
  assert.strictEqual(first.status, 0, first.stderr)
  const catalogA = fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json'), 'utf8')
  const reportA = fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json'), 'utf8')
  const second = run(['collect', '--json'], root)
  assert.strictEqual(second.status, 0, second.stderr)
  assert.strictEqual(
    fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json'), 'utf8'),
    catalogA
  )
  assert.strictEqual(
    fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json'), 'utf8'),
    reportA
  )

  const config = loadConfig({ root })
  const committed = readFormalCollectionOutputs(root, config)
  assert.strictEqual(committed.catalog.version, 1)
  assert.strictEqual(committed.report.version, 2)
  assert.ok(Array.isArray(committed.report.dynamicMessageCandidates))
  assert.ok(!Object.prototype.hasOwnProperty.call(committed.report, 'explicitRequiredFindings'))
  const keys = Object.keys(committed.catalog.messages)
  assert.deepStrictEqual(keys, [...keys].sort((left, right) => left.localeCompare(right)))
  const runtimePaths = committed.report.runtimeMessages.map(item => [
    item.location.path,
    item.semanticRole,
    item.location.start.line,
    item.location.start.column,
    item.text
  ])
  assert.deepStrictEqual(
    runtimePaths,
    [...runtimePaths].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  )

  const current = {
    catalog: committed.catalog,
    report: {
      ...committed.report,
      environment: { configHash: 'fresh', parserVersion: 'other', webpack: '5.99.0' }
    }
  }
  assert.ok(formalOutputsSemanticallyEqual(committed, current))
  assert.ok(verifyFormalCollectionOutputs(committed, current))
  current.catalog = {
    version: 1,
    messages: { ...committed.catalog.messages, [keyFor('额外')]: '额外' }
  }
  assert.ok(!verifyFormalCollectionOutputs(committed, current))
})

test('multiple compilers do not share implicit collection state', { timeout: 120000 }, () => {
  const left = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-left-'))
  const right = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-wrc-right-'))
  writeCollectProject(left, {
    files: { 'src/app.js': 'module.exports = function label() {\n  return "左侧"\n}\n' }
  })
  writeCollectProject(right, {
    files: { 'src/app.js': 'module.exports = function label() {\n  return "右侧"\n}\n' }
  })

  const webpack = require('webpack')
  const leftConfig = require(path.join(left, 'webpack.config.js'))
  const rightConfig = require(path.join(right, 'webpack.config.js'))
  const leftCompiler = webpack(leftConfig)
  const rightCompiler = webpack(rightConfig)
  assert.notStrictEqual(getSession(leftCompiler), getSession(rightCompiler))

  const leftResult = run(['collect', '--json'], left)
  const rightResult = run(['collect', '--json'], right)
  assert.strictEqual(leftResult.status, 0, leftResult.stderr)
  assert.strictEqual(rightResult.status, 0, rightResult.stderr)
  assert.deepStrictEqual(catalogMessages(left), { [keyFor('左侧')]: '左侧' })
  assert.deepStrictEqual(catalogMessages(right), { [keyFor('右侧')]: '右侧' })
  assert.ok(!Object.values(catalogMessages(left)).includes('右侧'))
  assert.ok(!Object.values(catalogMessages(right)).includes('左侧'))
})

test('root regression script includes package tests and demo production builds', () => {
  const workspace = require(path.join(workspaceRoot, 'package.json'))
  assert.strictEqual(
    workspace.scripts.regression,
    'npm test && npm run build && npm run build-vue3-demo && npm run build-react-demo && node scripts/verify-hybrid-localization.js --skip-package-tests'
  )
  const vue2 = require(path.join(workspaceRoot, 'apps/demo/package.json'))
  const vue3 = require(path.join(workspaceRoot, 'apps/vue3-demo/package.json'))
  assert.ok(vue2.scripts.build)
  assert.ok(vue2.scripts.collect)
  assert.ok(vue3.scripts.build)
  assert.ok(vue3.scripts.collect)
})
