const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const {
  ANALYSIS_REPORT_VERSION,
  SOURCE_CATALOG_VERSION,
  analysisReport,
  analyzeProject,
  analyzeSnapshots,
  buildSourceCatalog
} = require('../mycommon/project-analysis')
const {
  formalOutputsSemanticallyEqual,
  normalizeAnalysisReport,
  normalizeSourceCatalog,
  readFormalCollectionOutputs,
  verifyFormalCollectionOutputs
} = require('../mycommon/formal-collection-compare')
const {
  ANALYSIS_REPORT_FILE,
  SOURCE_CATALOG_FILE,
  parseSourceCatalogDocument,
  publishCollectionOutputs,
  sourceCatalogMessages,
  sourceCatalogPath,
  analysisReportPath
} = require('../mycommon/formal-outputs')
const { json } = require('../mycommon/output')
const { keyFor } = require('../mycommon/store')
const { loadConfig } = require('../mycommon/config')

test('source catalog and analysis report use independent schema versions', () => {
  const analysis = analyzeProject({
    files: [{ path: 'src/app.js', source: 'module.exports = "你好"\n' }],
    config: { attributeAllowlist: [], include: [], exclude: [], contextFilters: [] }
  })
  const catalog = buildSourceCatalog(analysis)
  const report = analysisReport(analysis)
  assert.strictEqual(catalog.version, SOURCE_CATALOG_VERSION)
  assert.strictEqual(report.version, ANALYSIS_REPORT_VERSION)
  assert.notStrictEqual(
    'SOURCE_CATALOG_VERSION' in require('../mycommon/project-analysis')
      ? SOURCE_CATALOG_VERSION
      : null,
    null
  )
  assert.deepStrictEqual(catalog.messages, { [keyFor('你好')]: '你好' })
  assert.ok(Array.isArray(report.runtimeMessages))
  assert.ok(Array.isArray(report.diagnostics))
  assert.ok(report.coverage)
})

test('parseSourceCatalogDocument accepts envelope and legacy flat maps', () => {
  const key = keyFor('你好')
  const envelope = parseSourceCatalogDocument({
    version: 1,
    messages: { [key]: '你好' }
  })
  assert.deepStrictEqual(envelope, { version: 1, messages: { [key]: '你好' } })
  const flat = parseSourceCatalogDocument({ [key]: '你好' })
  assert.deepStrictEqual(flat, { version: 1, messages: { [key]: '你好' } })
  assert.deepStrictEqual(sourceCatalogMessages({ [key]: '你好' }), { [key]: '你好' })
})

test('keys findings diagnostics and resource identities keep stable ordering', () => {
  const analysis = analyzeProject({
    files: [
      { path: 'src/b.js', source: 'module.exports = "乙"\n' },
      { path: 'src/a.js', source: 'module.exports = "甲"\n' },
      { path: 'src/b.css', source: '.x::before { content: "样式乙"; }\n' },
      { path: 'src/a.css', source: '.x::before { content: "样式甲"; }\n' }
    ],
    config: {
      attributeAllowlist: [],
      include: [],
      exclude: [],
      contextFilters: [],
      styleExtensions: ['.css']
    }
  })
  analysis.diagnostics = [
    { message: 'z-diag', path: 'src/b.js' },
    { message: 'a-diag', path: 'src/a.js' }
  ]
  const catalog = buildSourceCatalog(analysis)
  const report = analysisReport({
    ...analysis,
    diagnostics: analysis.diagnostics
  })
  assert.deepStrictEqual(
    Object.keys(catalog.messages),
    Object.keys(catalog.messages).slice().sort((left, right) => left.localeCompare(right))
  )
  assert.deepStrictEqual(
    report.runtimeMessages.map(item => item.resourceIdentity),
    ['src/a.js::script', 'src/b.js::script']
  )
  assert.deepStrictEqual(
    report.auditFindings.map(item => item.resourceIdentity),
    [
      'src/a.css::style[index=0;lang=css]',
      'src/b.css::style[index=0;lang=css]'
    ]
  )
  assert.deepStrictEqual(
    report.diagnostics.map(item => `${item.path}:${item.message}`),
    ['src/a.js:a-diag', 'src/b.js:z-diag']
  )
})

