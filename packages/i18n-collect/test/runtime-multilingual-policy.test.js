const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { identityFiles } = require('../mycommon/config')
const { installVue2 } = require('./vue2-fixture')
const { installVue3 } = require('./vue3-fixture')
const {
  isInsideRuntimeMultilingualBoundary,
  matchingRuntimeMultilingualBoundary,
  readRuntimeMultilingualBoundaries,
  scanRuntimeMultilingualPolicy
} = require('../mycommon/runtime-multilingual-policy')

test('identityFiles exposes runtime-multilingual boundaries beside catalog metadata', () => {
  assert.strictEqual(
    identityFiles({ catalogDir: 'lang/catalog' }).runtimeMultilingualBoundaries,
    'lang/catalog/runtime-multilingual-boundaries.json'
  )
})

test('readRuntimeMultilingualBoundaries returns an empty list when the document is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-boundary-missing-'))
  assert.deepStrictEqual(
    readRuntimeMultilingualBoundaries(path.join(root, 'runtime-multilingual-boundaries.json'), root),
    []
  )
})

test('readRuntimeMultilingualBoundaries loads and normalizes versioned boundaries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-boundary-load-'))
  const file = path.join(root, 'runtime-multilingual-boundaries.json')
  fs.writeFileSync(file, `${JSON.stringify({
    version: 1,
    boundaries: [
      {
        id: 'checkout',
        include: ['src/features/checkout', 'src/pages/Checkout.vue'],
        exclude: ['src/features/checkout/legacy']
      },
      {
        id: 'settings',
        include: ['src/pages/settings/**/*.vue']
      }
    ]
  })}\n`)
  assert.deepStrictEqual(readRuntimeMultilingualBoundaries(file, root), [
    {
      id: 'checkout',
      include: ['src/features/checkout', 'src/pages/Checkout.vue'],
      exclude: ['src/features/checkout/legacy']
    },
    {
      id: 'settings',
      include: ['src/pages/settings/**/*.vue'],
      exclude: []
    }
  ])
})

test('readRuntimeMultilingualBoundaries rejects unsupported versions, bad shapes, and duplicate ids', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-boundary-bad-'))
  const file = path.join(root, 'runtime-multilingual-boundaries.json')
  fs.writeFileSync(file, '{"version":9,"boundaries":[]}\n')
  assert.throws(
    () => readRuntimeMultilingualBoundaries(file, root),
    /version 9 is unsupported/
  )
  fs.writeFileSync(file, '{"version":1}\n')
  assert.throws(
    () => readRuntimeMultilingualBoundaries(file, root),
    /must include a boundaries array/
  )
  fs.writeFileSync(file, `${JSON.stringify({
    version: 1,
    boundaries: [
      { id: 'a', include: ['src/a'] },
      { id: 'a', include: ['src/b'] }
    ]
  })}\n`)
  assert.throws(
    () => readRuntimeMultilingualBoundaries(file, root),
    /duplicate boundary id/
  )
  fs.writeFileSync(file, `${JSON.stringify({
    version: 1,
    boundaries: [{ id: '', include: ['src/a'] }]
  })}\n`)
  assert.throws(
    () => readRuntimeMultilingualBoundaries(file, root),
    /non-empty id/
  )
  fs.writeFileSync(file, `${JSON.stringify({
    version: 1,
    boundaries: [{ id: 'a', include: [] }]
  })}\n`)
  assert.throws(
    () => readRuntimeMultilingualBoundaries(file, root),
    /include must be a non-empty array/
  )
  fs.writeFileSync(file, `${JSON.stringify({
    version: 1,
    boundaries: [{ id: 'a', include: ['/abs/path'] }]
  })}\n`)
  assert.throws(
    () => readRuntimeMultilingualBoundaries(file, root),
    /project-relative/
  )
})

