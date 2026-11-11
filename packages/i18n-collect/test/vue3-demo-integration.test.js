const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const test = require('node:test')

const demoRoot = path.resolve(__dirname, '../../../apps/vue3-demo')
const bin = path.join(__dirname, '../bin/i18n-collect.js')

function runBuild() {
  return spawnSync(process.execPath, [bin, 'build', '--json'], {
    cwd: demoRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', NODE_ENV: 'production' },
    timeout: 300000
  })
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(demoRoot, relativePath), 'utf8'))
}

function sourceSlice(relativePath, location) {
  const source = fs.readFileSync(path.join(demoRoot, relativePath), 'utf8')
  const line = source.split(/\r?\n/)[location.start.line - 1]
  return line.slice(location.start.column, location.end.column)
}

test('the Vue 3 demo production build covers replaceable source kinds used by Build replacement', { timeout: 300000 }, () => {
  const appBefore = fs.readFileSync(path.join(demoRoot, 'src/App.vue'))
  const result = runBuild()
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
  assert.ok(result.stdout.includes('"ok": true') || result.stdout.includes('"ok":true'), result.stdout)
  assert.deepStrictEqual(fs.readFileSync(path.join(demoRoot, 'src/App.vue')), appBefore)

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
    { value: '构建替换演示', kind: 'html-text', path: 'src/App.vue' }
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
  for (const value of [
    '样式提示',
    '外部样式提示',
    'Vue 3 SCSS 样式',
    'Vue 三静态页面文案',
    'Vue 三静态属性'
  ]) {
    assert.strictEqual(values.has(value), false, value)
  }

  assert.strictEqual(catalog['vue3.heading'], '原生 Vue 三模板')
  assert.strictEqual(catalog['vue3.htmlNotice'], '已通过 Vue I18n 本地化')
  assert.strictEqual(catalog['vue3.build.title'], '构建替换演示')
  assert.strictEqual(metadata.entries['vue3.heading'].representation, 'source-text')
  assert.strictEqual(metadata.entries['vue3.htmlNotice'].representation, 'localized-call')
  assert.ok(metadata.entries['vue3.htmlNotice'].locations.some(location => (
    location.path === 'src/App.vue' &&
    location.kind === 'template-expression' &&
    sourceSlice(location.path, location) === "'vue3.htmlNotice'"
  )))

  const fixtureStyle = fs.readFileSync(path.join(demoRoot, 'fixtures/StyleCollection.vue'), 'utf8')
  assert.match(fixtureStyle, /样式提示/)
  assert.match(fixtureStyle, /Vue 3 SCSS 样式/)
  const fixtureHtml = fs.readFileSync(path.join(demoRoot, 'fixtures/StaticHtmlSnippet.html'), 'utf8')
  assert.match(fixtureHtml, /Vue 三静态页面文案/)
  const fixtureCss = fs.readFileSync(path.join(demoRoot, 'fixtures/StandaloneStyle.css'), 'utf8')
  assert.match(fixtureCss, /外部样式提示/)
})
