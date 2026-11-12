const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { loadConfig } = require('../mycommon/config')
const { json } = require('../mycommon/output')
const { keyFor } = require('../mycommon/store')
const {
  occurrencesFromAnalysis,
  prepareSourceReplacement
} = require('../mycommon/source-catalog-freshness')

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

test('prepareSourceReplacement stays available after source is already localized', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-replace-prep-'))
  const key = keyFor('你好')
  writeJsProject(root, [
    "const { t } = require('./i18n')",
    `module.exports = t('${key}')`,
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'src/i18n.js'), 'function t(key) { return key }\nmodule.exports = { t }\n')
  commitSourceCatalog(root, { [key]: '你好' })
  const config = loadConfig({ root })
  const prepared = prepareSourceReplacement(root, config)
  assert.deepStrictEqual(prepared.occurrences, [])
  assert.deepStrictEqual(prepared.sourceCatalog, { [key]: '你好' })
})

test('prepareSourceReplacement fails when an automatic finding is absent from the catalog', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-replace-missing-key-'))
  writeJsProject(root, 'module.exports = "你好"\n')
  commitSourceCatalog(root, { [keyFor('欢迎')]: '欢迎' })
  const config = loadConfig({ root })
  assert.throws(() => prepareSourceReplacement(root, config), error => {
    assert.strictEqual(error.kind, 'collection')
    assert.match(error.message, /source catalog|scan before replace/i)
    return true
  })
})
