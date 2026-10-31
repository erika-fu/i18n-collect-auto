const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { loadConfig, validate } = require('../mycommon/config')
const { CollectionStore, keyFor } = require('../mycommon/store')
const { buildCatalog, catalogMetadata } = require('../mycommon/catalog')
const { writeOutputs } = require('../mycommon/output')

test('uses the MD5 of the final decoded value', () => {
  assert.strictEqual(keyFor('你好'), '7eca689f0d3389d9dea66ae112e5cfd7')
})

test('validates project-relative paths and rejects unknown fields', () => {
  assert.throws(() => validate('/project', { unknown: true }), /unknown field/)
  assert.throws(() => validate('/project', { outputPath: '../out.json' }), /inside the project root/)
  assert.throws(() => validate('/project', { htmlEntries: ['index.html', 'index.html'] }), /unknown field/)
  assert.throws(() => validate('/project', { include: ['src/foo', 'src/foo/'] }), /duplicate/)
})

test('keeps a Han extension character in the runtime dictionary', () => {
  const store = new CollectionStore()
  const value = '\u{20000}'
  const location = { path: 'src/a.js', kind: 'script-string', start: { line: 1, column: 0 }, end: { line: 1, column: 2 } }
  store.replaceSnapshot('src/a.js', [{ value, locations: [location] }])
  assert.strictEqual(store.runtimeDictionary()[keyFor(value)], value)
})

test('declares webpack 5 and the dependencies the package imports', () => {
  const pkg = require('../package.json')
  const lock = require('../../../package-lock.json')
  assert.deepStrictEqual(pkg.peerDependencies, { webpack: '^5.0.0' })
  assert.deepStrictEqual(Object.keys(pkg.dependencies).sort(), ['@babel/parser', '@babel/traverse', 'parse5', 'postcss'])
  assert.strictEqual(pkg.dependencies['loader-utils'], undefined)
  const entry = lock.packages['packages/i18n-collect']
  assert.deepStrictEqual(entry.peerDependencies, { webpack: '^5.0.0' })
  assert.deepStrictEqual(Object.keys(entry.dependencies).sort(), ['@babel/parser', '@babel/traverse', 'parse5', 'postcss'])
})

test('sorts locations by path, kind, and numeric line and column', () => {
  const store = new CollectionStore()
  const columnTen = {
    path: 'src/a.js',
    kind: 'script-string',
    start: { line: 2, column: 10 },
    end: { line: 2, column: 12 }
  }
  const columnTwo = {
    path: 'src/a.js',
    kind: 'script-string',
    start: { line: 2, column: 2 },
    end: { line: 2, column: 4 }
  }
  const lineTen = {
    path: 'src/a.js',
    kind: 'template-literal',
    start: { line: 10, column: 0 },
    end: { line: 10, column: 2 }
  }
  const otherFile = {
    path: 'src/b.js',
    kind: 'html-text',
    start: { line: 1, column: 0 },
    end: { line: 1, column: 2 }
  }
  store.replaceSnapshot('src/a.js::script', [{
    value: '你好',
    locations: [columnTen, otherFile, lineTen, columnTwo, columnTwo]
  }])
  assert.deepStrictEqual(store.sourceMap('hash').entries[0].locations, [
    columnTwo,
    columnTen,
    lineTen,
    otherFile
  ])
})

test('replaces resource snapshots and globally deduplicates locations', () => {
  const store = new CollectionStore()
  const location = { path: 'src/a.js', kind: 'script-string', start: { line: 1, column: 0 }, end: { line: 1, column: 4 } }
  store.replaceSnapshot('src/a.js', [{ value: '你好', locations: [location, location] }])
  store.replaceSnapshot('src/b.js', [{ value: '你好', locations: [location] }])
  assert.deepStrictEqual(store.runtimeDictionary(), { [keyFor('你好')]: '你好' })
  assert.strictEqual(store.sourceMap('hash').entries[0].locations.length, 1)
  store.replaceSnapshot('src/a.js', [])
  assert.strictEqual(store.sourceMap('hash').entries[0].value, '你好')
  store.replaceSnapshot('src/b.js', [])
  assert.deepStrictEqual(store.runtimeDictionary(), {})
})

test('configHash covers the normalized configuration and fileConfigHash ignores explicit overrides', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-config-'))
  const file = path.join(root, 'i18n-collect.config.js')
  fs.writeFileSync(file, 'module.exports = { include: ["src/kept"] }\n')
  const fromFile = loadConfig({ root })
  const withOutput = loadConfig({
    root,
    pluginOptions: { outputPath: 'lang/other.json', sourceMapFilename: 'lang/other.map.json' }
  })
  assert.strictEqual(withOutput.fileConfigHash, fromFile.fileConfigHash)
  assert.notStrictEqual(withOutput.configHash, fromFile.configHash)
  assert.strictEqual(withOutput.outputPath, 'lang/other.json')
  fs.writeFileSync(file, 'module.exports = { include: ["src/other"] }\n')
  const next = loadConfig({ root })
  assert.notStrictEqual(next.fileConfigHash, fromFile.fileConfigHash)
  assert.notStrictEqual(next.configHash, fromFile.configHash)
})