test('analyzeSnapshots classifies runtime and audit entries from live snapshots', () => {
  const snapshots = [
    {
      identity: 'src/app.js::script',
      projectPath: 'src/app.js',
      entries: [{
        value: '你好',
        locations: [{
          path: 'src/app.js',
          kind: 'script-string',
          start: { line: 1, column: 19 },
          end: { line: 1, column: 21 }
        }]
      }]
    },
    {
      identity: 'src/badge.css::style[index=0;lang=css]',
      projectPath: 'src/badge.css',
      entries: [{
        value: '样式',
        locations: [{
          path: 'src/badge.css',
          kind: 'css-generated-content',
          start: { line: 1, column: 20 },
          end: { line: 1, column: 22 }
        }]
      }]
    }
  ]
  const analysis = analyzeSnapshots(snapshots, {
    attributeAllowlist: [],
    include: [],
    exclude: [],
    contextFilters: []
  })
  assert.strictEqual(analysis.runtimeMessages.length, 1)
  assert.strictEqual(analysis.runtimeMessages[0].text, '你好')
  assert.strictEqual(analysis.auditFindings.length, 1)
  assert.strictEqual(analysis.auditFindings[0].semanticRole, 'css-generated-content')
  const report = analysisReport(analysis)
  assert.ok(report.coverage.runtimeLocalization.total >= 1)
  assert.ok(report.coverage.chineseSourceAudit.total >= 1)
})

test('semantic compare ignores compiler and loader environment metadata', () => {
  const key = keyFor('你好')
  const finding = {
    text: '你好',
    location: {
      path: 'src/app.js',
      start: { line: 1, column: 0 },
      end: { line: 1, column: 2 }
    },
    sourceSurface: 'javascript',
    semanticRole: 'script-string',
    capability: 'automatically-runtime-localizable',
    resourceIdentity: 'src/app.js::script'
  }
  const left = {
    catalog: { version: 1, messages: { [key]: '你好' } },
    report: {
      version: 1,
      runtimeMessages: [finding],
      auditFindings: [],
      dynamicMessageCandidates: [],
      localizedCallFindings: [],
      diagnostics: [],
      coverage: { sourceDiscovery: { total: 1 } },
      environment: { configHash: 'aaa', parserVersion: 'babel-7', webpack: '5.0.0' }
    }
  }
  const right = {
    catalog: { version: 1, messages: { [key]: '你好' } },
    report: {
      version: 1,
      runtimeMessages: [finding],
      auditFindings: [],
      dynamicMessageCandidates: [],
      localizedCallFindings: [],
      diagnostics: [],
      coverage: { sourceDiscovery: { total: 1 } },
      environment: { configHash: 'bbb', parserVersion: 'babel-8', webpack: '5.99.0' }
    }
  }
  assert.ok(formalOutputsSemanticallyEqual(left, right))
  assert.ok(verifyFormalCollectionOutputs(left, right))
  assert.deepStrictEqual(
    normalizeSourceCatalog(left.catalog),
    normalizeSourceCatalog(right.catalog)
  )
  assert.deepStrictEqual(
    normalizeAnalysisReport(left.report),
    normalizeAnalysisReport(right.report)
  )
  // Raw JSON bytes differ when only environment metadata changes.
  assert.notStrictEqual(JSON.stringify(left.report), JSON.stringify(right.report))
  right.catalog.messages[key] = '世界'
  assert.ok(!formalOutputsSemanticallyEqual(left, right))
})

