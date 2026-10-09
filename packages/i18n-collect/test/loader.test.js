const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const webpack = require('webpack')
const loader = require('../myloader')
const { keyFor } = require('../mycommon/store')

function runLoader({ root, source, sourceMap, meta, resourcePath, resourceQuery = '', options = {} }) {
  let result
  loader.call({
    resourcePath,
    resourceQuery,
    getOptions: () => ({ root, ...options }),
    callback(error, nextSource, nextMap, nextMeta) {
      result = { error, nextSource, nextMap, nextMeta }
    }
  }, source, sourceMap, meta)
  return result
}

test('passes string source, source map, and meta through unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-'))
  const source = 'const message = "你好"\n'
  const sourceMap = { version: 3, file: 'example.js', mappings: 'AAAA', sources: ['src/example.js'] }
  const meta = { fromUpstream: true }
  const resourcePath = path.join(root, 'src/example.js')
  const result = runLoader({ root, source, sourceMap, meta, resourcePath })
  assert.strictEqual(result.error, null)
  assert.strictEqual(result.nextSource, source)
  assert.strictEqual(result.nextMap, sourceMap)
  assert.strictEqual(result.nextMeta, meta)
  assert.strictEqual(loader.getStore(root).runtimeDictionary()[keyFor('你好')], '你好')
})

test('passes Buffer source through unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-'))
  const source = Buffer.from('const message = "你好"\n')
  const sourceMap = { version: 3, mappings: 'AAAA' }
  const meta = { fromUpstream: true }
  const result = runLoader({
    root,
    source,
    sourceMap,
    meta,
    resourcePath: path.join(root, 'src/example.js')
  })
  assert.strictEqual(result.error, null)
  assert.strictEqual(result.nextSource, source)
  assert.strictEqual(result.nextMap, sourceMap)
  assert.strictEqual(result.nextMeta, meta)
  assert.strictEqual(loader.getStore(root).runtimeDictionary()[keyFor('你好')], '你好')
})

test('does not collect a Vue template block or an excluded script', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-'))
  fs.mkdirSync(path.join(root, 'src'))
  const template = '<template><p>你好</p></template>'
  const templateResult = runLoader({
    root,
    source: template,
    sourceMap: null,
    meta: { kind: 'template' },
    resourcePath: path.join(root, 'src/App.vue'),
    resourceQuery: '?vue&type=template&id=abc&scoped=true&prod=true'
  })
  assert.strictEqual(templateResult.nextSource, template)
  assert.strictEqual(templateResult.nextMeta.kind, 'template')
  assert.deepStrictEqual(loader.getStore(root).runtimeDictionary(), {})

  const excluded = 'const message = "你好"\n'
  const excludedResult = runLoader({
    root,
    source: excluded,
    sourceMap: { version: 3 },
    meta: null,
    resourcePath: path.join(root, 'src/foobar.js'),
    options: { include: ['src/foo'] }
  })
  assert.strictEqual(excludedResult.nextSource, excluded)
  assert.deepStrictEqual(excludedResult.nextMap, { version: 3 })
  assert.strictEqual(excludedResult.nextMeta, null)
  assert.deepStrictEqual(loader.getStore(root).runtimeDictionary(), {})

  const script = 'export default { title: "标题" }\n'
  const scriptResult = runLoader({
    root,
    source: script,
    sourceMap: { version: 3, mappings: '' },
    meta: { kind: 'script' },
    resourcePath: path.join(root, 'src/App.vue'),
    resourceQuery: '?vue&type=script&id=abc&scoped=true&prod=true'
  })
  assert.strictEqual(scriptResult.nextSource, script)
  assert.strictEqual(scriptResult.nextMap.mappings, '')
  assert.strictEqual(loader.getStore(root).runtimeDictionary()[keyFor('标题')], '标题')
})

test('webpack passes source, source map, and meta through the loader', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-wp-'))
  fs.mkdirSync(path.join(root, 'src'))
  const source = 'module.exports = "你好"\n'
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  const recordFile = path.join(root, 'record.json')
  const upstream = path.join(root, 'upstream-loader.js')
  const record = path.join(root, 'record-loader.js')
  fs.writeFileSync(upstream, `module.exports = function (content) {
    this.callback(null, content, { version: 3, file: 'app.js', mappings: 'AAAA', sources: ['src/app.js'] }, { fromUpstream: true })
  }\n`)
  fs.writeFileSync(record, `const fs = require('fs')
    module.exports = function (content, map, meta) {
      fs.writeFileSync(${JSON.stringify(recordFile)}, JSON.stringify({ content, map, meta }))
      this.callback(null, content, map, meta)
    }\n`)

  const compiler = webpack({
    context: root,
    mode: 'development',
    entry: path.join(root, 'src/app.js'),
    output: { path: path.join(root, 'dist'), filename: 'bundle.js' },
    infrastructureLogging: { level: 'error' },
    module: {
      rules: [{
        test: /\.js$/,
        use: [
          record,
          { loader: require.resolve('../myloader'), options: { root } },
          upstream
        ]
      }]
    }
  })

  await new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      compiler.close(closeError => {
        if (error) reject(error)
        else if (closeError) reject(closeError)
        else if (stats.hasErrors()) reject(new Error(stats.toJson().errors.map(item => item.message).join('\n')))
        else resolve()
      })
    })
  })

  const seen = JSON.parse(fs.readFileSync(recordFile, 'utf8'))
  assert.strictEqual(seen.content, source)
  assert.deepStrictEqual(seen.map, { version: 3, file: 'app.js', mappings: 'AAAA', sources: ['src/app.js'] })
  assert.deepStrictEqual(seen.meta, { fromUpstream: true })
  assert.strictEqual(loader.getStore(root).runtimeDictionary()[keyFor('你好')], '你好')
})
