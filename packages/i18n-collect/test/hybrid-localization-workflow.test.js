const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')

const AUTO_KEY = /^auto\.[0-9A-HJKMNP-TV-Z]{26}$/
const FORMAL_COLLECT = [
  'lang/zh_hash.json',
  'lang/zh_hash.map.json',
  'lang/catalog/zh.json',
  'lang/catalog/catalog.meta.json'
]
const EXPLICIT_KEY = 'hybrid.items.deleted'
const STRUCTURED_KEY = 'hybrid.terms.notice'
const MULTILINGUAL_KEY = 'hybrid.multilingual.title'
const STATIC_SOURCE = '请稍候'
const STATIC_EDITED = '请等待'
const EXPLICIT_SOURCE = '已删除 {count} 项'
const EXPLICIT_EDITED = '已移除 {count} 项'
const STRUCTURED_SOURCE = '请阅读我们的{terms}与{privacy}'

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function readJson(root, file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
}

function writeJson(root, file, value) {
  const full = path.join(root, file)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`)
}

function snapshotFiles(root, files) {
  return Object.fromEntries(files.map(file => {
    const full = path.join(root, file)
    return [file, fs.existsSync(full) ? fs.readFileSync(full) : null]
  }))
}

function assertFilesUnchanged(root, before, files = Object.keys(before)) {
  const after = snapshotFiles(root, files)
  for (const file of files) {
    assert.deepStrictEqual(after[file], before[file], `formal output changed: ${file}`)
  }
}

function automaticKeyFor(catalog, source) {
  const keys = Object.keys(catalog).filter(key => catalog[key] === source && AUTO_KEY.test(key))
  assert.strictEqual(keys.length, 1, `one automatic key for ${JSON.stringify(source)}`)
  return keys[0]
}

function explicitManifest(explicitSource = EXPLICIT_SOURCE) {
  return {
    version: 1,
    messages: [
      { key: EXPLICIT_KEY, source: explicitSource },
      { key: STRUCTURED_KEY, source: STRUCTURED_SOURCE },
      { key: MULTILINGUAL_KEY, source: '运行时多语言标题' }
    ]
  }
}

function createRuntime(root) {
  let locale = 'zh'
  return {
    setLocale(next) { locale = next },
    t(key, params) {
      const catalog = readJson(root, `lang/catalog/${locale}.json`)
      assert.ok(Object.prototype.hasOwnProperty.call(catalog, key), `missing runtime key ${key}`)
      const text = catalog[key]
      if (!params) return text
      return Object.entries(params).reduce(
        (value, [name, next]) => String(value).split(`{${name}}`).join(String(next)),
        text
      )
    }
  }
}

function appSource({ staticText = STATIC_SOURCE, siblingCount = 0 } = {}) {
  const siblings = Array.from({ length: siblingCount }, (_, index) => (
    `const sibling${index} = "共享文案"`
  ))
  const exportNames = ['wait', 'deleted', 'notice', 'boundary']
    .concat(Array.from({ length: siblingCount }, (_, i) => `sibling${i}`))
    .join(', ')
  return [
    "const { t } = require('./i18n')",
    `const wait = '${staticText}'`,
    `const deleted = t('${EXPLICIT_KEY}', { count: 3 })`,
    `const notice = t('${STRUCTURED_KEY}', { terms: '服务条款', privacy: '隐私政策' })`,
    "const boundary = require('./pages/multilingual/panel')",
    ...siblings,
    `module.exports = { ${exportNames} }`,
    ''
  ].join('\n')
}

function boundarySource({ withLiteral = false } = {}) {
  return [
    "const { t } = require('../../i18n')",
    `const title = t('${MULTILINGUAL_KEY}')`,
    withLiteral ? 'const leaked = "边界内直接中文"' : '',
    'module.exports = { title' + (withLiteral ? ', leaked' : '') + ' }',
    ''
  ].filter(Boolean).join('\n')
}

function writeProject(root, {
  staticText = STATIC_SOURCE,
  explicitSource = EXPLICIT_SOURCE,
  withBoundaryLiteral = false,
  siblingCount = 0,
  extraFiles = {}
} = {}) {
  fs.mkdirSync(path.join(root, 'src/pages/multilingual'), { recursive: true })
  fs.mkdirSync(path.join(root, 'i18n'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })

  fs.writeFileSync(path.join(root, 'src/app.js'), appSource({
    staticText,
    siblingCount
  }))
  fs.writeFileSync(path.join(root, 'src/pages/multilingual/panel.js'), boundarySource({
    withLiteral: withBoundaryLiteral
  }))
  fs.writeFileSync(path.join(root, 'src/i18n.js'), [
    'function t(key) { return key }',
    'module.exports = { t }',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'i18n/provider.js'), [
    'module.exports = {',
    '  translate(request) {',
    '    const drafts = []',
    '    for (const item of request.items) {',
    '      for (const locale of item.locales) {',
    "        drafts.push({ key: item.key, locale, text: `EN:${item.source}` })",
    '      }',
    '    }',
    '    return { drafts, failures: [] }',
    '  }',
    '}',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), [
    'module.exports = {',
    "  translationProvider: 'i18n/provider.js',",
    "  targetLocales: ['en'],",
    "  translationFailure: 'partial'",
    '}',
    ''
  ].join('\n'))
  writeJson(root, 'lang/catalog/explicit-messages.json', explicitManifest(explicitSource))
  writeJson(root, 'lang/catalog/runtime-multilingual-boundaries.json', {
    version: 1,
    boundaries: [{ id: 'hybrid-multilingual', include: ['src/pages/multilingual'] }]
  })
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: 'development',
  entry: './src/app.js',
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  module: { rules: [{ test: /\\.js$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin()]
}
`)
  for (const [name, contents] of Object.entries(extraFiles)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
}

