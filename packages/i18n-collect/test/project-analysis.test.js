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

test('analyzeProject classifies dynamic script interpolation as explicit-required without catalog keys', () => {
  const analysis = analyzeProject({
    files: [{ path: 'src/dynamic.js', source: 'const message = `你好${name}世界`\n' }]
  })

  assert.strictEqual(analysis.runtimeMessages.length, 0)
  assert.strictEqual(analysis.localizedCallFindings.length, 0)
  assert.strictEqual(analysis.auditFindings.length, 0)
  assert.strictEqual(analysis.explicitRequiredFindings.length, 2)

  const texts = analysis.explicitRequiredFindings.map(item => item.text).sort()
  assert.deepStrictEqual(texts, ['世界', '你好'])
  for (const finding of analysis.explicitRequiredFindings) {
    assert.strictEqual(finding.capability, 'explicit-required')
    assert.strictEqual(finding.sourceSurface, 'javascript')
    assert.strictEqual(finding.semanticRole, 'template-literal')
    assert.strictEqual(finding.reason, 'interpolation')
    assert.strictEqual(finding.key, undefined)
  }

  assert.deepStrictEqual(buildSourceCatalog(analysis), { version: 1, messages: {} })
  assert.deepStrictEqual(analysis.coverage, {
    sourceDiscovery: { total: 2 },
    runtimeLocalization: {
      total: 0,
      automaticallyRuntimeLocalizable: 0,
      alreadyLocalized: 0
    },
    chineseSourceAudit: {
      total: 0,
      unresolved: 0,
      needsReview: 0,
      intentionallyIgnored: 0
    },
    explicitRequired: { total: 2 }
  })
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
    }],
    externalKeys: ['greeting.hello', 'greeting.world', 'greeting.again']
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
    }],
    externalKeys: ['nav.home']
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
      needsReview: 0,
      intentionallyIgnored: 0
    },
    explicitRequired: { total: 0 }
  })
})

test('analyzeProject classifies structured Vue content as explicit-required', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-analysis-structured-'))
  installVue3(root)
  const absolutePath = path.join(root, 'src', 'Notice.vue')
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  const source = [
    '<template>',
    '  <p>请阅读我们的<a href="/terms">服务条款</a>与<a href="/privacy">隐私政策</a></p>',
    '  <p>完整静态段落</p>',
    '</template>',
    '<script>export default { name: "Notice" }</script>',
    ''
  ].join('\n')
  fs.writeFileSync(absolutePath, source)

  const analysis = analyzeProject({
    files: [{ path: 'src/Notice.vue', source, absolutePath }],
    config: { vueVersion: 3 }
  })

  assert.ok(analysis.runtimeMessages.some(item => item.text === '完整静态段落'))
  assert.ok(!analysis.runtimeMessages.some(item => item.text === '请阅读我们的'))
  const structured = analysis.explicitRequiredFindings.filter(item => item.reason === 'structured-fragmentation')
  const texts = structured.map(item => item.text)
  assert.ok(texts.includes('请阅读我们的'))
  assert.ok(texts.includes('服务条款'))
  assert.ok(texts.includes('隐私政策'))
  assert.ok(structured.every(item => item.capability === 'explicit-required'))
  assert.ok(structured.every(item => item.key === undefined))
  const catalog = buildSourceCatalog(analysis)
  assert.ok(Object.values(catalog.messages).includes('完整静态段落'))
  assert.ok(!Object.values(catalog.messages).includes('请阅读我们的'))
  assert.ok(!Object.values(catalog.messages).includes('服务条款'))
})