test('directory include inherits to descendants and exclude vetoes only within that boundary', () => {
  const boundaries = [
    {
      id: 'feature',
      include: ['src/features/checkout'],
      exclude: ['src/features/checkout/legacy']
    }
  ]
  assert.strictEqual(
    isInsideRuntimeMultilingualBoundary('src/features/checkout/Cart.vue', boundaries),
    true
  )
  assert.strictEqual(
    matchingRuntimeMultilingualBoundary('src/features/checkout/Cart.vue', boundaries).id,
    'feature'
  )
  assert.strictEqual(
    isInsideRuntimeMultilingualBoundary('src/features/checkout/legacy/Note.vue', boundaries),
    false
  )
  assert.strictEqual(
    isInsideRuntimeMultilingualBoundary('src/features/other/Page.vue', boundaries),
    false
  )
})

test('nested and overlapping boundaries use union membership', () => {
  const boundaries = [
    {
      id: 'parent',
      include: ['src/features'],
      exclude: ['src/features/admin']
    },
    {
      id: 'admin-i18n',
      include: ['src/features/admin/i18n'],
      exclude: []
    }
  ]
  assert.strictEqual(
    isInsideRuntimeMultilingualBoundary('src/features/shop/Page.vue', boundaries),
    true
  )
  assert.strictEqual(
    isInsideRuntimeMultilingualBoundary('src/features/admin/Dashboard.vue', boundaries),
    false
  )
  assert.strictEqual(
    isInsideRuntimeMultilingualBoundary('src/features/admin/i18n/Banner.vue', boundaries),
    true
  )
  assert.strictEqual(
    matchingRuntimeMultilingualBoundary('src/features/admin/i18n/Banner.vue', boundaries).id,
    'admin-i18n'
  )
})

test('glob include patterns participate in membership', () => {
  const boundaries = [
    {
      id: 'pages',
      include: ['src/pages/**/multilingual/*.vue'],
      exclude: []
    }
  ]
  assert.strictEqual(
    isInsideRuntimeMultilingualBoundary('src/pages/app/multilingual/Home.vue', boundaries),
    true
  )
  assert.strictEqual(
    isInsideRuntimeMultilingualBoundary('src/pages/app/other/Home.vue', boundaries),
    false
  )
})

test('scanRuntimeMultilingualPolicy rejects direct Chinese literals inside a boundary', () => {
  const boundaries = [
    {
      id: 'multilingual',
      include: ['src/pages/multilingual'],
      exclude: []
    }
  ]
  const violations = scanRuntimeMultilingualPolicy(
    [
      { path: 'src/pages/multilingual/Page.vue', source: '<template><p>你好世界</p></template>\n' },
      { path: 'src/pages/Home.vue', source: '<template><p>站外中文</p></template>\n' },
      {
        path: 'src/pages/multilingual/Ok.vue',
        source: '<template><p>{{ $t(\'demo.hello\') }}</p></template>\n'
      }
    ],
    boundaries
  )
  assert.strictEqual(violations.length, 1)
  assert.strictEqual(violations[0].reason, 'runtime-multilingual-literal')
  assert.strictEqual(violations[0].path, 'src/pages/multilingual/Page.vue')
  assert.strictEqual(violations[0].text, '你好世界')
  assert.strictEqual(violations[0].boundaryId, 'multilingual')
})

test('scanRuntimeMultilingualPolicy flags script literals and skips static localization keys', () => {
  const boundaries = [{ id: 'js', include: ['src/i18n'], exclude: [] }]
  const violations = scanRuntimeMultilingualPolicy(
    [
      {
        path: 'src/i18n/banner.js',
        source: [
          "const title = '欢迎回来'",
          "const ok = t('demo.welcome')",
          "const also = this.$t('demo.welcome')",
          ''
        ].join('\n')
      }
    ],
    boundaries
  )
  assert.strictEqual(violations.length, 1)
  assert.strictEqual(violations[0].text, '欢迎回来')
  assert.strictEqual(violations[0].kind, 'script-string')
})

test('scanRuntimeMultilingualPolicy still flags no-i18n-auto Chinese inside a boundary', () => {
  const boundaries = [{ id: 'js', include: ['src/i18n'], exclude: [] }]
  const violations = scanRuntimeMultilingualPolicy(
    [
      {
        path: 'src/i18n/note.js',
        source: '// no-i18n-auto\nconst note = "内部备注中文"\n'
      }
    ],
    boundaries
  )
  assert.strictEqual(violations.length, 1)
  assert.strictEqual(violations[0].text, '内部备注中文')
})