test('identical output does not create temporary files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-identical-'))
  const config = { outputPath: 'lang/runtime.json', sourceMapFilename: 'lang/map.json' }
  const dictionary = '{\n  "a": "甲"\n}\n'
  const sourceMap = '{\n  "version": 1,\n  "entries": []\n}\n'
  const files = new Map([
    [path.join(root, config.outputPath), dictionary],
    [path.join(root, config.sourceMapFilename), sourceMap]
  ])
  const calls = []
  const fsImpl = {
    existsSync: file => files.has(file),
    readFileSync: file => files.get(file),
    mkdirSync() { calls.push('mkdir') },
    writeFileSync() { calls.push('write') },
    renameSync() { calls.push('rename') },
    unlinkSync() { calls.push('unlink') }
  }
  await writeOutputs(root, config, { a: '甲' }, { version: 1, entries: [] }, fsImpl)
  assert.deepStrictEqual(calls, [])
})

test('writes stable pretty JSON output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-'))
  const config = { outputPath: 'lang/runtime.json', sourceMapFilename: 'lang/map.json' }
  await writeOutputs(root, config, { b: '乙', a: '甲' }, { version: 1, entries: [] })
  assert.match(fs.readFileSync(path.join(root, config.outputPath), 'utf8'), /"a"/)
  assert.match(fs.readFileSync(path.join(root, config.outputPath), 'utf8'), /乙/)
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, config.sourceMapFilename)), null), { version: 1, entries: [] })
})

test('a failed catalog metadata publish restores dictionary, source map, and metadata', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-meta-publish-'))
  const config = {
    outputPath: 'lang/zh_hash.json',
    sourceMapFilename: 'lang/zh_hash.map.json'
  }
  const previousDictionary = '{\n  "old": "旧"\n}\n'
  const previousMap = '{\n  "version": 1,\n  "entries": []\n}\n'
  const previousMetadata = '{\n  "version": 1,\n  "entries": {}\n}\n'
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, config.outputPath), previousDictionary)
  fs.writeFileSync(path.join(root, config.sourceMapFilename), previousMap)
  fs.writeFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), previousMetadata)

  const catalog = buildCatalog([{
    identity: 'src/a.js::script',
    entries: [{
      value: '你好',
      locations: [{ path: 'src/a.js', kind: 'script-string', start: { line: 1, column: 0 }, end: { line: 1, column: 2 } }]
    }]
  }])
  const nextMetadata = `${JSON.stringify(catalogMetadata(catalog, { sourceLocale: 'zh', format: 'json' }), null, 2)}\n`
  const realRename = fs.renameSync.bind(fs)
  let failed = false
  fs.renameSync = (from, to) => {
    if (!failed && String(to).endsWith('catalog.meta.json')) {
      failed = true
      throw new Error('forced metadata publish failure')
    }
    return realRename(from, to)
  }
  try {
    await assert.rejects(
      () => writeOutputs(
        root,
        config,
        { next: '新' },
        { version: 1, entries: [{ value: '你好' }] },
        fs,
        [
          { path: 'lang/catalog/zh.json', content: '{\n  "k": "你好"\n}\n' },
          { path: 'lang/catalog/catalog.meta.json', content: nextMetadata }
        ]
      ),
      /forced metadata publish failure/
    )
  } finally {
    fs.renameSync = realRename
  }

  assert.strictEqual(fs.readFileSync(path.join(root, config.outputPath), 'utf8'), previousDictionary)
  assert.strictEqual(fs.readFileSync(path.join(root, config.sourceMapFilename), 'utf8'), previousMap)
  assert.strictEqual(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), 'utf8'), previousMetadata)
  assert.deepStrictEqual(
    fs.readdirSync(path.join(root, 'lang')).filter(name => name.includes('.tmp-') || name.includes('.bak-') || name.startsWith('.commit-')),
    []
  )
  assert.deepStrictEqual(
    fs.readdirSync(path.join(root, 'lang/catalog')).filter(name => name.includes('.tmp-') || name.includes('.bak-') || name.startsWith('.commit-')),
    []
  )
})

test('catalog metadata serialization is deterministic for the same snapshots', () => {
  const snapshots = [{
    identity: 'src/a.js::script',
    entries: [
      { value: '乙', locations: [{ path: 'src/a.js', kind: 'script-string', start: { line: 2, column: 0 }, end: { line: 2, column: 1 } }] },
      { value: '甲', locations: [{ path: 'src/a.js', kind: 'script-string', start: { line: 1, column: 0 }, end: { line: 1, column: 1 } }] }
    ]
  }]
  const first = JSON.stringify(catalogMetadata(buildCatalog(snapshots), { sourceLocale: 'zh', format: 'json' }))
  const second = JSON.stringify(catalogMetadata(buildCatalog(snapshots), { sourceLocale: 'zh', format: 'json' }))
  assert.strictEqual(first, second)
})