test('analyzeProject classifies formatting and concatenation as explicit-required', () => {
  const analysis = analyzeProject({
    files: [{
      path: 'src/build.js',
      source: [
        'const split = "你" + name + "好"',
        'const label = "标题".repeat(2)',
        'const plain = "完整静态"'
      ].join('\n')
    }]
  })
  assert.ok(analysis.runtimeMessages.some(item => item.text === '完整静态'))
  const reasons = new Map(analysis.explicitRequiredFindings.map(item => [item.text, item.reason]))
  assert.strictEqual(reasons.get('你'), 'concatenation')
  assert.strictEqual(reasons.get('好'), 'concatenation')
  assert.strictEqual(reasons.get('标题'), 'formatting')
  assert.ok(!analysis.runtimeMessages.some(item => ['你', '好', '标题'].includes(item.text)))
})

test('analyzeProject keeps the explicit message manifest as the canonical source and placeholder contract', () => {
  const analysis = analyzeProject({
    files: [{
      path: 'src/items.js',
      source: "const text = t('items.deleted', { count })\n"
    }],
    explicitMessages: [
      { key: 'items.deleted', source: '已删除 {count} 项' }
    ]
  })
  assert.strictEqual(analysis.explicitRequiredFindings.length, 0)
  assert.strictEqual(analysis.localizedCallFindings.length, 1)
  assert.strictEqual(analysis.localizedCallFindings[0].key, 'items.deleted')
  assert.strictEqual(analysis.localizedCallFindings[0].source, '已删除 {count} 项')
  assert.deepStrictEqual(buildSourceCatalog(analysis), {
    version: 1,
    messages: { 'items.deleted': '已删除 {count} 项' }
  })
})

test('analyzeProject shares one explicit key across compatible calls and rejects placeholder mismatches', () => {
  const shared = analyzeProject({
    files: [{
      path: 'src/shared.js',
      source: [
        "const a = t('terms.notice', { terms, privacy })",
        "const b = t('terms.notice', { privacy, terms })"
      ].join('\n')
    }],
    explicitMessages: [
      { key: 'terms.notice', source: '请阅读我们的{terms}与{privacy}' }
    ]
  })
  assert.strictEqual(shared.localizedCallFindings.length, 2)
  assert.deepStrictEqual(buildSourceCatalog(shared), {
    version: 1,
    messages: { 'terms.notice': '请阅读我们的{terms}与{privacy}' }
  })

  assert.throws(
    () => analyzeProject({
      files: [{
        path: 'src/bad.js',
        source: "const a = t('terms.notice', { link, policy })\n"
      }],
      explicitMessages: [
        { key: 'terms.notice', source: '请阅读我们的{terms}与{privacy}' }
      ]
    }),
    /placeholder mismatch|placeholder/
  )
})

test('analyzeProject fails on unknown project keys and unused explicit declarations', () => {
  assert.throws(
    () => analyzeProject({
      files: [{ path: 'src/unknown.js', source: "const a = t('missing.key')\n" }]
    }),
    /unknown project key|missing\.key/
  )
  assert.throws(
    () => analyzeProject({
      files: [{ path: 'src/plain.js', source: 'const a = "你好"\n' }],
      explicitMessages: [{ key: 'unused.key', source: '未使用文案' }]
    }),
    /unused|unused\.key/
  )
})

test('analyzeProject fails on conflicting source text and classifies pluralization helpers as explicit-required', () => {
  assert.throws(
    () => analyzeProject({
      files: [{
        path: 'src/conflict-source.js',
        source: [
          'const a = /* i18n-key: home.title */ "你好"',
          'const b = /* i18n-key: home.title */ "欢迎"'
        ].join('\n')
      }]
    }),
    /conflicting source text|home\.title/
  )
  assert.throws(
    () => analyzeProject({
      files: [{
        path: 'src/mismatch.js',
        source: "const a = /* i18n-key: items.deleted */ \"你好\"\nconst b = t('items.deleted', { count })\n"
      }],
      explicitMessages: [{ key: 'items.deleted', source: '已删除 {count} 项' }]
    }),
    /source mismatch|items\.deleted/
  )

  const pluralized = analyzeProject({
    files: [{
      path: 'src/plural.js',
      source: 'const label = pluralize("一项", "多项", count)\nconst plain = "完整静态"\n'
    }]
  })
  assert.ok(pluralized.explicitRequiredFindings.some(item => (
    item.reason === 'formatting' && (item.text === '一项' || item.text === '多项')
  )))
  assert.ok(pluralized.runtimeMessages.some(item => item.text === '完整静态'))
  assert.ok(!pluralized.runtimeMessages.some(item => item.text === '一项' || item.text === '多项'))
})

