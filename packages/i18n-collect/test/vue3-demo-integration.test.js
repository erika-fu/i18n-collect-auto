const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const test = require('node:test')

const demoRoot = path.resolve(__dirname, '../../../apps/vue3-demo')
const bin = path.join(__dirname, '../bin/i18n-collect.js')

function run(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: demoRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', NODE_ENV: 'production' },
    timeout: 300000
  })
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(demoRoot, relativePath), 'utf8'))
}

test('the Vue 3 demo scan, check, and build replacement stay coherent', { timeout: 300000 }, () => {
  const appBefore = fs.readFileSync(path.join(demoRoot, 'src/App.vue'))

  const scanned = run(['scan', '--json'])
  assert.strictEqual(scanned.status, 0, scanned.stderr || scanned.stdout)
  const scanReport = JSON.parse(scanned.stdout)
  assert.strictEqual(scanReport.ok, true)

  const sourceCatalog = readJson('lang/catalog/source-catalog.json')
  assert.strictEqual(sourceCatalog['vue3.heading'], '原生 Vue 三模板')
  assert.strictEqual(sourceCatalog['vue3.build.title'], '构建替换演示')
  assert.strictEqual(sourceCatalog['vue3.welcomeBack'], '欢迎{name}回来')
  assert.strictEqual(sourceCatalog['vue3.fieldPlaceholder'], '输入{field}名称')
  assert.ok(Object.values(sourceCatalog).includes('脚本文案'))
  assert.ok(Object.values(sourceCatalog).includes('脚本模板文案'))
  assert.ok(Object.values(sourceCatalog).includes('插值字符串'))
  assert.ok(!Object.values(sourceCatalog).includes('欢迎'))
  assert.ok(!Object.values(sourceCatalog).includes('回来'))

  const analysis = readJson('lang/catalog/analysis-report.json')
  assert.ok(Array.isArray(analysis.auditFindings))
  assert.ok(analysis.auditFindings.some(item => (
    item.disposition === 'intentionally-ignored' &&
    /i18n-ignore|ignoreReason|reason/i.test(JSON.stringify(item))
  )))

  const checked = run(['check', '--json'])
  assert.strictEqual(checked.status, 0, checked.stderr || checked.stdout)
  const checkReport = JSON.parse(checked.stdout)
  assert.strictEqual(checkReport.ok, true)
  assert.ok(checkReport.policy)
  assert.strictEqual(checkReport.policy.ok, true)

  const built = run(['build', '--json'])
  assert.strictEqual(built.status, 0, built.stderr || built.stdout)
  assert.ok(built.stdout.includes('"ok": true') || built.stdout.includes('"ok":true'), built.stdout)
  assert.deepStrictEqual(fs.readFileSync(path.join(demoRoot, 'src/App.vue')), appBefore)

  const catalog = readJson('lang/catalog/zh.json')
  assert.strictEqual(catalog['vue3.heading'], '原生 Vue 三模板')
  assert.strictEqual(catalog['vue3.htmlNotice'], '已通过 Vue I18n 本地化')
  assert.strictEqual(catalog['vue3.build.title'], '构建替换演示')

  const fixtureStyle = fs.readFileSync(path.join(demoRoot, 'fixtures/StyleCollection.vue'), 'utf8')
  assert.match(fixtureStyle, /样式提示/)
  assert.match(fixtureStyle, /Vue 3 SCSS 样式/)
  const fixtureHtml = fs.readFileSync(path.join(demoRoot, 'fixtures/StaticHtmlSnippet.html'), 'utf8')
  assert.match(fixtureHtml, /Vue 三静态页面文案/)
  const fixtureCss = fs.readFileSync(path.join(demoRoot, 'fixtures/StandaloneStyle.css'), 'utf8')
  assert.match(fixtureCss, /外部样式提示/)
})
