const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { analyzeProject, analysisReport, buildSourceCatalog } = require('../mycommon/project-analysis')
const { keyFor } = require('../mycommon/store')
const { installVue3 } = require('./vue3-fixture')

test('analyzeProject classifies complete static JavaScript copy as automatically runtime-localizable', () => {
  const analysis = analyzeProject({
    files: [{ path: 'src/app.js', source: 'const message = "你好"\n' }]
  })

  assert.strictEqual(analysis.auditFindings.length, 0)
  assert.strictEqual(analysis.explicitRequiredFindings.length, 0)
  assert.strictEqual(analysis.localizedCallFindings.length, 0)
  assert.strictEqual(analysis.runtimeMessages.length, 1)

  const finding = analysis.runtimeMessages[0]
  assert.strictEqual(finding.text, '你好')
  assert.strictEqual(finding.location.path, 'src/app.js')
  assert.deepStrictEqual(finding.location.start, { line: 1, column: 16 })
  assert.deepStrictEqual(finding.location.end, { line: 1, column: 20 })
  assert.strictEqual(finding.sourceSurface, 'javascript')
  assert.strictEqual(finding.semanticRole, 'script-string')
  assert.strictEqual(finding.capability, 'automatically-runtime-localizable')
})

test('analyzeProject classifies complete static TypeScript copy as automatically runtime-localizable', () => {
  const analysis = analyzeProject({
    files: [{ path: 'src/app.ts', source: 'const message: string = "欢迎"\n' }]
  })
  assert.strictEqual(analysis.runtimeMessages.length, 1)
  assert.strictEqual(analysis.runtimeMessages[0].text, '欢迎')
  assert.strictEqual(analysis.runtimeMessages[0].sourceSurface, 'typescript')
  assert.strictEqual(analysis.runtimeMessages[0].capability, 'automatically-runtime-localizable')
})

test('analyzeProject classifies static t/$t/this.$t calls as already localized with their key', () => {
  const analysis = analyzeProject({
    files: [{
      path: 'src/calls.js',
      source: [
        'const a = t("greeting.hello")',
        'const b = $t("greeting.world")',
        'const c = this.$t("greeting.again")'
      ].join('\n')
    }]
  })
  assert.strictEqual(analysis.runtimeMessages.length, 0)
  assert.strictEqual(analysis.localizedCallFindings.length, 3)
  const keys = analysis.localizedCallFindings.map(item => item.key).sort()
  assert.deepStrictEqual(keys, ['greeting.again', 'greeting.hello', 'greeting.world'])
  for (const finding of analysis.localizedCallFindings) {
    assert.strictEqual(finding.capability, 'already-localized')
    assert.strictEqual(finding.sourceSurface, 'javascript')
    assert.strictEqual(finding.semanticRole, 'script-string')
    assert.strictEqual(finding.text, finding.key)
  }
})

test('analyzeProject reports coverage totals that distinguish discovery from runtime localization', () => {
  const analysis = analyzeProject({
    files: [{
      path: 'src/mixed.js',
      source: 'const message = "你好"\nconst label = t("nav.home")\n'
    }]
  })
  assert.deepStrictEqual(analysis.coverage, {
    sourceDiscovery: { total: 2 },
    runtimeLocalization: {
      total: 2,
      automaticallyRuntimeLocalizable: 1,
      alreadyLocalized: 1
    },
    chineseSourceAudit: {
      total: 0,
      unresolved: 0,
      intentionallyIgnored: 0
    }
  })
})

test('analyzeProject classifies Vue template text and supported attributes as automatically runtime-localizable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-analysis-vue-'))
  installVue3(root)
  const absolutePath = path.join(root, 'src', 'App.vue')
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  const source = [
    '<template>',
    '  <button title="保存">提交</button>',
    '</template>',
    '<script>',
    'export default { name: "App" }',
    '</script>',
    ''
  ].join('\n')
  fs.writeFileSync(absolutePath, source)

  const analysis = analyzeProject({
    files: [{ path: 'src/App.vue', source, absolutePath }],
    config: { vueVersion: 3, attributeAllowlist: ['title', 'placeholder', 'alt', 'aria-label'] }
  })

  const texts = analysis.runtimeMessages.map(item => item.text).sort()
  assert.deepStrictEqual(texts, ['保存', '提交'])
  assert.ok(analysis.runtimeMessages.every(item => item.sourceSurface === 'vue-template'))
  assert.ok(analysis.runtimeMessages.every(item => item.capability === 'automatically-runtime-localizable'))
  const roles = new Set(analysis.runtimeMessages.map(item => item.semanticRole))
  assert.ok(roles.has('html-text'))
  assert.ok(roles.has('html-attribute'))
})

test('buildSourceCatalog assigns deterministic text-hash keys for automatic messages', () => {
  const analysis = analyzeProject({
    files: [{ path: 'src/app.js', source: 'const a = "你好"\nconst b = "你好"\nconst c = t("nav.home")\n' }]
  })
  assert.deepStrictEqual(buildSourceCatalog(analysis), { [keyFor('你好')]: '你好' })
  const report = analysisReport(analysis)
  assert.strictEqual(report.version, 1)
  assert.strictEqual(report.runtimeMessages.length, 2)
  assert.strictEqual(report.localizedCallFindings.length, 1)
})

