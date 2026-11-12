const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { loadConfig, validate } = require('../mycommon/config')
const {
  analysisReport,
  analyzeSnapshots,
  buildSourceCatalog
} = require('../mycommon/project-analysis')
const { collectStaticAuditSnapshots } = require('../mycommon/static-audit')
const { evaluateLocalizationCompleteness } = require('../mycommon/evaluate-localization-completeness')
const { CollectionStore } = require('../mycommon/store')

function writeTree(root, files) {
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
}

test('validate accepts staticAudit.include separately from collection include', () => {
  const config = validate('/project', {
    include: ['src/**/*.js'],
    staticAudit: {
      include: ['public/**/*.html', 'legacy/**/*.css', 'legacy/**/*.scss']
    }
  })
  assert.deepStrictEqual(config.include, ['src/**/*.js'])
  assert.deepStrictEqual(config.staticAudit, {
    include: ['public/**/*.html', 'legacy/**/*.css', 'legacy/**/*.scss']
  })
})

test('validate defaults staticAudit.include to an empty list', () => {
  const config = validate('/project', {})
  assert.deepStrictEqual(config.staticAudit, { include: [] })
})

test('validate rejects invalid staticAudit shapes and patterns', () => {
  assert.throws(() => validate('/project', { staticAudit: null }), /staticAudit/)
  assert.throws(() => validate('/project', { staticAudit: [] }), /staticAudit/)
  assert.throws(
    () => validate('/project', { staticAudit: { include: ['/public/**/*.html'] } }),
    /project-relative/
  )
  assert.throws(
    () => validate('/project', { staticAudit: { include: ['../outside.html'] } }),
    /inside the project root|project-relative/
  )
  assert.throws(
    () => validate('/project', { staticAudit: { include: ['public/*.html'], exclude: [] } }),
    /unknown|staticAudit/
  )
  assert.throws(
    () => validate('/project', {
      staticAudit: { include: ['public/*.html', 'public/*.html'] }
    }),
    /duplicate/
  )
})

test('loadConfig reads staticAudit.include from the project config file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-static-audit-config-'))
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    `module.exports = {
  include: ['src'],
  staticAudit: { include: ['public/**/*.html', 'styles/**/*.css'] }
}
`
  )
  const config = loadConfig({ root })
  assert.deepStrictEqual(config.include, ['src'])
  assert.deepStrictEqual(config.staticAudit.include, ['public/**/*.html', 'styles/**/*.css'])
})

test('collectStaticAuditSnapshots returns a complete independent HTML and CSS audit snapshot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-static-audit-snap-'))
  writeTree(root, {
    'public/index.html': [
      '<!DOCTYPE html>',
      '<html><body>',
      '  <p title="保存">页面文案</p>',
      '</body></html>',
      ''
    ].join('\n'),
    'legacy/badge.css': '.x::before { content: "角标"; }\n',
    'legacy/theme.scss': '.y::before { content: "待审"; }\n',
    'src/app.js': 'module.exports = "运行时"\n',
    'orphan.html': '<p>不应收录</p>\n'
  })
  const config = loadConfig({ root })
  config.staticAudit = {
    include: ['public/**/*.html', 'legacy/**/*.css', 'legacy/**/*.scss']
  }
  const snapshots = collectStaticAuditSnapshots({ root, config })
  assert.deepStrictEqual(
    snapshots.map(item => item.identity).sort(),
    [
      'legacy/badge.css::style[index=0;lang=css]',
      'legacy/theme.scss::style[index=0;lang=scss]',
      'public/index.html::html'
    ]
  )
  const analysis = analyzeSnapshots(snapshots, config)
  assert.strictEqual(analysis.runtimeMessages.length, 0)
  const byText = new Map(analysis.auditFindings.map(item => [item.text, item]))
  assert.strictEqual(byText.get('页面文案').semanticRole, 'static-html-text')
  assert.strictEqual(byText.get('页面文案').disposition, 'unresolved')
  assert.strictEqual(byText.get('保存').semanticRole, 'static-html-attribute')
  assert.strictEqual(byText.get('角标').semanticRole, 'css-generated-content')
  assert.strictEqual(byText.get('角标').disposition, 'unresolved')
  assert.strictEqual(byText.get('待审').semanticRole, 'css-preprocessor-candidate')
  assert.strictEqual(byText.get('待审').disposition, 'needs-review')
  assert.ok(!byText.has('不应收录'))
  assert.ok(!byText.has('运行时'))
  assert.deepStrictEqual(buildSourceCatalog(analysis), { version: 1, messages: {} })
  const report = analysisReport(analysis)
  assert.ok(report.auditFindings.some(item => item.text === '页面文案'))
})

