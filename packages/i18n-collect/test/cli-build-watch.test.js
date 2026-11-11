const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { build } = require('../cli/build')
const {
  assertLangUnchanged,
  keyForSource,
  seedSourceCatalog,
  snapshotLangTree,
  sourceCatalogBuffer,
  writeSourceCatalog
} = require('./build-test-helpers')
const { keyFor } = require('../mycommon/store')

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

function assertPublishMatchesCatalog(root, published, sourceText) {
  const key = keyForSource(root, sourceText)
  assert.ok(published.sourceCatalog.equals(sourceCatalogBuffer(root)))
  assert.match(published.bundle, new RegExp(key.replace(/\./g, '\\.')))
  assert.doesNotMatch(published.bundle, new RegExp(sourceText))
  assert.strictEqual(
    fs.readFileSync(path.join(root, published.bundlePath || 'dist/bundle.js'), 'utf8'),
    published.bundle
  )
  return key
}

async function startWatch(root) {
  seedSourceCatalog(root)
  const outcome = await build(['--watch', '--json', '--cwd', root])
  assert.ok(outcome.watch, 'build --watch should return a watch handle')
  await outcome.watch.waitForIdle()
  return outcome
}

test('watch starts with one analyze-replace-publish cycle whose bundle matches the committed catalog', {
  timeout: 90000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-init-'))
  writeBuildProject(root)
  const langBefore = (() => {
    seedSourceCatalog(root)
    return snapshotLangTree(root)
  })()
  const outcome = await build(['--watch', '--json', '--cwd', root])
  try {
    await outcome.watch.waitForIdle()
    assert.strictEqual(outcome.code, 0)
    assert.ok(outcome.watch.publishes.length >= 1)
    assertPublishMatchesCatalog(root, outcome.watch.publishes[outcome.watch.publishes.length - 1], '你好')
    assertLangUnchanged(langBefore, root)
  } finally {
    await outcome.watch.close()
  }
})

test('editing collected copy without scanning fails closed and leaves catalogs byte-identical', {
  timeout: 120000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-stale-'))
  writeBuildProject(root)
  const outcome = await startWatch(root)
  try {
    const langBefore = snapshotLangTree(root)
    const before = outcome.watch.publishes.length
    fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = function label() {\n  return "世界"\n}\n')
    await outcome.watch.waitForStatus(state => state.lastExitCode !== 0)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assert.strictEqual(outcome.watch.publishes.length, before)
    assertLangUnchanged(langBefore, root)
    assert.match(outcome.watch.lastStderr, /source catalog|no longer matches|scan/i)
  } finally {
    await outcome.watch.close()
  }
})

test('updating the committed source catalog after a source edit republishes the formal bundle', {
  timeout: 180000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-rescan-'))
  writeBuildProject(root)
  const outcome = await startWatch(root)
  try {
    const before = outcome.watch.publishes.length
    fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = function label() {\n  return "世界"\n}\n')
    await outcome.watch.waitForStatus(state => state.lastExitCode !== 0)
    await outcome.watch.waitForIdle({ settleMs: 200 })

    writeSourceCatalog(root, { [keyFor('世界')]: '世界' })
    const published = await outcome.watch.waitForPublish(before)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assertPublishMatchesCatalog(root, published, '世界')
    assert.doesNotMatch(published.bundle, /你好/)
    assert.strictEqual(outcome.watch.lastExitCode, 0)
  } finally {
    await outcome.watch.close()
  }
})

