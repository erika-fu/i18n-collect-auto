const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const webpack = require('webpack')
const loader = require('../myloader')

function runLoader({ root, source, sourceMap, meta, resourcePath, resourceQuery = '', options = {}, track }) {
  const buildInfo = {}
  const dependencies = []
  const missing = []
  let result
  let thrown
  const context = {
    resourcePath,
    resourceQuery,
    rootContext: root,
    _module: { buildInfo },
    getOptions: () => ({ root, ...options }),
    addDependency(file) { dependencies.push(file) },
    addMissingDependency(file) { missing.push(file) },
    callback(error, nextSource, nextMap, nextMeta) {
      result = { error, nextSource, nextMap, nextMeta }
    }
  }
  if (track) Object.assign(context, track)
  try {
    loader.call(context, source, sourceMap, meta)
  } catch (error) {
    thrown = error
  }
  return { ...result, thrown, metadata: buildInfo.i18nCollect, dependencies, missing }
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
  assert.strictEqual(result.metadata.snapshot.identity, 'src/example.js::script')
  assert.strictEqual(result.metadata.snapshot.entries[0].value, '你好')
  assert.strictEqual(result.metadata.snapshot.projectPath, 'src/example.js')
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
  assert.strictEqual(result.metadata.snapshot.entries[0].value, '你好')
})

test('commits an empty Vue template snapshot and skips excluded scripts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-'))
  fs.mkdirSync(path.join(root, 'src'))
  const template = '<template><p>hello</p></template>'
  const vuePath = path.join(root, 'src/App.vue')
  fs.writeFileSync(vuePath, template)
  const templateResult = runLoader({
    root,
    source: template,
    sourceMap: null,
    meta: { kind: 'template' },
    resourcePath: vuePath,
    resourceQuery: '?vue&type=template&id=abc&scoped=true&prod=true'
  })
  assert.strictEqual(templateResult.nextSource, template)
  assert.strictEqual(templateResult.nextMeta.kind, 'template')
  assert.strictEqual(templateResult.metadata.included, true)
  assert.strictEqual(templateResult.metadata.snapshot.identity, 'src/App.vue::template[lang=html]')
  assert.deepStrictEqual(templateResult.metadata.snapshot.entries, [])

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
  assert.strictEqual(excludedResult.metadata.invoked, true)
  assert.strictEqual(excludedResult.metadata.included, false)
  assert.strictEqual(excludedResult.metadata.snapshot, null)

  const extracted = 'export default { title: "标题" }\n'
  fs.writeFileSync(vuePath, `<template><p></p></template>\n<script>\n${extracted}</script>\n`)
  const scriptResult = runLoader({
    root,
    source: extracted,
    sourceMap: { version: 3, mappings: '' },
    meta: { kind: 'script' },
    resourcePath: vuePath,
    resourceQuery: '?vue&type=script&id=abc&scoped=true&prod=true'
  })
  assert.strictEqual(scriptResult.nextSource, extracted)
  assert.strictEqual(scriptResult.metadata.snapshot.entries[0].value, '标题')
  assert.strictEqual(scriptResult.nextMap.mappings, '')
  assert.strictEqual(scriptResult.metadata.snapshot.identity, 'src/App.vue::script[lang=js]')
  assert.notStrictEqual(
    scriptResult.metadata.snapshot.identity,
    templateResult.metadata.snapshot.identity
  )
})

test('a script parse error names the project path, block, and source location', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-'))
  const source = 'const message = "你好\n'
  const { thrown } = runLoader({
    root,
    source,
    sourceMap: null,
    meta: null,
    resourcePath: path.join(root, 'src/example.js')
  })
  assert.ok(thrown)
  assert.match(thrown.message, /src\/example\.js/)
  assert.match(thrown.message, /script/)
  assert.match(thrown.message, /line 1/)
  assert.match(thrown.message, /column 16/)
  assert.match(thrown.message, /Unterminated string constant/)
})

test('a Vue template expression error names the project path, block, and source location', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-'))
  fs.mkdirSync(path.join(root, 'src'))
  const source = '<template>\n  <p>{{ \'你好\' + }}</p>\n</template>\n'
  const vuePath = path.join(root, 'src/App.vue')
  fs.writeFileSync(vuePath, source)
  const { thrown } = runLoader({
    root,
    source,
    sourceMap: null,
    meta: null,
    resourcePath: vuePath,
    resourceQuery: '?vue&type=template&id=abc'
  })
  assert.ok(thrown)
  assert.match(thrown.message, /src\/App\.vue/)
  assert.match(thrown.message, /template/)
  assert.match(thrown.message, /line 2/)
  assert.match(thrown.message, /column 15/)
})