test('production verification reads committed formal outputs and compares semantically', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-formal-verify-'))
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')
  const config = loadConfig({ root })
  const key = keyFor('你好')
  const catalog = { version: 1, messages: { [key]: '你好' } }
  const report = {
    version: 1,
    runtimeMessages: [],
    auditFindings: [],
    dynamicMessageCandidates: [],
    localizedCallFindings: [],
    diagnostics: [],
    coverage: { sourceDiscovery: { total: 0 } },
    environment: { configHash: 'committed', parserVersion: 'babel-7' }
  }
  await publishCollectionOutputs({
    root,
    config,
    catalog,
    report,
    dictionary: { [key]: '你好' },
    sourceMap: { version: 1, parserVersion: 'babel-7', configHash: 'committed', entries: [] }
  })
  const committed = readFormalCollectionOutputs(root, config)
  const current = {
    catalog,
    report: {
      ...report,
      environment: { configHash: 'fresh-compile', parserVersion: 'babel-8', webpack: '5.94.0' }
    }
  }
  assert.ok(verifyFormalCollectionOutputs(committed, current))
  current.catalog = { version: 1, messages: { [key]: '世界' } }
  assert.ok(!verifyFormalCollectionOutputs(committed, current))
})

test('publishCollectionOutputs writes formal pair and legacy dictionary atomically', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-formal-publish-'))
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')
  const config = loadConfig({ root })
  const key = keyFor('你好')
  const catalog = { version: 1, messages: { [key]: '你好' } }
  const report = {
    version: 1,
    runtimeMessages: [],
    auditFindings: [],
    dynamicMessageCandidates: [],
    localizedCallFindings: [],
    diagnostics: [],
    coverage: { sourceDiscovery: { total: 0 } }
  }
  await publishCollectionOutputs({
    root,
    config,
    catalog,
    report,
    dictionary: { [key]: '你好' },
    sourceMap: { version: 1, parserVersion: 'babel-7', configHash: 'h', entries: [] }
  })
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(root, sourceCatalogPath(config)), 'utf8')),
    catalog
  )
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(root, analysisReportPath(config)), 'utf8')),
    report
  )
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(root, config.outputPath), 'utf8')),
    { [key]: '你好' }
  )
  assert.ok(fs.existsSync(path.join(root, config.sourceMapFilename)))
  assert.strictEqual(SOURCE_CATALOG_FILE, 'source-catalog.json')
  assert.strictEqual(ANALYSIS_REPORT_FILE, 'analysis-report.json')
})

test('failed formal publish preserves previous formal outputs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-formal-keep-'))
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')
  const config = loadConfig({ root })
  const key = keyFor('你好')
  const catalog = { version: 1, messages: { [key]: '你好' } }
  const report = {
    version: 1,
    runtimeMessages: [],
    auditFindings: [],
    dynamicMessageCandidates: [],
    localizedCallFindings: [],
    diagnostics: [],
    coverage: { sourceDiscovery: { total: 0 } }
  }
  await publishCollectionOutputs({
    root,
    config,
    catalog,
    report,
    dictionary: { [key]: '你好' },
    sourceMap: { version: 1, parserVersion: 'babel-7', configHash: 'h', entries: [] }
  })
  const beforeCatalog = fs.readFileSync(path.join(root, sourceCatalogPath(config)))
  const beforeReport = fs.readFileSync(path.join(root, analysisReportPath(config)))
  const beforeDict = fs.readFileSync(path.join(root, config.outputPath))
  const realRename = fs.renameSync.bind(fs)
  let forced = false
  fs.renameSync = (from, to) => {
    if (!forced && String(to).replace(/\\/g, '/').endsWith('source-catalog.json')) {
      forced = true
      throw new Error('forced formal publish failure')
    }
    return realRename(from, to)
  }
  try {
    await assert.rejects(
      () => publishCollectionOutputs({
        root,
        config,
        catalog: { version: 1, messages: { [keyFor('世界')]: '世界' } },
        report,
        dictionary: { [keyFor('世界')]: '世界' },
        sourceMap: { version: 1, parserVersion: 'babel-7', configHash: 'h2', entries: [] }
      }),
      /forced formal publish failure/
    )
  } finally {
    fs.renameSync = realRename
  }
  assert.deepStrictEqual(fs.readFileSync(path.join(root, sourceCatalogPath(config))), beforeCatalog)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, analysisReportPath(config))), beforeReport)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, config.outputPath)), beforeDict)
})