test('collectStaticAuditSnapshots preserves reasoned i18n-ignore as intentionally-ignored', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-static-audit-ignore-'))
  writeTree(root, {
    'public/index.html': [
      '<!DOCTYPE html>',
      '<html><body>',
      '  <!-- i18n-ignore: brand stays Chinese -->',
      '  <p title="品牌">欢迎</p>',
      '</body></html>',
      ''
    ].join('\n'),
    'legacy/brand.css': [
      '.logo::before {',
      '  /* i18n-ignore: brand glyph stays Chinese */',
      '  content: "徽标";',
      '}',
      ''
    ].join('\n')
  })
  const config = validate(root, {
    staticAudit: { include: ['public/**/*.html', 'legacy/**/*.css'] }
  })
  config.root = root
  const analysis = analyzeSnapshots(collectStaticAuditSnapshots({ root, config }), config)
  const ignored = analysis.auditFindings.filter(item => item.disposition === 'intentionally-ignored')
  assert.strictEqual(ignored.length, 2)
  assert.ok(ignored.some(item => item.text === '品牌' && item.ignoreReason === 'brand stays Chinese'))
  assert.ok(ignored.some(item => (
    item.text === '徽标' && item.ignoreReason === 'brand glyph stays Chinese'
  )))
  assert.ok(analysis.auditFindings.some(item => item.text === '欢迎' && item.disposition === 'unresolved'))
  assert.deepStrictEqual(buildSourceCatalog(analysis), { version: 1, messages: {} })
})

test('collectStaticAuditSnapshots fails closed for missing, unreadable, unparseable, or unsupported inputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-static-audit-fail-'))
  writeTree(root, {
    'public/ok.html': '<p>文案</p>\n',
    'legacy/broken.css': '.x { content: "角标"\n',
    'legacy/notes.txt': '中文说明\n',
    'public/locked.html': '<p>锁定</p>\n'
  })

  assert.throws(
    () => collectStaticAuditSnapshots({
      root,
      config: validate(root, { staticAudit: { include: ['missing/index.html'] } })
    }),
    /missing|not found|unreadable|static audit/i
  )

  assert.throws(
    () => collectStaticAuditSnapshots({
      root,
      config: validate(root, { staticAudit: { include: ['legacy/notes.txt'] } })
    }),
    /unsupported|static audit/i
  )

  assert.throws(
    () => collectStaticAuditSnapshots({
      root,
      config: validate(root, { staticAudit: { include: ['legacy/broken.css'] } })
    }),
    /unparseable|parse|static audit|content/i
  )

  const locked = path.join(root, 'public/locked.html')
  fs.unlinkSync(locked)
  fs.mkdirSync(locked)
  assert.throws(
    () => collectStaticAuditSnapshots({
      root,
      config: validate(root, { staticAudit: { include: ['public/locked.html'] } })
    }),
    /unreadable|EISDIR|static audit/i
  )
})
test('module-graph style audits and standalone static audits share the finding model', () => {
  const moduleGraph = [{
    identity: 'src/App.vue::style[index=0;lang=css]',
    projectPath: 'src/App.vue',
    entries: [{
      value: '角标',
      locations: [{
        path: 'src/App.vue',
        kind: 'css-generated-content',
        start: { line: 1, column: 20 },
        end: { line: 1, column: 22 }
      }]
    }]
  }]
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-static-audit-model-'))
  writeTree(root, {
    'legacy/badge.css': '.x::before { content: "角标"; }\n'
  })
  const config = validate(root, {
    staticAudit: { include: ['legacy/**/*.css'] },
    attributeAllowlist: ['title']
  })
  config.root = root
  const analysis = analyzeSnapshots(
    [...moduleGraph, ...collectStaticAuditSnapshots({ root, config })],
    config
  )
  assert.strictEqual(analysis.auditFindings.length, 2)
  for (const finding of analysis.auditFindings) {
    assert.strictEqual(finding.capability, 'chinese-source-audit')
    assert.strictEqual(finding.semanticRole, 'css-generated-content')
    assert.strictEqual(finding.disposition, 'unresolved')
    assert.strictEqual(finding.key, undefined)
  }
  assert.ok(analysis.auditFindings.some(item => item.resourceIdentity === moduleGraph[0].identity))
  assert.ok(analysis.auditFindings.some(item => (
    item.resourceIdentity === 'legacy/badge.css::style[index=0;lang=css]'
  )))
})

