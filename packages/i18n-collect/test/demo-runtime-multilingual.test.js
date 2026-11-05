const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { demoLocaleMessages, resolveDemoMessage } = require('../../../apps/demo/src/lang/resolve')
const { installVue2 } = require('./vue2-fixture')

const bin = path.join(__dirname, '../bin/i18n-collect.js')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

test('vue demo multilingual page resolves English through explicit localization', () => {
  const zh = require('../../../apps/demo/lang/catalog/zh.json')
  const en = require('../../../apps/demo/lang/catalog/en.json')
  const hashDictionary = require('../../../apps/demo/lang/zh_hash.json')
  const meta = require('../../../apps/demo/lang/catalog/catalog.meta.json')
  const boundaries = require('../../../apps/demo/lang/catalog/runtime-multilingual-boundaries.json')

  assert.deepStrictEqual(boundaries.boundaries[0].include, ['src/pages/multilingual'])
  assert.strictEqual(zh['demo.multilingual.title'], '运行时多语言边界')
  assert.strictEqual(zh['demo.multilingual.body'], '你好，{name}。此页仅通过显式本地化渲染。')
  assert.strictEqual(en['demo.multilingual.title'], 'Runtime multilingual boundary')
  assert.strictEqual(
    en['demo.multilingual.body'],
    'Hello, {name}. This page renders only through explicit localization.'
  )
  assert.strictEqual(meta.entries['demo.multilingual.title'].origin, 'explicit')
  assert.strictEqual(meta.entries['demo.multilingual.body'].origin, 'explicit')
  assert.strictEqual(meta.entries['demo.multilingual.title'].representation, 'localized-call')
  assert.strictEqual(meta.entries['demo.multilingual.body'].representation, 'localized-call')

  assert.strictEqual(
    resolveDemoMessage('demo.multilingual.title', en, hashDictionary),
    'Runtime multilingual boundary'
  )

  const Vue = require('vue')
  const VueI18n = require('vue-i18n')
  Vue.use(VueI18n)
  const vm = new Vue({
    i18n: new VueI18n({
      locale: 'en',
      messages: {
        en: demoLocaleMessages(en, hashDictionary),
        zh: demoLocaleMessages(zh, hashDictionary)
      }
    })
  })
  assert.strictEqual(vm.$t('demo.multilingual.title'), 'Runtime multilingual boundary')
  assert.strictEqual(
    vm.$t('demo.multilingual.body', { name: 'Erika' }),
    'Hello, Erika. This page renders only through explicit localization.'
  )
  vm.$destroy()
})

test('react demo multilingual panel resolves English through explicit localization', () => {
  const { setLocale, t } = require('../../../apps/react-demo/src/multilingual/i18n')
  const meta = require('../../../apps/react-demo/lang/catalog/catalog.meta.json')
  const zh = require('../../../apps/react-demo/lang/catalog/zh.json')
  const en = require('../../../apps/react-demo/lang/catalog/en.json')
  const boundaries = require('../../../apps/react-demo/lang/catalog/runtime-multilingual-boundaries.json')

  assert.deepStrictEqual(boundaries.boundaries[0].include, ['src/multilingual'])
  assert.strictEqual(zh['react.multilingual.title'], '运行时多语言边界')
  assert.strictEqual(zh['react.multilingual.body'], '你好，{name}。此页仅通过显式本地化渲染。')
  assert.strictEqual(en['react.multilingual.title'], 'Runtime multilingual boundary')
  assert.strictEqual(meta.entries['react.multilingual.title'].origin, 'explicit')
  assert.strictEqual(meta.entries['react.multilingual.body'].representation, 'localized-call')

  setLocale('en')
  assert.strictEqual(t('react.multilingual.title'), 'Runtime multilingual boundary')
  assert.strictEqual(
    t('react.multilingual.body', { name: 'Erika' }),
    'Hello, Erika. This page renders only through explicit localization.'
  )
})

test('committed demos pass check-policy with runtime-multilingual boundaries', () => {
  for (const demo of ['demo', 'react-demo']) {
    const demoRoot = path.join(__dirname, `../../../apps/${demo}`)
    const result = run(['check-policy', '--json', '--cwd', demoRoot])
    assert.strictEqual(result.status, 0, `${demo}: ${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.strictEqual(report.ok, true)
    assert.deepStrictEqual(report.runtimeMultilingualViolations, [])
  }
})

test('a direct literal inside a declared demo boundary fails validation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-demo-boundary-literal-'))
  fs.mkdirSync(path.join(root, 'src/pages/multilingual'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), 'const ok = "完整静态"\n')
  fs.writeFileSync(
    path.join(root, 'src/pages/multilingual/Broken.vue'),
    '<template><p>非法直接中文</p></template>\n'
  )
  fs.writeFileSync(
    path.join(root, 'lang/catalog/runtime-multilingual-boundaries.json'),
    `${JSON.stringify({
      version: 1,
      boundaries: [{ id: 'demo-multilingual', include: ['src/pages/multilingual'] }]
    }, null, 2)}\n`
  )
  installVue2(root)
  const result = run(['check-policy'], root)
  assert.strictEqual(result.status, 2, result.stderr)
  assert.match(result.stderr, /runtime-multilingual-literal/)
  assert.match(result.stderr, /非法直接中文/)
})
