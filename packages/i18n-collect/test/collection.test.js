const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { loadConfig, validate } = require('../mycommon/config')
const { CollectionStore, keyFor } = require('../mycommon/store')
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
  assert.deepStrictEqual(Object.keys(pkg.dependencies).sort(), ['@babel/parser', '@babel/traverse', 'parse5'])
  assert.strictEqual(pkg.dependencies['loader-utils'], undefined)
  const entry = lock.packages['packages/i18n-collect']
  assert.deepStrictEqual(entry.peerDependencies, { webpack: '^5.0.0' })
  assert.deepStrictEqual(Object.keys(entry.dependencies).sort(), ['@babel/parser', '@babel/traverse', 'parse5'])
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