test('analyzeProject allows external keys without creating project catalog entries', () => {
  const analysis = analyzeProject({
    files: [{
      path: 'src/vendor.js',
      source: "const a = t('vendor.external')\nconst b = \"你好\"\n"
    }],
    externalKeys: ['vendor.external']
  })
  assert.strictEqual(analysis.localizedCallFindings.length, 1)
  assert.strictEqual(analysis.localizedCallFindings[0].key, 'vendor.external')
  const catalog = buildSourceCatalog(analysis)
  assert.ok(!Object.prototype.hasOwnProperty.call(catalog.messages, 'vendor.external'))
  assert.ok(Object.values(catalog.messages).includes('你好'))
})

test('analyzeProject accepts a key directive on complete static copy and fails when it conflicts with a localized call', () => {
  const selected = analyzeProject({
    files: [{
      path: 'src/keyed.js',
      source: 'const message = /* i18n-key: home.title */ "你好"\n'
    }]
  })
  assert.strictEqual(selected.runtimeMessages.length, 1)
  assert.strictEqual(selected.runtimeMessages[0].key, 'home.title')
  assert.strictEqual(selected.runtimeMessages[0].text, '你好')
  assert.deepStrictEqual(buildSourceCatalog(selected), { version: 1, messages: { 'home.title': '你好' } })

  assert.throws(
    () => analyzeProject({
      files: [{
        path: 'src/conflict.js',
        source: "const message = /* i18n-key: home.title */ t('home.other')\n"
      }]
    }),
    /conflicts with localized-call|i18n-key/
  )
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
    files: [{ path: 'src/app.js', source: 'const a = "你好"\nconst b = "你好"\nconst c = t("nav.home")\n' }],
    externalKeys: ['nav.home']
  })
  assert.deepStrictEqual(buildSourceCatalog(analysis), { version: 1, messages: { [keyFor('你好')]: '你好' } })
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
      needsReview: 0,
      intentionallyIgnored: 0
    },
    explicitRequired: { total: 0 }
  })
  assert.deepStrictEqual(buildSourceCatalog(analysis), { version: 1, messages: {} })
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
  assert.deepStrictEqual(buildSourceCatalog(analysis), { version: 1, messages: {} })
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
    needsReview: 0,
    intentionallyIgnored: 1
  })
  assert.deepStrictEqual(buildSourceCatalog(analysis), { version: 1, messages: {} })
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

test('analyzeProject reports Chinese CSS content strings as unresolved audit findings', () => {
  const source = [
    '/* 样式说明 */',
    '.a::before { content: "必填"; }',
    '.b { content: attr(data-label); }',
    '.c { --label: "内部文案"; color: red; }',
    '.d { content: "第" counter(item) "项"; }',
    ''
  ].join('\n')
  const analysis = analyzeProject({
    files: [{ path: 'src/theme.css', source }]
  })

  assert.strictEqual(analysis.runtimeMessages.length, 0)
  assert.strictEqual(analysis.localizedCallFindings.length, 0)
  assert.deepStrictEqual(buildSourceCatalog(analysis), { version: 1, messages: {} })
  assert.strictEqual(analysis.auditFindings.length, 3)

  const texts = analysis.auditFindings.map(item => item.text).sort()
  assert.deepStrictEqual(texts, ['必填', '第', '项'])
  for (const finding of analysis.auditFindings) {
    assert.strictEqual(finding.sourceSurface, 'css')
    assert.strictEqual(finding.semanticRole, 'css-generated-content')
    assert.strictEqual(finding.capability, 'chinese-source-audit')
    assert.strictEqual(finding.disposition, 'unresolved')
    assert.strictEqual(finding.key, undefined)
    assert.match(finding.diagnostic, /proven|generated content/i)
    assert.strictEqual(finding.location.path, 'src/theme.css')
  }
  assert.deepStrictEqual(analysis.coverage.chineseSourceAudit, {
    total: 3,
    unresolved: 3,
    needsReview: 0,
    intentionallyIgnored: 0
  })
})

