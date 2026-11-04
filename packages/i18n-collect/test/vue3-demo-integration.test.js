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

test('the Vue 3 demo production build collects original SFC source ranges', { timeout: 60000 }, async () => {
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

  for (const value of [
    '原生 Vue 三模板',
    '保存资料',
    '输入',
    '名称',
    '欢迎',
    '回来',
    '脚本文案',
    '样式提示'
  ]) {
    assert.strictEqual(values.has(value), true, value)
  }
  assert.strictEqual(values.has('内部标记不收集'), false)
  assert.strictEqual(catalog['vue3.heading'], '原生 Vue 三模板')
  assert.strictEqual(catalog['vue3.htmlNotice'], '已通过 Vue I18n 本地化')
  assert.strictEqual(metadata.entries['vue3.htmlNotice'].representation, 'localized-call')

  const source = fs.readFileSync(path.join(demoRoot, 'src/App.vue'), 'utf8')
  for (const value of ['原生 Vue 三模板', '保存资料', '欢迎', '指令文案']) {
    const entry = sourceMap.entries.find(candidate => candidate.value === value)
    assert.ok(entry, value)
    const location = entry.locations.find(candidate => candidate.path === 'src/App.vue')
    assert.ok(location, value)
    const line = source.split(/\r?\n/)[location.start.line - 1]
    assert.strictEqual(
      line.slice(location.start.column, location.end.column),
      value,
      `${value} should point into the original App.vue source`
    )
  }
})