test('static audit snapshots stay out of the committed replacement store', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-static-audit-store-'))
  writeTree(root, {
    'public/index.html': '<p>页面文案</p>\n'
  })
  const config = validate(root, {
    staticAudit: { include: ['public/**/*.html'] },
    attributeAllowlist: ['title']
  })
  config.root = root
  const moduleSnapshots = [{
    identity: 'src/app.js::script',
    projectPath: 'src/app.js',
    entries: [{
      value: '你好',
      locations: [{
        path: 'src/app.js',
        kind: 'script-string',
        start: { line: 1, column: 19 },
        end: { line: 1, column: 21 }
      }]
    }]
  }]
  const staticSnapshots = collectStaticAuditSnapshots({ root, config })
  const analysis = analyzeSnapshots([...moduleSnapshots, ...staticSnapshots], config)
  assert.deepStrictEqual(Object.values(buildSourceCatalog(analysis).messages).sort(), ['你好'])
  assert.ok(analysis.auditFindings.some(item => item.text === '页面文案'))

  // Plugin only releases module-graph snapshots into the committed store.
  const store = new CollectionStore()
  for (const snapshot of moduleSnapshots) {
    store.replaceSnapshot(snapshot.identity, snapshot.entries)
  }
  const dictionary = store.runtimeDictionary()
  assert.deepStrictEqual(Object.values(dictionary), ['你好'])
  assert.ok(!Object.values(dictionary).includes('页面文案'))
  assert.ok(!store.sourceMap('hash').entries.some(entry => entry.value === '页面文案'))
})

test('unresolved and needs-review static audit findings block completeness only', () => {
  const analysis = analyzeSnapshots([{
    identity: 'public/index.html::html',
    projectPath: 'public/index.html',
    entries: [{
      value: '未忽略',
      locations: [{
        path: 'public/index.html',
        kind: 'static-html-text',
        start: { line: 1, column: 0 },
        end: { line: 1, column: 3 }
      }]
    }, {
      value: '待审',
      locations: [{
        path: 'legacy/theme.scss',
        kind: 'css-preprocessor-candidate',
        start: { line: 1, column: 20 },
        end: { line: 1, column: 22 }
      }]
    }, {
      value: '品牌',
      ignoreReason: 'brand stays Chinese',
      locations: [{
        path: 'public/index.html',
        kind: 'static-html-attribute',
        start: { line: 2, column: 0 },
        end: { line: 2, column: 2 }
      }]
    }]
  }], { attributeAllowlist: ['title'] })

  const completeness = evaluateLocalizationCompleteness({
    analysis,
    committedSourceCatalog: {},
    targetLocales: [],
    targets: {},
    reviewState: { version: 1, locales: {} }
  })
  assert.strictEqual(completeness.ok, false)
  assert.ok(completeness.blocking.includes('unresolved-audit'))
  assert.ok(completeness.blocking.includes('needs-review-audit'))
  assert.ok(!completeness.blocking.includes('intentionally-ignored'))
  assert.strictEqual(completeness.chineseSourceAudit.intentionallyIgnored, 1)
  assert.deepStrictEqual(buildSourceCatalog(analysis), { version: 1, messages: {} })
})