test('analyzeProject decodes CSS escapes and audits Vue style blocks', () => {
  const css = analyzeProject({
    files: [{
      path: 'src/escape.css',
      source: '.a::before { content: "\\5FC5\\586B"; }\n'
    }]
  })
  assert.strictEqual(css.auditFindings.length, 1)
  assert.strictEqual(css.auditFindings[0].text, '必填')
  assert.strictEqual(css.auditFindings[0].disposition, 'unresolved')

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-analysis-vue-style-'))
  installVue3(root)
  const absolutePath = path.join(root, 'src', 'Styled.vue')
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  const source = [
    '<template><p>页面</p></template>',
    '<style>',
    '.a::before { content: "角标"; }',
    '</style>',
    '<style lang="scss">',
    '.b::after { content: "待审"; }',
    '</style>',
    ''
  ].join('\n')
  fs.writeFileSync(absolutePath, source)
  const vue = analyzeProject({
    files: [{ path: 'src/Styled.vue', source, absolutePath }],
    config: { vueVersion: 3 }
  })
  const styleFindings = vue.auditFindings.filter(item => (
    item.semanticRole === 'css-generated-content' ||
    item.semanticRole === 'css-preprocessor-candidate'
  ))
  assert.deepStrictEqual(styleFindings.map(item => item.text).sort(), ['待审', '角标'])
  assert.ok(styleFindings.some(item => item.disposition === 'unresolved' && item.text === '角标'))
  assert.ok(styleFindings.some(item => item.disposition === 'needs-review' && item.text === '待审'))
  assert.ok(vue.runtimeMessages.some(item => item.text === '页面'))
  assert.deepStrictEqual(buildSourceCatalog(vue), { version: 1, messages: { [keyFor('页面')]: '页面' } })
})

test('analyzeProject surfaces preprocessor content candidates as needs-review without semantic proof', () => {
  const cases = [
    {
      path: 'src/theme.scss',
      surface: 'scss',
      source: [
        '// 注释中文',
        '@import "tokens";',
        '$label: "变量中文";',
        '.a::before { content: "必填"; }',
        '.b { content: "#{$label}"; }',
        '.c { content: $label; }',
        ''
      ].join('\n'),
      expected: ['必填']
    },
    {
      path: 'src/theme.sass',
      surface: 'sass',
      source: [
        '// 注释中文',
        '.a::before',
        '  content: "必填"',
        ''
      ].join('\n'),
      expected: ['必填']
    },
    {
      path: 'src/theme.less',
      surface: 'less',
      source: [
        '/* 注释中文 */',
        '@label: "变量中文";',
        '.a::before { content: "必填"; }',
        '.b { content: "@{label}"; }',
        ''
      ].join('\n'),
      expected: ['必填']
    },
    {
      path: 'src/theme.styl',
      surface: 'stylus',
      source: [
        '// 注释中文',
        '.a::before',
        '  content: "必填"',
        ''
      ].join('\n'),
      expected: ['必填']
    }
  ]

  for (const item of cases) {
    const analysis = analyzeProject({
      files: [{ path: item.path, source: item.source }]
    })
    assert.strictEqual(analysis.runtimeMessages.length, 0, item.path)
    assert.deepStrictEqual(buildSourceCatalog(analysis), { version: 1, messages: {} }, item.path)
    assert.deepStrictEqual(
      analysis.auditFindings.map(finding => finding.text).sort(),
      item.expected.slice().sort(),
      item.path
    )
    for (const finding of analysis.auditFindings) {
      assert.strictEqual(finding.sourceSurface, item.surface, item.path)
      assert.strictEqual(finding.semanticRole, 'css-preprocessor-candidate', item.path)
      assert.strictEqual(finding.capability, 'chinese-source-audit', item.path)
      assert.strictEqual(finding.disposition, 'needs-review', item.path)
      assert.strictEqual(finding.key, undefined, item.path)
      assert.match(finding.diagnostic, /conservative|needs.?review|without semantic proof/i, item.path)
    }
    assert.strictEqual(analysis.coverage.chineseSourceAudit.needsReview, analysis.auditFindings.length, item.path)
    assert.strictEqual(analysis.coverage.chineseSourceAudit.unresolved, 0, item.path)
  }
})

