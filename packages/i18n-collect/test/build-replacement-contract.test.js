const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { buildCatalog, catalogMetadata } = require('../mycommon/catalog')
const { loadConfig } = require('../mycommon/config')
const {
  loadPublishedCatalog,
  preflightBuildReplacement,
  publishFormalBundle
} = require('../mycommon/build-replacement-contract')
const { extractHtml } = require('../myloader/extract-html')
const { extractScript } = require('../myloader/extract-script')

const ALLOW = ['title', 'placeholder', 'alt', 'aria-label', 'value']

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

function writeCatalogFromEntries(root, entries) {
  const catalog = buildCatalog([{ entries }])
  assert.deepStrictEqual(catalog.conflicts, [])
  fs.writeFileSync(
    path.join(root, 'lang/catalog/zh.json'),
    `${JSON.stringify(catalog.messages, null, 2)}\n`
  )
  fs.writeFileSync(
    path.join(root, 'lang/catalog/catalog.meta.json'),
    `${JSON.stringify(catalogMetadata(catalog, { sourceLocale: 'zh', format: 'json' }), null, 2)}\n`
  )
}

test('preflight fails closed for standalone HTML collected positions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-preflight-html-'))
  const script = 'module.exports = "欢迎"\n'
  const html = '<p title="页面">正文</p>\n'
  writeProject(root, { source: script, html })
  const entries = [
    ...extractScript({ source: script, resource: { projectPath: 'src/app.js' }, config: {} }),
    ...extractHtml({
      source: html,
      resource: { projectPath: 'public/index.html', block: 'html', lang: 'html' },
      config: { attributeAllowlist: ALLOW }
    }).entries
  ]
  writeCatalogFromEntries(root, entries)
  const config = loadConfig({ root })
  assert.throws(() => preflightBuildReplacement(root, config), error => {
    assert.strictEqual(error.kind, 'build')
    assert.strictEqual(error.stage, 'replacement')
    assert.ok(error.occurrences.some(item => (
      item.path === 'public/index.html'
      && item.reason === 'standalone HTML is outside replacement scope'
    )))
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
    assert.match(error.message, /catalog metadata|unsupported|version/i)
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
  assert.ok(!fs.existsSync(stagingPath))
  const leftovers = fs.readdirSync(root).filter(name => name.includes('.i18n-build-bak-'))
  assert.deepStrictEqual(leftovers, [])
})