test('hybrid workflow: collect, explicit messages, review, key stability, runtime, policy, and ambiguity recovery', { timeout: 180000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-hybrid-e2e-'))
  writeProject(root)

  const collected = run(['collect', '--json'], root)
  assert.strictEqual(collected.status, 0, collected.stderr)
  const sourceCatalog = readJson(root, 'lang/catalog/zh.json')
  const waitKey = automaticKeyFor(sourceCatalog, STATIC_SOURCE)
  assert.strictEqual(sourceCatalog[EXPLICIT_KEY], EXPLICIT_SOURCE)
  assert.strictEqual(sourceCatalog[STRUCTURED_KEY], STRUCTURED_SOURCE)
  assert.strictEqual(sourceCatalog[MULTILINGUAL_KEY], '运行时多语言标题')
  const meta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(meta.entries[waitKey].origin, 'derived')
  assert.strictEqual(meta.entries[waitKey].representation, 'source-text')
  assert.strictEqual(meta.entries[EXPLICIT_KEY].origin, 'explicit')
  assert.strictEqual(meta.entries[EXPLICIT_KEY].representation, 'localized-call')
  assert.strictEqual(meta.entries[STRUCTURED_KEY].origin, 'explicit')
  assert.strictEqual(meta.entries[MULTILINGUAL_KEY].origin, 'explicit')
  const waitFingerprint = meta.entries[waitKey].fingerprint
  const explicitFingerprint = meta.entries[EXPLICIT_KEY].fingerprint

  const translated = run(['translate', '--json'], root)
  assert.strictEqual(translated.status, 0, translated.stderr)
  const english = readJson(root, 'lang/catalog/en.json')
  assert.strictEqual(english[waitKey], `EN:${STATIC_SOURCE}`)
  assert.strictEqual(english[EXPLICIT_KEY], `EN:${EXPLICIT_SOURCE}`)
  assert.strictEqual(english[STRUCTURED_KEY], `EN:${STRUCTURED_SOURCE}`)
  const review = readJson(root, 'lang/catalog/translation-state.json')
  assert.strictEqual(review.locales.en[waitKey].review, 'current')
  assert.strictEqual(review.locales.en[EXPLICIT_KEY].review, 'current')
  assert.strictEqual(review.locales.en[STRUCTURED_KEY].review, 'current')
  const waitReviewFingerprint = review.locales.en[waitKey].sourceFingerprint
  const explicitReviewFingerprint = review.locales.en[EXPLICIT_KEY].sourceFingerprint

  const policyClean = run(['check-policy', '--json'], root)
  assert.strictEqual(policyClean.status, 0, policyClean.stderr)
  const policyReport = JSON.parse(policyClean.stdout)
  assert.strictEqual(policyReport.ok, true)
  assert.strictEqual(policyReport.violations, 0)
  assert.deepStrictEqual(policyReport.runtimeMultilingualViolations, [])

  const verified = run(['verify', '--json'], root)
  assert.strictEqual(verified.status, 0, verified.stderr)
  assert.strictEqual(JSON.parse(verified.stdout).ok, true)

  const runtime = createRuntime(root)
  runtime.setLocale('zh')
  assert.strictEqual(runtime.t(EXPLICIT_KEY, { count: 3 }), '已删除 3 项')
  assert.strictEqual(
    runtime.t(STRUCTURED_KEY, { terms: '服务条款', privacy: '隐私政策' }),
    '请阅读我们的服务条款与隐私政策'
  )
  runtime.setLocale('en')
  assert.strictEqual(runtime.t(EXPLICIT_KEY, { count: 3 }), 'EN:已删除 3 项')
  assert.strictEqual(
    runtime.t(STRUCTURED_KEY, { terms: 'Terms', privacy: 'Privacy' }),
    'EN:请阅读我们的Terms与Privacy'
  )
  assert.strictEqual(runtime.t(MULTILINGUAL_KEY), 'EN:运行时多语言标题')
  assert.strictEqual(english[EXPLICIT_KEY], `EN:${EXPLICIT_SOURCE}`)

  fs.writeFileSync(path.join(root, 'src/app.js'), appSource({ staticText: STATIC_EDITED }))
  const staticEdited = run(['collect', '--json'], root)
  assert.strictEqual(staticEdited.status, 0, staticEdited.stderr)
  const afterStaticCatalog = readJson(root, 'lang/catalog/zh.json')
  assert.strictEqual(afterStaticCatalog[waitKey], STATIC_EDITED)
  assert.strictEqual(afterStaticCatalog[EXPLICIT_KEY], EXPLICIT_SOURCE)
  const afterStaticMeta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(afterStaticMeta.entries[waitKey].source, STATIC_EDITED)
  assert.notStrictEqual(afterStaticMeta.entries[waitKey].fingerprint, waitFingerprint)
  assert.strictEqual(afterStaticMeta.entries[EXPLICIT_KEY].fingerprint, explicitFingerprint)

  const staticReviewed = run(['translate', '--json'], root)
  assert.strictEqual(staticReviewed.status, 0, staticReviewed.stderr)
  assert.strictEqual(readJson(root, 'lang/catalog/en.json')[waitKey], `EN:${STATIC_SOURCE}`)
  assert.deepStrictEqual(readJson(root, 'lang/catalog/translation-state.json').locales.en[waitKey], {
    sourceFingerprint: waitReviewFingerprint,
    review: 'needs-review'
  })
  assert.strictEqual(
    readJson(root, 'lang/catalog/translation-state.json').locales.en[EXPLICIT_KEY].review,
    'current'
  )

  writeJson(root, 'lang/catalog/explicit-messages.json', explicitManifest(EXPLICIT_EDITED))
  const explicitEdited = run(['collect', '--json'], root)
  assert.strictEqual(explicitEdited.status, 0, explicitEdited.stderr)
  assert.strictEqual(readJson(root, 'lang/catalog/zh.json')[EXPLICIT_KEY], EXPLICIT_EDITED)
  assert.strictEqual(readJson(root, 'lang/catalog/zh.json')[waitKey], STATIC_EDITED)
  assert.strictEqual(readJson(root, 'lang/catalog/zh.json')[STRUCTURED_KEY], STRUCTURED_SOURCE)
  const afterExplicitMeta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(afterExplicitMeta.entries[EXPLICIT_KEY].source, EXPLICIT_EDITED)
  assert.notStrictEqual(afterExplicitMeta.entries[EXPLICIT_KEY].fingerprint, explicitFingerprint)

  const explicitReviewed = run(['translate', '--json'], root)
  assert.strictEqual(explicitReviewed.status, 0, explicitReviewed.stderr)
  assert.strictEqual(readJson(root, 'lang/catalog/en.json')[EXPLICIT_KEY], `EN:${EXPLICIT_SOURCE}`)
  assert.deepStrictEqual(readJson(root, 'lang/catalog/translation-state.json').locales.en[EXPLICIT_KEY], {
    sourceFingerprint: explicitReviewFingerprint,
    review: 'needs-review'
  })
  runtime.setLocale('en')
  assert.strictEqual(runtime.t(EXPLICIT_KEY, { count: 2 }), 'EN:已删除 2 项')

  fs.writeFileSync(
    path.join(root, 'src/forbidden.js'),
    'module.exports = "你好" + name\n'
  )
  const policyForbidden = run(['check-policy'], root)
  assert.strictEqual(policyForbidden.status, 2, policyForbidden.stderr)
  assert.match(policyForbidden.stderr, /concatenation|complete-static-copy|你好/)
  fs.unlinkSync(path.join(root, 'src/forbidden.js'))

  fs.writeFileSync(
    path.join(root, 'src/pages/multilingual/panel.js'),
    boundarySource({ withLiteral: true })
  )
  const policyBoundary = run(['check-policy'], root)
  assert.strictEqual(policyBoundary.status, 2, policyBoundary.stderr)
  assert.match(policyBoundary.stderr, /runtime-multilingual-literal/)
  assert.match(policyBoundary.stderr, /边界内直接中文/)
  fs.writeFileSync(
    path.join(root, 'src/pages/multilingual/panel.js'),
    boundarySource({ withLiteral: false })
  )
  assert.strictEqual(run(['check-policy'], root).status, 0)

  fs.writeFileSync(path.join(root, 'src/app.js'), appSource({
    staticText: STATIC_EDITED,
    siblingCount: 2
  }))
  const beforeAmbiguityCollect = run(['collect', '--json'], root)
  assert.strictEqual(beforeAmbiguityCollect.status, 0, beforeAmbiguityCollect.stderr)
  const zhBeforeAmbiguity = readJson(root, 'lang/catalog/zh.json')
  const sharedKeys = Object.keys(zhBeforeAmbiguity)
    .filter(key => zhBeforeAmbiguity[key] === '共享文案' && AUTO_KEY.test(key))
    .sort()
  assert.strictEqual(sharedKeys.length, 2)
  const formalBeforeAmbiguity = snapshotFiles(root, FORMAL_COLLECT)
  assert.strictEqual(zhBeforeAmbiguity[EXPLICIT_KEY], EXPLICIT_EDITED)

  fs.writeFileSync(path.join(root, 'src/app.js'), appSource({
    staticText: STATIC_EDITED,
    siblingCount: 3
  }))
  const ambiguous = run(['collect', '--json'], root)
  assert.strictEqual(ambiguous.status, 2, ambiguous.stderr)
  assert.strictEqual(JSON.parse(ambiguous.stdout).failure, 'collection')
  assert.match(ambiguous.stderr, /occurrence identity|identity-ambiguities/)
  assertFilesUnchanged(root, formalBeforeAmbiguity)
  assert.strictEqual(readJson(root, 'lang/catalog/zh.json')[EXPLICIT_KEY], EXPLICIT_EDITED)
  assert.ok(fs.existsSync(path.join(root, 'lang/catalog/identity-ambiguities.json')))

  const policyWhileAmbiguous = run(['check-policy', '--json'], root)
  assert.strictEqual(policyWhileAmbiguous.status, 0, policyWhileAmbiguous.stderr)
  assert.strictEqual(JSON.parse(policyWhileAmbiguous.stdout).ok, true)
  assertFilesUnchanged(root, formalBeforeAmbiguity)

  fs.writeFileSync(path.join(root, 'src/forbidden.js'), 'module.exports = "你好" + name\n')
  const policyDuringAmbiguity = run(['check-policy'], root)
  assert.strictEqual(policyDuringAmbiguity.status, 2, policyDuringAmbiguity.stderr)
  assert.match(policyDuringAmbiguity.stderr, /concatenation|complete-static-copy|你好/)
  assertFilesUnchanged(root, formalBeforeAmbiguity)

  writeJson(root, 'lang/catalog/complete-static-copy-baseline.json', {
    version: 1,
    violations: []
  })
  const stillAmbiguous = run(['collect', '--json'], root)
  assert.strictEqual(stillAmbiguous.status, 2, stillAmbiguous.stderr)
  assertFilesUnchanged(root, formalBeforeAmbiguity)

  fs.unlinkSync(path.join(root, 'src/forbidden.js'))
  const report = readJson(root, 'lang/catalog/identity-ambiguities.json')
  assert.ok(report.ambiguities.length >= 3)
  writeJson(root, 'lang/catalog/identity-confirmations.json', {
    version: 1,
    confirmations: report.ambiguities.map(item => ({
      semanticHost: item.semanticHost,
      childRole: item.childRole,
      localContext: item.localContext,
      key: item.proposedKey
    }))
  })
  const resolved = run(['collect', '--json'], root)
  assert.strictEqual(resolved.status, 0, resolved.stderr)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/identity-ambiguities.json')), false)
  const recoveredCatalog = readJson(root, 'lang/catalog/zh.json')
  assert.strictEqual(recoveredCatalog[EXPLICIT_KEY], EXPLICIT_EDITED)
  assert.strictEqual(recoveredCatalog[STRUCTURED_KEY], STRUCTURED_SOURCE)
  assert.strictEqual(recoveredCatalog[waitKey], STATIC_EDITED)
  assert.strictEqual(recoveredCatalog[MULTILINGUAL_KEY], '运行时多语言标题')
  const recoveredMeta = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(recoveredMeta.entries[EXPLICIT_KEY].origin, 'explicit')
  assert.strictEqual(recoveredMeta.entries[STRUCTURED_KEY].origin, 'explicit')
  assert.strictEqual(recoveredMeta.entries[waitKey].status, 'active')

  const policyAfterRecovery = run(['check-policy', '--json'], root)
  assert.strictEqual(policyAfterRecovery.status, 0, policyAfterRecovery.stderr)
  runtime.setLocale('en')
  assert.strictEqual(runtime.t(EXPLICIT_KEY, { count: 5 }), 'EN:已删除 5 项')
  assert.strictEqual(
    runtime.t(STRUCTURED_KEY, { terms: 'Terms', privacy: 'Privacy' }),
    'EN:请阅读我们的Terms与Privacy'
  )
})
