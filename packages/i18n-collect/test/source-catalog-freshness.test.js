const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { loadConfig } = require('../mycommon/config')
const { json } = require('../mycommon/output')
const {
  analyzeProject,
  buildSourceCatalog
} = require('../mycommon/project-analysis')
const { keyFor } = require('../mycommon/store')
const {
  assertSourceCatalogFresh,
  occurrencesFromAnalysis
} = require('../mycommon/source-catalog-freshness')
const { listProjectSources } = require('../mycommon/project-sources')

function writeJsProject(root, source = 'module.exports = "你好"\n') {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')
}

function commitSourceCatalog(root, catalog) {
  const file = path.join(root, 'lang/catalog/source-catalog.json')
  fs.writeFileSync(file, json(catalog))
  return file
}

function snapshotCatalogDir(root) {
  const dir = path.join(root, 'lang/catalog')
  const out = new Map()
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name)
    if (fs.statSync(file).isFile()) out.set(name, fs.readFileSync(file))
  }
  return out
}

test('occurrencesFromAnalysis maps runtime messages and omits audit findings', () => {
  const analysis = {
    runtimeMessages: [{
      text: '欢迎',
      key: keyFor('欢迎'),
      location: {
        path: 'src/Home.vue',
        start: { line: 2, column: 5 },
        end: { line: 2, column: 7 }
      },
      semanticRole: 'html-text',
      capability: 'automatically-runtime-localizable'
    }],
    auditFindings: [{
      text: '样式',
      location: {
        path: 'src/badge.css',
        start: { line: 1, column: 20 },
        end: { line: 1, column: 22 }
      },
      semanticRole: 'css-generated-content',
      capability: 'chinese-source-audit',
      disposition: 'unresolved'
    }]
  }
  const occurrences = occurrencesFromAnalysis(analysis)
  assert.strictEqual(occurrences.length, 1)
  assert.deepStrictEqual(occurrences[0], {
    key: keyFor('欢迎'),
    source: '欢迎',
    location: {
      path: 'src/Home.vue',
      kind: 'html-text',
      start: { line: 2, column: 5 },
      end: { line: 2, column: 7 }
    },
    status: 'active',
    reportedAmbiguity: false
  })
})

test('assertSourceCatalogFresh accepts a committed catalog that matches current analysis', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-fresh-ok-'))
  writeJsProject(root)
  const config = loadConfig({ root })
  const sources = listProjectSources(config.root, config)
  const analysis = analyzeProject({ files: sources, config })
  const catalog = buildSourceCatalog(analysis)
  commitSourceCatalog(root, catalog)
  const before = snapshotCatalogDir(root)

  const prepared = assertSourceCatalogFresh(root, config)
  assert.deepStrictEqual(prepared.sourceCatalog, catalog)
  assert.ok(prepared.occurrences.some(item => item.source === '你好'))
  assert.deepStrictEqual(snapshotCatalogDir(root), before)
})

test('assertSourceCatalogFresh fails when source analysis no longer matches the committed catalog', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-fresh-stale-'))
  writeJsProject(root, 'module.exports = "你好"\n')
  commitSourceCatalog(root, { [keyFor('你好')]: '你好' })
  fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = "世界"\n')
  const config = loadConfig({ root })
  const before = snapshotCatalogDir(root)

  assert.throws(() => assertSourceCatalogFresh(root, config), error => {
    assert.strictEqual(error.kind, 'collection')
    assert.strictEqual(error.stage, 'analysis')
    assert.match(error.message, /source catalog|no longer matches|stale/i)
    return true
  })
  assert.deepStrictEqual(snapshotCatalogDir(root), before)
})

test('assertSourceCatalogFresh fails when the committed source catalog is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-fresh-missing-'))
  writeJsProject(root)
  const config = loadConfig({ root })
  assert.throws(() => assertSourceCatalogFresh(root, config), error => {
    assert.strictEqual(error.kind, 'configuration')
    assert.match(error.message, /source catalog/i)
    return true
  })
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/source-catalog.json')))
})