test('reads an external Vue template from the requested file and does not guess a source block', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-'))
  fs.mkdirSync(path.join(root, 'src'))
  const vuePath = path.join(root, 'src/App.vue')
  const htmlPath = path.join(root, 'src/copy.html')
  fs.writeFileSync(vuePath, '<template src="./copy.html">\n  <p>诱饵文案</p>\n</template>\n')
  fs.writeFileSync(htmlPath, '<p>外部文案</p>\n')
  const external = runLoader({
    root,
    source: '<p>外部文案</p>\n',
    sourceMap: { version: 3, mappings: 'AAAA' },
    meta: { kind: 'template' },
    resourcePath: htmlPath,
    resourceQuery: '?vue&type=template&id=abc&scoped=true'
  })
  assert.strictEqual(external.nextSource, '<p>外部文案</p>\n')
  assert.deepStrictEqual(external.nextMap, { version: 3, mappings: 'AAAA' })
  assert.strictEqual(external.nextMeta.kind, 'template')
  assert.strictEqual(external.metadata.snapshot.identity, 'src/copy.html::template[lang=html]')
  assert.strictEqual(external.metadata.snapshot.entries[0].value, '外部文案')
  assert.strictEqual(external.metadata.snapshot.entries[0].locations[0].path, 'src/copy.html')
  assert.strictEqual(external.metadata.snapshot.entries[0].locations[0].kind, 'html-text')

  const inline = runLoader({
    root,
    source: fs.readFileSync(vuePath, 'utf8'),
    sourceMap: null,
    meta: null,
    resourcePath: vuePath,
    resourceQuery: '?vue&type=template&id=abc'
  })
  assert.match(inline.thrown.message, /could not be located/)
  assert.match(inline.thrown.message, /src\/App\.vue/)
  assert.match(inline.thrown.message, /template/)
})

test('collects standalone HTML in place and returns the template bytes unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-'))
  fs.mkdirSync(path.join(root, 'public'))
  const source = '<p title="说明">页面文案</p>\n<p><%= htmlWebpackPlugin.options.title %></p>\n'
  const htmlPath = path.join(root, 'public/index.html')
  fs.writeFileSync(htmlPath, source)
  const result = runLoader({
    root,
    source,
    sourceMap: { version: 3, mappings: 'AAAA' },
    meta: { kind: 'html' },
    resourcePath: htmlPath
  })
  assert.strictEqual(result.error, null)
  assert.strictEqual(result.nextSource, source)
  assert.deepStrictEqual(result.nextMap, { version: 3, mappings: 'AAAA' })
  assert.strictEqual(result.nextMeta.kind, 'html')
  assert.strictEqual(result.metadata.snapshot.identity, 'public/index.html::html')
  assert.deepStrictEqual(result.metadata.snapshot.entries.map(entry => entry.value), ['说明', '页面文案'])
  assert.deepStrictEqual(result.metadata.snapshot.entries.map(entry => entry.locations[0].kind), [
    'static-html-attribute',
    'static-html-text'
  ])
})

test('a standalone HTML parse error names the project path and source location', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-'))
  fs.mkdirSync(path.join(root, 'public'))
  const source = '<p title="甲" title="乙">文案</p>\n'
  const htmlPath = path.join(root, 'public/index.html')
  fs.writeFileSync(htmlPath, source)
  const { thrown } = runLoader({
    root,
    source,
    sourceMap: null,
    meta: null,
    resourcePath: htmlPath
  })
  assert.ok(thrown)
  assert.match(thrown.message, /public\/index\.html/)
  assert.match(thrown.message, /html/)
  assert.match(thrown.message, /line 1/)
  assert.match(thrown.message, /duplicate-attribute/)
})

test('registers an existing configuration file and a missing one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-'))
  fs.mkdirSync(path.join(root, 'src'))
  const configFile = path.join(root, 'i18n-collect.config.js')
  fs.writeFileSync(configFile, 'module.exports = { include: ["src"] }\n')
  const present = runLoader({
    root,
    source: 'module.exports = "你好"\n',
    sourceMap: null,
    meta: null,
    resourcePath: path.join(root, 'src/example.js')
  })
  assert.deepStrictEqual(present.dependencies, [configFile])
  assert.deepStrictEqual(present.missing, [])

  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-'))
  const absent = runLoader({
    root: bare,
    source: 'module.exports = "你好"\n',
    sourceMap: null,
    meta: null,
    resourcePath: path.join(bare, 'src/example.js')
  })
  assert.deepStrictEqual(absent.dependencies, [])
  assert.deepStrictEqual(absent.missing, [path.join(bare, 'i18n-collect.config.js')])
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

  const stats = await new Promise((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close(closeError => {
        if (error) reject(error)
        else if (closeError) reject(closeError)
        else if (result.hasErrors()) reject(new Error(result.toJson().errors.map(item => item.message).join('\n')))
        else resolve(result)
      })
    })
  })

  const seen = JSON.parse(fs.readFileSync(recordFile, 'utf8'))
  assert.strictEqual(seen.content, source)
  assert.deepStrictEqual(seen.map, { version: 3, file: 'app.js', mappings: 'AAAA', sources: ['src/app.js'] })
  assert.deepStrictEqual(seen.meta, { fromUpstream: true })
  const collected = [...stats.compilation.modules]
    .map(mod => mod.buildInfo && mod.buildInfo.i18nCollect)
    .filter(meta => meta && meta.snapshot)
  assert.ok(collected.some(meta => meta.snapshot.entries.some(entry => entry.value === '你好')))
})
