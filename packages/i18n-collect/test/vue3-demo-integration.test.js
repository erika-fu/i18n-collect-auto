const assert = require('assert')
const fs = require('fs')
const path = require('path')
const test = require('node:test')
const webpack = require('webpack')

const demoRoot = path.resolve(__dirname, '../../../apps/vue3-demo')

function compile(config) {
  return new Promise((resolve, reject) => {
    const compiler = webpack(config)
    compiler.run((error, stats) => {
      compiler.close(closeError => {
        if (error) reject(error)
        else if (closeError) reject(closeError)
        else resolve(stats)
      })
    })
  })
}

function messages(stats) {
  return stats.toJson({ errors: true }).errors.map(error => error.message).join('\n')
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(demoRoot, relativePath), 'utf8'))
}

function sourceSlice(relativePath, location) {
  const source = fs.readFileSync(path.join(demoRoot, relativePath), 'utf8')
  const line = source.split(/\r?\n/)[location.start.line - 1]
  return line.slice(location.start.column, location.end.column)
}

test('the Vue 3 demo production build covers every supported source kind', { timeout: 60000 }, async () => {
  const config = require('../../../apps/vue3-demo/webpack.config')
  const stats = await compile(config)

  assert.strictEqual(stats.hasErrors(), false, messages(stats))
  for (const relativePath of [
    'lang/zh_hash.json',
    'lang/zh_hash.map.json',
    'lang/catalog/zh.json',
    'lang/catalog/catalog.meta.json'
  ]) {
    assert.strictEqual(fs.existsSync(path.join(demoRoot, relativePath)), true, relativePath)
  }

  const dictionary = readJson('lang/zh_hash.json')
  const sourceMap = readJson('lang/zh_hash.map.json')
  const catalog = readJson('lang/catalog/zh.json')
  const metadata = readJson('lang/catalog/catalog.meta.json')
  const values = new Set(Object.values(dictionary))

  const expected = [
    { value: '脚本文案', source: "'脚本文案'", kind: 'script-string', path: 'src/App.vue' },
    { value: '脚本模板文案', kind: 'template-literal', path: 'src/App.vue' },
    { value: '原生 Vue 三模板', kind: 'html-text', path: 'src/App.vue' },
    { value: '保存资料', kind: 'html-attribute', path: 'src/App.vue' },
    { value: '资料名称', kind: 'html-attribute', path: 'src/App.vue' },
    { value: '输入', kind: 'html-attribute', path: 'src/App.vue' },
    { value: '名称', kind: 'html-attribute', path: 'src/App.vue' },
    { value: '插值字符串', source: "'插值字符串'", kind: 'template-expression', path: 'src/App.vue' },
    { value: '欢迎', kind: 'template-expression', path: 'src/App.vue' },
    { value: '回来', kind: 'template-expression', path: 'src/App.vue' },
    { value: '样式提示', kind: 'css-generated-content', path: 'src/App.vue' },
    { value: '外部样式提示', kind: 'css-generated-content', path: 'src/base.css' },
    { value: 'Vue 三静态页面文案', kind: 'static-html-text', path: 'public/index.html' },
    { value: 'Vue 三静态属性', kind: 'static-html-attribute', path: 'public/index.html' }
  ]

  for (const item of expected) {
    assert.strictEqual(values.has(item.value), true, item.value)
    const entry = sourceMap.entries.find(candidate => candidate.value === item.value)
    assert.ok(entry, item.value)
    const location = entry.locations.find(candidate => (
      candidate.path === item.path && candidate.kind === item.kind
    ))
    assert.ok(location, `${item.value} should be ${item.kind} in ${item.path}`)
    assert.strictEqual(sourceSlice(item.path, location), item.source || item.value)
  }

  assert.strictEqual(values.has('内部标记不收集'), false)
  assert.strictEqual(values.has('普通指令不收集'), false)
  assert.strictEqual(catalog['vue3.heading'], '原生 Vue 三模板')
  assert.strictEqual(catalog['vue3.htmlNotice'], '已通过 Vue I18n 本地化')
  assert.strictEqual(metadata.entries['vue3.heading'].representation, 'source-text')
  assert.strictEqual(metadata.entries['vue3.htmlNotice'].representation, 'localized-call')
  assert.ok(metadata.entries['vue3.htmlNotice'].locations.some(location => (
    location.path === 'src/App.vue' &&
    location.kind === 'template-expression' &&
    sourceSlice(location.path, location) === "'vue3.htmlNotice'"
  )))
})