test('scanRuntimeMultilingualPolicy honors a configured attribute allowlist', () => {
  const boundaries = [{ id: 'html', include: ['src/pages/multilingual'], exclude: [] }]
  const source = '<template><p title="标题中文" data-label="标签中文">ok</p></template>\n'
  const files = [{ path: 'src/pages/multilingual/Attrs.vue', source }]
  const defaults = scanRuntimeMultilingualPolicy(files, boundaries)
  assert.ok(defaults.some(item => item.text === '标题中文'))
  assert.ok(!defaults.some(item => item.text === '标签中文'))

  const narrowed = scanRuntimeMultilingualPolicy(files, boundaries, { attributeAllowlist: ['data-label'] })
  assert.ok(narrowed.some(item => item.text === '标签中文'))
  assert.ok(!narrowed.some(item => item.text === '标题中文'))
})

test('keeps Vue 2 and Vue 3 boundary diagnostics equivalent through Template IR', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-template-boundary-'))
  const vue2Root = path.join(root, 'vue2')
  const vue3Root = path.join(root, 'vue3')
  installVue2(vue2Root)
  installVue3(vue3Root)
  const source = [
    '<template>',
    '  <section>',
    '    <p title="保存&nbsp;成功">{{ $t(\'policy.saved\') }}</p>',
    '    <p :aria-label="$t(\'policy.label\')">{{ `还有${count}项` }}</p>',
    '  </section>',
    '</template>',
    ''
  ].join('\r\n')
  const boundaries = [{ id: 'policy', include: ['src'], exclude: [] }]

  function diagnostics(projectRoot) {
    const projectPath = 'src/Policy.vue'
    return scanRuntimeMultilingualPolicy([{
      path: projectPath,
      absolutePath: path.join(projectRoot, projectPath),
      source
    }], boundaries).map(item => ({
      reason: item.reason,
      kind: item.kind,
      start: item.start,
      end: item.end,
      text: item.text,
      boundaryId: item.boundaryId
    }))
  }

  const vue2 = diagnostics(vue2Root)
  const vue3 = diagnostics(vue3Root)
  assert.deepStrictEqual(vue3, vue2)
  assert.deepStrictEqual(vue2.map(item => item.text), ['保存\u00a0成功', '还有', '项'])
  assert.ok(vue2.every(item => item.boundaryId === 'policy'))
})

test('keeps standalone HTML boundary behavior parse5-backed', () => {
  const boundaries = [{ id: 'entry', include: ['public/index.html'], exclude: [] }]
  const source = '<p title="保存&nbsp;成功">正文中文</p>\r\n'
  const violations = scanRuntimeMultilingualPolicy(
    [{ path: 'public/index.html', source }],
    boundaries
  )
  assert.deepStrictEqual(violations.map(item => ({
    kind: item.kind,
    start: item.start,
    end: item.end,
    text: item.text
  })), [
    {
      kind: 'static-html-attribute',
      start: { line: 1, column: 10 },
      end: { line: 1, column: 20 },
      text: '保存\u00a0成功'
    },
    {
      kind: 'static-html-text',
      start: { line: 1, column: 22 },
      end: { line: 1, column: 26 },
      text: '正文中文'
    }
  ])
})

test('outside a boundary complete static Chinese remains eligible for automatic collection semantics', () => {
  const { extractScript } = require('../myloader/extract-script')
  const source = "const title = '边界外完整静态'\n"
  const entries = extractScript({
    source,
    resource: { projectPath: 'src/pages/Home.js' },
    config: { contextFilters: [] }
  })
  assert.deepStrictEqual(entries.map(item => item.value), ['边界外完整静态'])
  assert.deepStrictEqual(
    scanRuntimeMultilingualPolicy(
      [{ path: 'src/pages/Home.js', source }],
      [{ id: 'other', include: ['src/pages/multilingual'], exclude: [] }]
    ),
    []
  )
})