test('analyzeProject applies reasoned style i18n-ignore and fails closed on bad directives', () => {
  const ignored = analyzeProject({
    files: [{
      path: 'src/theme.css',
      source: [
        '.a::before {',
        '  /* i18n-ignore: brand glyph stays Chinese */',
        '  content: "品牌";',
        '}',
        '.b::after { content: "未忽略"; }',
        ''
      ].join('\n')
    }]
  })
  assert.strictEqual(ignored.auditFindings.length, 2)
  const accepted = ignored.auditFindings.find(item => item.disposition === 'intentionally-ignored')
  const unresolved = ignored.auditFindings.find(item => item.disposition === 'unresolved')
  assert.strictEqual(accepted.text, '品牌')
  assert.strictEqual(accepted.ignoreReason, 'brand glyph stays Chinese')
  assert.strictEqual(accepted.key, undefined)
  assert.strictEqual(unresolved.text, '未忽略')
  assert.deepStrictEqual(ignored.coverage.chineseSourceAudit, {
    total: 2,
    unresolved: 1,
    needsReview: 0,
    intentionallyIgnored: 1
  })
  assert.deepStrictEqual(buildSourceCatalog(ignored), { version: 1, messages: {} })

  const preprocessorIgnored = analyzeProject({
    files: [{
      path: 'src/theme.scss',
      source: [
        '.a::before {',
        '  /* i18n-ignore: review later */',
        '  content: "待审";',
        '}',
        ''
      ].join('\n')
    }]
  })
  assert.strictEqual(preprocessorIgnored.auditFindings.length, 1)
  assert.strictEqual(preprocessorIgnored.auditFindings[0].disposition, 'intentionally-ignored')
  assert.strictEqual(preprocessorIgnored.coverage.chineseSourceAudit.needsReview, 0)

  const failures = [
    {
      label: 'reasonless css',
      path: 'src/bad.css',
      source: '/* i18n-ignore */\n.a { content: "文案"; }\n',
      match: /i18n-ignore/
    },
    {
      label: 'unused css',
      path: 'src/unused.css',
      source: '/* i18n-ignore: leftover */\n.a { color: red; }\n.b { content: "文案"; }\n',
      match: /unused|no associated|i18n-ignore/
    },
    {
      label: 'ambiguous scss',
      path: 'src/ambiguous.scss',
      source: [
        '/* i18n-ignore: first */',
        '/* i18n-ignore: second */',
        '.a { content: "文案"; }',
        ''
      ].join('\n'),
      match: /ambiguous|conflicting|i18n-ignore/
    },
    {
      label: 'malformed css',
      path: 'src/broken.css',
      source: '.a { content: "文案"',
      match: /Unclosed|CssSyntaxError|end of file|missing/i
    }
  ]
  for (const item of failures) {
    assert.throws(
      () => analyzeProject({ files: [{ path: item.path, source: item.source }] }),
      error => {
        assert.match(String(error && error.message), item.match, item.label)
        return true
      },
      item.label
    )
  }
})