test('rapid consecutive catalog-aligned edits coalesce into serial cycles', {
  timeout: 180000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-rapid-'))
  writeBuildProject(root)
  const outcome = await startWatch(root)
  try {
    const before = outcome.watch.publishes.length
    const source = path.join(root, 'src/app.js')
    fs.writeFileSync(source, 'module.exports = function label() {\n  return "你好"\n}\n')
    fs.writeFileSync(
      source,
      'module.exports = function label() {\n  const marker = "one"\n  return "你好"\n}\n'
    )
    fs.writeFileSync(
      source,
      'module.exports = function label() {\n  const marker = "two"\n  return "你好"\n}\n'
    )
    fs.writeFileSync(
      source,
      'module.exports = function label() {\n  const marker = "three"\n  return "你好"\n}\n'
    )
    const published = await outcome.watch.waitForPublish(before)
    await outcome.watch.waitForIdle({ settleMs: 400 })
    assertPublishMatchesCatalog(root, outcome.watch.publishes[outcome.watch.publishes.length - 1], '你好')
    assert.match(outcome.watch.publishes[outcome.watch.publishes.length - 1].bundle, /three/)
    assert.ok(
      outcome.watch.publishes.length - before <= 3,
      `expected coalesced publishes, got ${outcome.watch.publishes.length - before}`
    )
    void published
  } finally {
    await outcome.watch.close()
  }
})

test('analysis failure keeps the previous catalog and bundle; a fix recovers watch', {
  timeout: 180000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-analysis-fail-'))
  writeBuildProject(root)
  const outcome = await startWatch(root)
  try {
    const goodCatalog = sourceCatalogBuffer(root)
    const goodBundle = fs.readFileSync(path.join(root, 'dist/bundle.js'))
    const langBefore = snapshotLangTree(root)
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
    assert.ok(goodCatalog.equals(sourceCatalogBuffer(root)))
    assert.ok(goodBundle.equals(fs.readFileSync(path.join(root, 'dist/bundle.js'))))
    assertLangUnchanged(langBefore, root)
    assert.notStrictEqual(outcome.watch.lastExitCode, 0)

    fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = function label() {\n  return "你好"\n}\n')
    fs.rmSync(path.join(root, 'src/other.js'))
    const published = await outcome.watch.waitForPublish(before)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assertPublishMatchesCatalog(root, published, '你好')
    assert.strictEqual(outcome.watch.lastExitCode, 0)
  } finally {
    await outcome.watch.close()
  }
})

test('replacement failure keeps catalogs byte-identical, leaves the previous bundle, then recovers', {
  timeout: 180000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-repl-fail-'))
  writeBuildProject(root)
  const outcome = await startWatch(root)
  try {
    const before = outcome.watch.publishes.length
    const previousBundle = fs.readFileSync(path.join(root, 'dist/bundle.js'))
    fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = { "你好": 1 }\n')
    seedSourceCatalog(root)
    const langAfterSeed = snapshotLangTree(root)
    await outcome.watch.waitForStatus(state => state.lastExitCode !== 0)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assert.strictEqual(outcome.watch.publishes.length, before)
    assert.ok(previousBundle.equals(fs.readFileSync(path.join(root, 'dist/bundle.js'))))
    assertLangUnchanged(langAfterSeed, root)
    assert.notStrictEqual(outcome.watch.lastExitCode, 0)
    const staging = fs.readdirSync(root).filter(name => name.startsWith('.i18n-build-staging-'))
    assert.deepStrictEqual(staging, [])

    fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = function label() {\n  return "你好"\n}\n')
    seedSourceCatalog(root)
    const published = await outcome.watch.waitForPublish(before)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assertPublishMatchesCatalog(root, published, '你好')
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

test('non-message source edits still republish the formal bundle without catalog writes', {
  timeout: 120000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-watch-src-'))
  writeBuildProject(root)
  const outcome = await startWatch(root)
  try {
    const langBefore = snapshotLangTree(root)
    const before = outcome.watch.publishes.length
    const previousBundle = outcome.watch.publishes[before - 1].bundle
    fs.writeFileSync(
      path.join(root, 'src/app.js'),
      [
        'module.exports = {',
        '  marker: "watch-rebuild",',
        '  label() { return "你好" }',
        '}',
        ''
      ].join('\n')
    )
    const published = await outcome.watch.waitForPublish(before)
    await outcome.watch.waitForIdle({ settleMs: 200 })
    assertPublishMatchesCatalog(root, published, '你好')
    assert.match(published.bundle, /watch-rebuild/)
    assert.notStrictEqual(published.bundle, previousBundle)
    assertLangUnchanged(langBefore, root)
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
