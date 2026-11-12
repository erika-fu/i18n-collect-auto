const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { LEGACY_IDENTITY_METADATA } = require('../mycommon/legacy-contraction')
const { loadConfig } = require('../mycommon/config')
const {
  loadPublishedCatalog,
  preflightBuildReplacement,
  publishFormalBundle
} = require('../mycommon/build-replacement-contract')
const { keyFor } = require('../mycommon/store')
const { SOURCE_CATALOG_FILE } = require('../mycommon/source-catalog-freshness')

function writeProject(root, {
  source = 'module.exports = "欢迎"\n',
  html = null,
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
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  fs.writeFileSync(path.join(root, 'src/i18n.js'), 'function t(key) { return key }\nmodule.exports = { t }\n')
  if (html) {
    fs.mkdirSync(path.join(root, 'public'), { recursive: true })
    fs.writeFileSync(path.join(root, 'public/index.html'), html)
  }
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), configSource)
}

test('preflight fails closed for standalone HTML when those positions are supplied as occurrences', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-preflight-html-'))
  writeProject(root, {
    source: 'module.exports = "欢迎"\n',
    html: '<p title="页面">正文</p>\n'
  })
  const config = loadConfig({ root })
  const occurrences = [
    {
      key: keyFor('欢迎'),
      source: '欢迎',
      location: {
        path: 'src/app.js',
        kind: 'script-string',
        start: { line: 1, column: 17 },
        end: { line: 1, column: 19 }
      },
      status: 'active',
      reportedAmbiguity: false
    },
    {
      key: keyFor('正文'),
      source: '正文',
      location: {
        path: 'public/index.html',
        kind: 'static-html-text',
        start: { line: 1, column: 12 },
        end: { line: 1, column: 14 }
      },
      status: 'active',
      reportedAmbiguity: false
    }
  ]
  assert.throws(() => preflightBuildReplacement(root, config, { occurrences }), error => {
    assert.strictEqual(error.kind, 'build')
    assert.strictEqual(error.stage, 'replacement')
    assert.ok(error.occurrences.some(item => (
      item.path === 'public/index.html'
      && /standalone HTML|outside replacement scope/i.test(item.reason)
    )))
    return true
  })
})

test('preflight without analysis occurrences rejects legacy catalog metadata fallback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-preflight-legacy-'))
  writeProject(root)
  fs.writeFileSync(
    path.join(root, 'lang/catalog', SOURCE_CATALOG_FILE),
    `${JSON.stringify({ [keyFor('欢迎')]: '欢迎' }, null, 2)}\n`
  )
  const config = loadConfig({ root })
  assert.throws(() => preflightBuildReplacement(root, config), error => {
    assert.strictEqual(error.kind, 'configuration')
    assert.strictEqual(error.message, LEGACY_IDENTITY_METADATA)
    return true
  })
})

test('preflight rejects unsupported catalog schema before replacement starts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-preflight-schema-'))
  writeProject(root)
  fs.writeFileSync(
    path.join(root, 'lang/catalog/catalog.meta.json'),
    `${JSON.stringify({ version: 99, entries: {} }, null, 2)}\n`
  )
  const config = loadConfig({ root })
  assert.throws(() => loadPublishedCatalog(root, config), error => {
    assert.strictEqual(error.kind, 'configuration')
    assert.strictEqual(error.stage, 'configuration')
    assert.match(error.message, /catalog metadata|unsupported|version|migrate-keys|scan/i)
    return true
  })
})

test('preflight rejects unreadable catalog metadata as configuration failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-preflight-badjson-'))
  writeProject(root)
  fs.writeFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), '{ not-json')
  const config = loadConfig({ root })
  assert.throws(() => loadPublishedCatalog(root, config), error => {
    assert.strictEqual(error.kind, 'configuration')
    assert.strictEqual(error.stage, 'configuration')
    assert.match(error.message, /could not be read/i)
    return true
  })
})

test('publishFormalBundle keeps the previous formal output when staging publish fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-publish-keep-'))
  const formalPath = path.join(root, 'dist')
  const stagingPath = path.join(root, '.i18n-build-staging-test')
  fs.mkdirSync(formalPath, { recursive: true })
  fs.mkdirSync(stagingPath, { recursive: true })
  fs.writeFileSync(path.join(formalPath, 'bundle.js'), 'PREVIOUS\n')
  fs.writeFileSync(path.join(stagingPath, 'bundle.js'), 'NEXT\n')
  const realRename = fs.renameSync
  let calls = 0
  fs.renameSync = (from, to) => {
    calls += 1
    if (calls === 2) throw new Error('simulated publish failure')
    return realRename.call(fs, from, to)
  }
  try {
    assert.throws(() => publishFormalBundle({ formalPath, stagingPath }), /simulated publish failure/)
  } finally {
    fs.renameSync = realRename
  }
  assert.strictEqual(fs.readFileSync(path.join(formalPath, 'bundle.js'), 'utf8'), 'PREVIOUS\n')
})
