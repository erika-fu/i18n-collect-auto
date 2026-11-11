const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { build } = require('../cli/build')

const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')

function writeBuildProject(root, {
  source = 'module.exports = function label() {\n  return "你好"\n}\n',
  files = {},
  entry = './src/app.js',
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
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  fs.writeFileSync(path.join(root, 'src/i18n.js'), [
    'function t(key) { return key }',
    'module.exports = { t }',
    ''
  ].join('\n'))
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
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  module: { rules: [{ test: /\\.[cm]?[jt]sx?$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin()]
}
`)
}

function keyForSource(root, sourceText) {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), 'utf8'))
  const key = Object.keys(metadata.entries).find(name => metadata.entries[name].source === sourceText)
  assert.ok(key, `missing catalog key for ${sourceText}`)
  return key
}

function catalogMeta(root) {
  return fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'))
}

function assertPublishMatchesCatalog(root, published, sourceText) {
  const key = keyForSource(root, sourceText)
  assert.ok(published.catalogMeta.equals(catalogMeta(root)))
  assert.match(published.bundle, new RegExp(key.replace(/\./g, '\\.')))
  assert.doesNotMatch(published.bundle, new RegExp(sourceText))
  assert.strictEqual(
    fs.readFileSync(path.join(root, published.bundlePath || 'dist/bundle.js'), 'utf8'),
    published.bundle
  )
  return key
}

function assertNoStaleCatalogBundles(publishes) {
  for (const published of publishes) {
    const meta = JSON.parse(published.catalogMeta.toString('utf8'))
    const keys = Object.keys(meta.entries || {}).filter(name => meta.entries[name].status !== 'orphaned')
    for (const key of keys) {
      const source = meta.entries[key].source
      if (!source || !/[\u4e00-\u9fff]/.test(source)) continue
      assert.match(
        published.bundle,
        new RegExp(key.replace(/\./g, '\\.')),
        'published bundle must use the catalog version from the same cycle'
      )
      assert.doesNotMatch(published.bundle, new RegExp(source))
    }
  }
}

async function startWatch(root) {
  const outcome = await build(['--watch', '--json', '--cwd', root])
  assert.ok(outcome.watch, 'build --watch should return a watch handle')
  await outcome.watch.waitForIdle()
  return outcome
}

test('watch starts with one collect-replace-publish cycle whose bundle matches the committed catalog', {
  timeout: 90000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-init-'))
  writeBuildProject(root)
  const outcome = await startWatch(root)
  try {
    assert.strictEqual(outcome.code, 0)
    assert.ok(outcome.watch.publishes.length >= 1)
    assertPublishMatchesCatalog(root, outcome.watch.publishes[outcome.watch.publishes.length - 1], '你好')
    assertNoStaleCatalogBundles(outcome.watch.publishes)
  } finally {
    await outcome.watch.close()
  }
})

test('editing collected copy publishes a bundle for the newly committed catalog', {
  timeout: 120000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-edit-'))
  writeBuildProject(root)
  const outcome = await startWatch(root)
  try {
    const before = outcome.watch.publishes.length
    const source = path.join(root, 'src/app.js')
    fs.writeFileSync(source, 'module.exports = function label() {\n  return "世界"\n}\n')
    const published = await outcome.watch.waitForPublish(before)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assertPublishMatchesCatalog(root, published, '世界')
    assert.doesNotMatch(published.bundle, /你好/)
    assertNoStaleCatalogBundles(outcome.watch.publishes)
  } finally {
    await outcome.watch.close()
  }
})

test('adding and deleting collected copy refresh the formal bundle from the same-cycle catalog', {
  timeout: 180000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-add-del-'))
  writeBuildProject(root, {
    source: 'module.exports = {\n  a: "你好"\n}\n',
    configSource: [
      'module.exports = {',
      '  pruneOrphaned: true,',
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
  const outcome = await startWatch(root)
  try {
    let before = outcome.watch.publishes.length
    fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = {\n  a: "你好",\n  b: "欢迎"\n}\n')
    let published = await outcome.watch.waitForPublish(before)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    const helloKey = assertPublishMatchesCatalog(root, published, '你好')
    const welcomeKey = keyForSource(root, '欢迎')
    assert.match(published.bundle, new RegExp(welcomeKey.replace(/\./g, '\\.')))
    assert.doesNotMatch(published.bundle, /欢迎/)

    before = outcome.watch.publishes.length
    fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = {\n  b: "欢迎"\n}\n')
    published = await outcome.watch.waitForPublish(before)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assertPublishMatchesCatalog(root, published, '欢迎')
    assert.doesNotMatch(published.bundle, new RegExp(helloKey.replace(/\./g, '\\.')))
    assertNoStaleCatalogBundles(outcome.watch.publishes)
  } finally {
    await outcome.watch.close()
  }
})

test('rapid consecutive edits coalesce into serial cycles without stale intermediate bundles', {
  timeout: 180000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-rapid-'))
  writeBuildProject(root)
  const outcome = await startWatch(root)
  try {
    const before = outcome.watch.publishes.length
    const source = path.join(root, 'src/app.js')
    fs.writeFileSync(source, 'module.exports = function label() {\n  return "第一"\n}\n')
    fs.writeFileSync(source, 'module.exports = function label() {\n  return "第二"\n}\n')
    fs.writeFileSync(source, 'module.exports = function label() {\n  return "第三"\n}\n')
    const published = await outcome.watch.waitForPublish(before)
    await outcome.watch.waitForIdle({ settleMs: 400 })
    assertPublishMatchesCatalog(root, outcome.watch.publishes[outcome.watch.publishes.length - 1], '第三')
    assert.doesNotMatch(outcome.watch.publishes[outcome.watch.publishes.length - 1].bundle, /第一|第二|你好/)
    assertNoStaleCatalogBundles(outcome.watch.publishes)
    assert.ok(
      outcome.watch.publishes.length - before <= 3,
      `expected coalesced publishes, got ${outcome.watch.publishes.length - before}`
    )
    void published
  } finally {
    await outcome.watch.close()
  }
})

test('collection failure keeps the previous catalog and bundle; a fix recovers watch', {
  timeout: 180000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-coll-fail-'))
  writeBuildProject(root)
  const outcome = await startWatch(root)
  try {
    const goodMeta = catalogMeta(root)
    const goodBundle = fs.readFileSync(path.join(root, 'dist/bundle.js'))
    const before = outcome.watch.publishes.length
    fs.writeFileSync(
      path.join(root, 'src/other.js'),
      'module.exports = /* i18n-key: shared.title */ "主页"\n'
    )
    fs.writeFileSync(
      path.join(root, 'src/app.js'),
      'require("./other")\nmodule.exports = /* i18n-key: shared.title */ "首页"\n'
    )
    await outcome.watch.waitForStatus(state => state.lastExitCode !== 0)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assert.strictEqual(outcome.watch.publishes.length, before)
    assert.ok(goodMeta.equals(catalogMeta(root)))
    assert.ok(goodBundle.equals(fs.readFileSync(path.join(root, 'dist/bundle.js'))))
    assert.notStrictEqual(outcome.watch.lastExitCode, 0)

    fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = function label() {\n  return "恢复"\n}\n')
    fs.rmSync(path.join(root, 'src/other.js'))
    const published = await outcome.watch.waitForPublish(before)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assertPublishMatchesCatalog(root, published, '恢复')
    assert.strictEqual(outcome.watch.lastExitCode, 0)
  } finally {
    await outcome.watch.close()
  }
})

test('replacement failure keeps the committed catalog, leaves the previous bundle, then recovers', {
  timeout: 180000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-repl-fail-'))
  writeBuildProject(root)
  const outcome = await startWatch(root)
  try {
    const before = outcome.watch.publishes.length
    const previousBundle = fs.readFileSync(path.join(root, 'dist/bundle.js'))
    const previousCatalog = catalogMeta(root)
    fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = { "你好": 1 }\n')
    await outcome.watch.waitForStatus(state => state.lastExitCode !== 0)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assert.strictEqual(outcome.watch.publishes.length, before)
    assert.ok(previousBundle.equals(fs.readFileSync(path.join(root, 'dist/bundle.js'))))
    assert.ok(!previousCatalog.equals(catalogMeta(root)), 'successful collection should keep the new catalog')
    assert.notStrictEqual(outcome.watch.lastExitCode, 0)
    const staging = fs.readdirSync(root).filter(name => name.startsWith('.i18n-build-staging-'))
    assert.deepStrictEqual(staging, [])

    fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = function label() {\n  return "修好"\n}\n')
    const published = await outcome.watch.waitForPublish(before)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assertPublishMatchesCatalog(root, published, '修好')
    assert.strictEqual(outcome.watch.lastExitCode, 0)
  } finally {
    await outcome.watch.close()
  }
})

test('config and webpack changes trigger a new coordinated cycle', {
  timeout: 120000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-config-'))
  writeBuildProject(root)
  const outcome = await startWatch(root)
  try {
    let before = outcome.watch.publishes.length
    fs.writeFileSync(path.join(root, 'src/i18n2.js'), [
      'function translate(key) { return key }',
      'module.exports = { translate }',
      ''
    ].join('\n'))
    fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), [
      'module.exports = {',
      '  buildReplacement: {',
      '    enabled: true,',
      '    adapter: "js",',
      '    runtimeModule: "src/i18n2.js",',
      '    runtimeExport: "translate"',
      '  }',
      '}',
      ''
    ].join('\n'))
    let published = await outcome.watch.waitForPublish(before)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assertPublishMatchesCatalog(root, published, '你好')
    assert.match(published.bundle, /i18n2/)

    before = outcome.watch.publishes.length
    const webpackConfig = fs.readFileSync(path.join(root, 'webpack.config.js'), 'utf8')
    fs.writeFileSync(
      path.join(root, 'webpack.config.js'),
      webpackConfig.replace("filename: 'bundle.js'", "filename: 'app.bundle.js'")
    )
    published = await outcome.watch.waitForPublish(before)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assert.strictEqual(published.bundlePath, 'dist/app.bundle.js')
    assert.ok(fs.existsSync(path.join(root, 'dist/app.bundle.js')))
    assertPublishMatchesCatalog(root, published, '你好')
  } finally {
    await outcome.watch.close()
  }
})

test('non-catalog source edits still republish the formal bundle', {
  timeout: 120000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-src-'))
  writeBuildProject(root)
  const outcome = await startWatch(root)
  try {
    const before = outcome.watch.publishes.length
    const previousBundle = outcome.watch.publishes[before - 1].bundle
    fs.writeFileSync(
      path.join(root, 'src/app.js'),
      'module.exports = function label() {\n  const marker = "watch-rebuild"\n  return "你好" + marker\n}\n'
    )
    const published = await outcome.watch.waitForPublish(before)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assertPublishMatchesCatalog(root, published, '你好')
    assert.match(published.bundle, /watch-rebuild/)
    assert.notStrictEqual(published.bundle, previousBundle)
  } finally {
    await outcome.watch.close()
  }
})

test('watch close releases watchers and does not keep publishing', {
  timeout: 120000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-close-'))
  writeBuildProject(root)
  const outcome = await startWatch(root)
  const beforeClose = outcome.watch.publishes.length
  await outcome.watch.close()
  fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = function label() {\n  return "关闭后"\n}\n')
  await new Promise(resolve => setTimeout(resolve, 1000))
  assert.strictEqual(outcome.watch.publishes.length, beforeClose)
})