test('analyzeProject classifies standalone HTML text and allowlisted attributes as unresolved audit findings', () => {
  const analysis = analyzeProject({
    files: [{
      path: 'public/index.html',
      source: [
        '<!DOCTYPE html>',
        '<html><body>',
        '  <!-- 页面说明 -->',
        '  <p title="保存" class="不收集">页面文案</p>',
        '  <script>const hidden = "脚本中文"</script>',
        '  <style>.x::before { content: "样式中文"; }</style>',
        '</body></html>',
        ''
      ].join('\n')
    }],
    config: { attributeAllowlist: ['title', 'placeholder', 'alt', 'aria-label'] }
  })

  assert.strictEqual(analysis.runtimeMessages.length, 0)
  assert.strictEqual(analysis.localizedCallFindings.length, 0)
  assert.strictEqual(analysis.explicitRequiredFindings.length, 0)
  assert.strictEqual(analysis.auditFindings.length, 2)

  const byText = new Map(analysis.auditFindings.map(item => [item.text, item]))
  assert.ok(byText.has('保存'))
  assert.ok(byText.has('页面文案'))
  for (const finding of analysis.auditFindings) {
    assert.strictEqual(finding.sourceSurface, 'standalone-html')
    assert.strictEqual(finding.capability, 'chinese-source-audit')
    assert.strictEqual(finding.disposition, 'unresolved')
    assert.strictEqual(finding.key, undefined)
    assert.strictEqual(finding.location.path, 'public/index.html')
  }
  assert.strictEqual(byText.get('保存').semanticRole, 'static-html-attribute')
  assert.strictEqual(byText.get('页面文案').semanticRole, 'static-html-text')
  assert.deepStrictEqual(analysis.coverage, {
    sourceDiscovery: { total: 2 },
    runtimeLocalization: {
      total: 0,
      automaticallyRuntimeLocalizable: 0,
      alreadyLocalized: 0
    },
    chineseSourceAudit: {
      total: 2,
      unresolved: 2,
      intentionallyIgnored: 0
    }
  })
  assert.deepStrictEqual(buildSourceCatalog(analysis), {})
})

test('analyzeProject never attaches localization keys to standalone HTML audit findings', () => {
  const analysis = analyzeProject({
    files: [{
      path: 'public/index.html',
      source: '<!-- i18n-key: doc.heading -->\n<p title="提示">正文</p>\n'
    }],
    config: { attributeAllowlist: ['title'] }
  })
  assert.strictEqual(analysis.auditFindings.length, 2)
  assert.ok(analysis.auditFindings.every(item => item.key === undefined))
  assert.deepStrictEqual(buildSourceCatalog(analysis), {})
})

test('analyzeProject keeps reasoned i18n-ignore HTML findings as intentionally ignored', () => {
  const analysis = analyzeProject({
    files: [{
      path: 'public/index.html',
      source: [
        '<!DOCTYPE html>',
        '<html><body>',
        '  <!-- i18n-ignore: brand stays Chinese -->',
        '  <p title="品牌">欢迎</p>',
        '  <p>未忽略</p>',
        '</body></html>',
        ''
      ].join('\n')
    }],
    config: { attributeAllowlist: ['title'] }
  })

  assert.strictEqual(analysis.auditFindings.length, 3)
  const ignored = analysis.auditFindings.filter(item => item.disposition === 'intentionally-ignored')
  const unresolved = analysis.auditFindings.filter(item => item.disposition === 'unresolved')
  assert.strictEqual(ignored.length, 1)
  assert.strictEqual(ignored[0].text, '品牌')
  assert.strictEqual(ignored[0].ignoreReason, 'brand stays Chinese')
  assert.strictEqual(ignored[0].key, undefined)
  assert.deepStrictEqual(unresolved.map(item => item.text).sort(), ['未忽略', '欢迎'])
  assert.deepStrictEqual(analysis.coverage.chineseSourceAudit, {
    total: 3,
    unresolved: 2,
    intentionallyIgnored: 1
  })
  assert.deepStrictEqual(buildSourceCatalog(analysis), {})
})

test('analyzeProject fails on malformed, reasonless, unused, or ambiguous i18n-ignore directives', () => {
  const cases = [
    {
      label: 'reasonless',
      source: '<!-- i18n-ignore -->\n<p>文案</p>\n',
      match: /i18n-ignore/
    },
    {
      label: 'empty reason',
      source: '<!-- i18n-ignore:   -->\n<p>文案</p>\n',
      match: /i18n-ignore/
    },
    {
      label: 'malformed',
      source: '<!-- i18n-ignore brand -->\n<p>文案</p>\n',
      match: /i18n-ignore/
    },
    {
      label: 'unused',
      source: '<!-- i18n-ignore: leftover -->\n<span></span>\n<p>文案</p>\n',
      match: /unused|no associated|i18n-ignore/
    },
    {
      label: 'ambiguous',
      source: [
        '<!-- i18n-ignore: first -->',
        '<!-- i18n-ignore: second -->',
        '<p>文案</p>',
        ''
      ].join('\n'),
      match: /ambiguous|conflicting|i18n-ignore/
    }
  ]
  for (const item of cases) {
    assert.throws(
      () => analyzeProject({
        files: [{ path: 'public/index.html', source: item.source }],
        config: { attributeAllowlist: ['title'] }
      }),
      error => {
        assert.match(String(error && error.message), item.match, item.label)
        return true
      },
      item.label
    )
  }
})
