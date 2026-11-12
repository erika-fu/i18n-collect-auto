const assert = require('assert')
const test = require('node:test')
const { analyzeProject, buildSourceCatalog } = require('../mycommon/project-analysis')
const { keyFor } = require('../mycommon/store')
const { describeResource } = require('../myloader/resource')

function findingFields(finding) {
  return {
    key: finding.key || keyFor(finding.text),
    text: finding.text,
    semanticRole: finding.semanticRole,
    resourceIdentity: finding.resourceIdentity,
    location: finding.location,
    capability: finding.capability
  }
}

test('JavaScript and TypeScript findings share the same automatic key and finding fields', () => {
  const analysis = analyzeProject({
    files: [
      { path: 'src/app.js', source: 'const message = "统一文案"\n' },
      { path: 'src/app.ts', source: 'const message: string = "统一文案"\n' }
    ]
  })
  assert.strictEqual(analysis.runtimeMessages.length, 2)
  const keys = analysis.runtimeMessages.map(item => item.key || keyFor(item.text))
  assert.deepStrictEqual(keys, [keyFor('统一文案'), keyFor('统一文案')])
  for (const finding of analysis.runtimeMessages) {
    const fields = findingFields(finding)
    assert.strictEqual(fields.text, '统一文案')
    assert.strictEqual(fields.semanticRole, 'script-string')
    assert.strictEqual(fields.capability, 'automatically-runtime-localizable')
    assert.ok(fields.resourceIdentity)
    assert.ok(fields.location.path)
    assert.ok(fields.location.start)
    assert.ok(fields.location.end)
  }
  assert.strictEqual(analysis.runtimeMessages[0].resourceIdentity, 'src/app.js::script')
  assert.strictEqual(analysis.runtimeMessages[1].resourceIdentity, 'src/app.ts::script')
  assert.deepStrictEqual(buildSourceCatalog(analysis), { [keyFor('统一文案')]: '统一文案' })
})

test('Vue script setup findings use the shared pipeline fields including resource identity', () => {
  const analysis = analyzeProject({
    files: [{
      path: 'src/App.vue',
      source: [
        '<script setup lang="ts">',
        'const title: string = "设置标题"',
        'const call = t("nav.home")',
        '</script>',
        ''
      ].join('\n')
    }],
    externalKeys: ['nav.home']
  })
  assert.strictEqual(analysis.runtimeMessages.length, 1)
  const finding = analysis.runtimeMessages[0]
  assert.strictEqual(finding.text, '设置标题')
  assert.strictEqual(finding.sourceSurface, 'vue-script')
  assert.strictEqual(finding.semanticRole, 'script-string')
  assert.strictEqual(finding.capability, 'automatically-runtime-localizable')
  assert.strictEqual(finding.resourceIdentity, 'src/App.vue::script[lang=ts;setup=true]')
  assert.strictEqual(finding.key || keyFor(finding.text), keyFor('设置标题'))

  assert.strictEqual(analysis.localizedCallFindings.length, 1)
  const call = analysis.localizedCallFindings[0]
  assert.strictEqual(call.key, 'nav.home')
  assert.strictEqual(call.capability, 'already-localized')
  assert.strictEqual(call.resourceIdentity, 'src/App.vue::script[lang=ts;setup=true]')
})

test('Options API and script setup blocks keep distinct resource identities', () => {
  const analysis = analyzeProject({
    files: [{
      path: 'src/Dual.vue',
      source: [
        '<script>',
        'export default { data() { return { label: "选项文案" } } }',
        '</script>',
        '<script setup lang="ts">',
        'const title: string = "设置文案"',
        '</script>',
        ''
      ].join('\n')
    }]
  })
  const byText = new Map(analysis.runtimeMessages.map(item => [item.text, item]))
  assert.strictEqual(byText.get('选项文案').resourceIdentity, 'src/Dual.vue::script[lang=js]')
  assert.strictEqual(byText.get('设置文案').resourceIdentity, 'src/Dual.vue::script[lang=ts;setup=true]')
})

test('describeResource encodes Vue script setup separately from ordinary script', () => {
  const file = '/project/src/App.vue'
  assert.strictEqual(
    describeResource({ root: '/project', resourcePath: file, resourceQuery: '?vue&type=script&lang=js' }).identity,
    'src/App.vue::script[lang=js]'
  )
  assert.strictEqual(
    describeResource({
      root: '/project',
      resourcePath: file,
      resourceQuery: '?vue&type=script&lang=ts&setup=true'
    }).identity,
    'src/App.vue::script[lang=ts;setup=true]'
  )
  assert.notStrictEqual(
    describeResource({
      root: '/project',
      resourcePath: file,
      resourceQuery: '?vue&type=script&lang=js'
    }).identity,
    describeResource({
      root: '/project',
      resourcePath: file,
      resourceQuery: '?vue&type=script&lang=js&setup=true'
    }).identity
  )
})

test('placeholder contract conflicts in TypeScript script setup fail closed', () => {
  assert.throws(
    () => analyzeProject({
      files: [{
        path: 'src/Bad.vue',
        source: [
          '<script setup lang="ts">',
          "const notice = t('terms.notice', { link, policy })",
          '</script>',
          ''
        ].join('\n')
      }],
      explicitMessages: [
        { key: 'terms.notice', source: '请阅读我们的{terms}与{privacy}' }
      ]
    }),
    /placeholder mismatch|placeholder/
  )
})

test('key conflicts in script setup fail closed', () => {
  assert.throws(
    () => analyzeProject({
      files: [{
        path: 'src/Conflict.vue',
        source: [
          '<script setup>',
          'const a = /* i18n-key: home.title */ "你好"',
          'const b = /* i18n-key: home.title */ "欢迎"',
          '</script>',
          ''
        ].join('\n')
      }]
    }),
    /conflicting source text|home\.title/
  )
})
