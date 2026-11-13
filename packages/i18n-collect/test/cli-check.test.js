const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { fingerprintOf } = require('../mycommon/catalog')
const { keyFor } = require('../mycommon/store')

const bin = path.join(__dirname, '../bin/i18n-collect.js')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function snapshotTree(root) {
  const out = new Map()
  const visit = directory => {
    if (!fs.existsSync(directory)) return
    for (const name of fs.readdirSync(directory)) {
      const absolute = path.join(directory, name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      const stat = fs.statSync(absolute)
      if (stat.isDirectory()) {
        visit(absolute)
        continue
      }
      if (stat.isFile()) out.set(relative, fs.readFileSync(absolute))
    }
  }
  visit(root)
  return out
}

function assertReadOnly(root, before, result) {
  assert.deepStrictEqual(snapshotTree(root), before, result.stderr || result.stdout)
}

function writeJson(root, relative, value) {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function writeCheckProject(root, html, { sourceCatalog = {}, config = null } = {}) {
  fs.mkdirSync(path.join(root, 'public'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, 'public/index.html'), html)
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    config || 'module.exports = { include: ["public"], attributeAllowlist: ["title"] }\n'
  )
  writeJson(root, 'lang/catalog/source-catalog.json', sourceCatalog)
}

test('check help describes read-only localization completeness', () => {
  const result = run(['check', '--help'])
  assert.strictEqual(result.status, 0, result.stderr)
  assert.match(result.stdout, /i18n-collect check/)
  assert.match(result.stdout, /localization completeness/i)
  assert.match(result.stdout, /source catalog/i)
  assert.match(result.stdout, /target-locale/i)
  assert.match(result.stdout, /--json/)
})

test('check fails when standalone HTML audit findings remain unresolved', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-html-fail-'))
  writeCheckProject(root, [
    '<!DOCTYPE html>',
    '<html><body><p>未忽略</p></body></html>',
    ''
  ].join('\n'))
  const before = snapshotTree(root)

  const result = run(['check', '--json'], root)
  assert.notStrictEqual(result.status, 0, result.stdout)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'check')
  assert.strictEqual(report.ok, false)
  assert.ok(report.chineseSourceAudit.unresolved >= 1)
  assert.ok(report.blocking.includes('unresolved-audit'))
  assert.ok(Array.isArray(report.auditFindings))
  assert.ok(report.auditFindings.some(item => item.disposition === 'unresolved' && item.text === '未忽略'))
  assertReadOnly(root, before, result)
})

test('check fails with an actionable diagnostic for an unused HTML i18n-ignore', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-ignore-fail-'))
  writeCheckProject(root, '<!-- i18n-ignore: leftover -->\n<span></span>\n<p>文案</p>\n')
  const before = snapshotTree(root)
  const result = run(['check', '--json'], root)
  assert.notStrictEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /unused i18n-ignore|i18n-ignore/)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.match(report.message, /i18n-ignore/)
  assertReadOnly(root, before, result)
})

test('check succeeds when every HTML audit finding is intentionally ignored with a reason', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-html-ok-'))
  writeCheckProject(root, [
    '<!DOCTYPE html>',
    '<html><body>',
    '  <!-- i18n-ignore: legal copy stays Chinese -->',
    '  <p>版权所有</p>',
    '</body></html>',
    ''
  ].join('\n'))
  const before = snapshotTree(root)

  const result = run(['check', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'check')
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.chineseSourceAudit, {
    total: 1,
    unresolved: 0,
    needsReview: 0,
    intentionallyIgnored: 1
  })
  assert.strictEqual(report.auditFindings.length, 1)
  assert.strictEqual(report.auditFindings[0].disposition, 'intentionally-ignored')
  assert.strictEqual(report.auditFindings[0].ignoreReason, 'legal copy stays Chinese')
  assert.deepStrictEqual(report.runtimeLocalization, {
    automaticallyRuntimeLocalizable: 0,
    alreadyLocalized: 0
  })
  assert.strictEqual(report.sourceFreshness.ok, true)
  assertReadOnly(root, before, result)
})

test('check fails for unresolved CSS findings and preprocessor needs-review findings', () => {
  const cssRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-css-fail-'))
  fs.mkdirSync(path.join(cssRoot, 'src'), { recursive: true })
  fs.mkdirSync(path.join(cssRoot, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(cssRoot, 'src/theme.css'), '.a::before { content: "必填"; }\n')
  fs.writeFileSync(
    path.join(cssRoot, 'i18n-collect.config.js'),
    'module.exports = { include: ["src"] }\n'
  )
  writeJson(cssRoot, 'lang/catalog/source-catalog.json', {})
  const cssBefore = snapshotTree(cssRoot)
  const cssResult = run(['check', '--json'], cssRoot)
  assert.notStrictEqual(cssResult.status, 0, cssResult.stdout)
  const cssReport = JSON.parse(cssResult.stdout)
  assert.strictEqual(cssReport.ok, false)
  assert.ok(cssReport.chineseSourceAudit.unresolved >= 1)
  assert.ok(cssReport.blocking.includes('unresolved-audit'))
  assert.match(cssReport.message, /unresolved/)
  assert.ok(cssReport.auditFindings.some(item => (
    item.disposition === 'unresolved' &&
    item.semanticRole === 'css-generated-content' &&
    /proven|generated content/i.test(item.diagnostic)
  )))
  assertReadOnly(cssRoot, cssBefore, cssResult)

  const scssRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-scss-fail-'))
  fs.mkdirSync(path.join(scssRoot, 'src'), { recursive: true })
  fs.mkdirSync(path.join(scssRoot, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(scssRoot, 'src/theme.scss'), '.a::before { content: "待审"; }\n')
  fs.writeFileSync(
    path.join(scssRoot, 'i18n-collect.config.js'),
    'module.exports = { include: ["src"] }\n'
  )
  writeJson(scssRoot, 'lang/catalog/source-catalog.json', {})
  const scssBefore = snapshotTree(scssRoot)
  const scssResult = run(['check', '--json'], scssRoot)
  assert.notStrictEqual(scssResult.status, 0, scssResult.stdout)
  const scssReport = JSON.parse(scssResult.stdout)
  assert.strictEqual(scssReport.ok, false)
  assert.ok(scssReport.chineseSourceAudit.needsReview >= 1)
  assert.ok(scssReport.blocking.includes('needs-review-audit'))
  assert.match(scssReport.message, /needs-review/)
  assert.ok(scssReport.auditFindings.some(item => (
    item.disposition === 'needs-review' &&
    item.semanticRole === 'css-preprocessor-candidate' &&
    /conservative|without semantic proof/i.test(item.diagnostic)
  )))
  assertReadOnly(scssRoot, scssBefore, scssResult)
})

test('check succeeds when every style audit finding is intentionally ignored with a reason', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-style-ok-'))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src/theme.css'),
    [
      '.a::before {',
      '  /* i18n-ignore: legal glyph stays Chinese */',
      '  content: "版权";',
      '}',
      ''
    ].join('\n')
  )
  fs.writeFileSync(
    path.join(root, 'src/theme.scss'),
    [
      '.b::after {',
      '  /* i18n-ignore: reviewed brand mark */',
      '  content: "品牌";',
      '}',
      ''
    ].join('\n')
  )
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { include: ["src"] }\n'
  )
  writeJson(root, 'lang/catalog/source-catalog.json', {})
  const before = snapshotTree(root)

  const result = run(['check', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.chineseSourceAudit, {
    total: 2,
    unresolved: 0,
    needsReview: 0,
    intentionallyIgnored: 2
  })
  assert.ok(report.auditFindings.every(item => item.disposition === 'intentionally-ignored'))
  assert.ok(report.auditFindings.every(item => item.key === undefined))
  assertReadOnly(root, before, result)
})

test('check fails when committed source catalog is missing or stale', () => {
  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-missing-catalog-'))
  fs.mkdirSync(path.join(missingRoot, 'src'), { recursive: true })
  fs.writeFileSync(path.join(missingRoot, 'src/app.js'), 'module.exports = "你好"\n')
  fs.writeFileSync(path.join(missingRoot, 'i18n-collect.config.js'), 'module.exports = { include: ["src"] }\n')
  const missingBefore = snapshotTree(missingRoot)
  const missingResult = run(['check', '--json'], missingRoot)
  assert.notStrictEqual(missingResult.status, 0, missingResult.stdout)
  const missingReport = JSON.parse(missingResult.stdout)
  assert.strictEqual(missingReport.ok, false)
  assert.ok(missingReport.blocking.includes('missing-source-catalog'))
  assert.match(missingReport.message, /run collect/i)
  assertReadOnly(missingRoot, missingBefore, missingResult)

  const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-stale-catalog-'))
  fs.mkdirSync(path.join(staleRoot, 'src'), { recursive: true })
  fs.mkdirSync(path.join(staleRoot, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(staleRoot, 'src/app.js'), 'module.exports = "你好"\n')
  fs.writeFileSync(path.join(staleRoot, 'i18n-collect.config.js'), 'module.exports = { include: ["src"] }\n')
  writeJson(staleRoot, 'lang/catalog/source-catalog.json', {})
  const staleBefore = snapshotTree(staleRoot)
  const staleResult = run(['check', '--json'], staleRoot)
  assert.notStrictEqual(staleResult.status, 0, staleResult.stdout)
  const staleReport = JSON.parse(staleResult.stdout)
  assert.strictEqual(staleReport.ok, false)
  assert.ok(staleReport.blocking.includes('stale-source-analysis'))
  assert.strictEqual(staleReport.sourceFreshness.ok, false)
  assertReadOnly(staleRoot, staleBefore, staleResult)
})

test('check fails for unreviewed dynamic message candidates and missing translations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-runtime-locale-'))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = `你好${name}`\n')
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { include: ["src"], targetLocales: ["en"] }\n'
  )
  writeJson(root, 'lang/catalog/source-catalog.json', {})
  const before = snapshotTree(root)
  const result = run(['check', '--json'], root)
  assert.notStrictEqual(result.status, 0, result.stdout)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.ok(report.blocking.includes('unreviewed-dynamic-candidates'))
  assert.ok(!report.blocking.includes('needs-review-audit'))
  assert.ok(!report.blocking.includes('needs-review-translations'))
  assert.ok(report.dynamicMessageCandidates.total >= 1)
  assert.ok(Array.isArray(report.dynamicMessageCandidateFindings))
  assert.ok(report.dynamicMessageCandidateFindings.length >= 1)
  assert.deepStrictEqual(report.warnings, [])
  assert.match(report.message, /unreviewed dynamic message candidate/i)
  assertReadOnly(root, before, result)
})

test('check fails deferred dynamic candidates by default with a disposition-specific diagnostic', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-deferred-error-'))
  const {
    dynamicCandidateId,
    scanCompleteStaticCopyPolicy
  } = require('../mycommon/complete-static-copy-policy')
  const expression = '`你好${name}`'
  const source = `module.exports = ${expression}\n`
  const id = dynamicCandidateId({
    path: 'src/app.js',
    expression,
    reason: 'interpolation'
  })
  const baselineViolations = scanCompleteStaticCopyPolicy([{ path: 'src/app.js', source }])
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { include: ["src"] }\n'
  )
  writeJson(root, 'lang/catalog/source-catalog.json', {})
  writeJson(root, 'lang/catalog/complete-static-copy-baseline.json', {
    version: 1,
    violations: baselineViolations
  })
  writeJson(root, 'lang/catalog/dynamic-message-decisions.json', {
    version: 1,
    decisions: [{
      id,
      path: 'src/app.js',
      expression,
      candidateReason: 'interpolation',
      decision: 'defer',
      reason: 'waiting on copy'
    }]
  })
  const before = snapshotTree(root)
  const result = run(['check', '--json'], root)
  assert.notStrictEqual(result.status, 0, result.stdout)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.ok(report.blocking.includes('deferred-dynamic-candidates'))
  assert.ok(!report.blocking.includes('unreviewed-dynamic-candidates'))
  assert.deepStrictEqual(report.warnings, [])
  assert.match(report.message, /deferred dynamic message candidate/i)
  assert.strictEqual(report.dynamicMessageCandidates.deferred, 1)
  assertReadOnly(root, before, result)
})

test('check warns for deferred dynamic candidates when deferredDynamicCandidates is warn', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-deferred-warn-'))
  const {
    dynamicCandidateId,
    scanCompleteStaticCopyPolicy
  } = require('../mycommon/complete-static-copy-policy')
  const expression = '`你好${name}`'
  const source = `module.exports = ${expression}\n`
  const id = dynamicCandidateId({
    path: 'src/app.js',
    expression,
    reason: 'interpolation'
  })
  const baselineViolations = scanCompleteStaticCopyPolicy([{ path: 'src/app.js', source }])
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { include: ["src"], deferredDynamicCandidates: "warn" }\n'
  )
  writeJson(root, 'lang/catalog/source-catalog.json', {})
  writeJson(root, 'lang/catalog/complete-static-copy-baseline.json', {
    version: 1,
    violations: baselineViolations
  })
  writeJson(root, 'lang/catalog/dynamic-message-decisions.json', {
    version: 1,
    decisions: [{
      id,
      path: 'src/app.js',
      expression,
      candidateReason: 'interpolation',
      decision: 'defer',
      reason: 'waiting on copy'
    }]
  })
  const before = snapshotTree(root)
  const result = run(['check', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.blocking, [])
  assert.strictEqual(report.warnings.length, 1)
  assert.strictEqual(report.warnings[0].code, 'deferred-dynamic-candidates')
  assert.match(report.warnings[0].message, /deferred dynamic message candidate/i)
  assert.strictEqual(report.dynamicMessageCandidates.deferred, 1)
  assertReadOnly(root, before, result)
})

test('check still fails never-reviewed candidates when deferredDynamicCandidates is warn', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-deferred-warn-unreviewed-'))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = `你好${name}`\n')
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { include: ["src"], deferredDynamicCandidates: "warn" }\n'
  )
  writeJson(root, 'lang/catalog/source-catalog.json', {})
  const before = snapshotTree(root)
  const result = run(['check', '--json'], root)
  assert.notStrictEqual(result.status, 0, result.stdout)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.ok(report.blocking.includes('unreviewed-dynamic-candidates'))
  assert.deepStrictEqual(report.warnings, [])
  assertReadOnly(root, before, result)
})

test('check fails for missing and needs-review target translations and reports stale keys without failing alone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-locale-'))
  const text = '标题'
  const key = keyFor(text)
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), `module.exports = "${text}"\n`)
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { include: ["src"], targetLocales: ["en", "fr"] }\n'
  )
  writeJson(root, 'lang/catalog/source-catalog.json', { [key]: text })
  writeJson(root, 'lang/catalog/en.json', { 'home.stale': 'Stale' })
  writeJson(root, 'lang/catalog/fr.json', { [key]: 'Titre' })
  writeJson(root, 'lang/catalog/translation-state.json', {
    version: 1,
    locales: {
      fr: {
        [key]: { sourceFingerprint: fingerprintOf('旧标题'), review: 'current' }
      }
    }
  })
  const before = snapshotTree(root)
  const result = run(['check', '--json'], root)
  assert.notStrictEqual(result.status, 0, result.stdout)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.ok(report.blocking.includes('missing-translations'))
  assert.ok(report.blocking.includes('needs-review-translations'))
  assert.ok(!report.blocking.includes('stale'))
  assert.deepStrictEqual(report.localeCoverage.en.missing, [key])
  assert.deepStrictEqual(report.localeCoverage.en.stale, ['home.stale'])
  assert.deepStrictEqual(report.localeCoverage.fr.needsReview, [key])
  assert.deepStrictEqual(report.staleTargetKeys, [{ key: 'home.stale', locale: 'en' }])
  assertReadOnly(root, before, result)
})

test('check succeeds when source catalog is fresh and every target locale is complete', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-complete-'))
  const text = '欢迎'
  const key = keyFor(text)
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), `module.exports = "${text}"\n`)
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { include: ["src"], targetLocales: ["en"] }\n'
  )
  writeJson(root, 'lang/catalog/source-catalog.json', { [key]: text })
  writeJson(root, 'lang/catalog/en.json', { [key]: 'Welcome' })
  writeJson(root, 'lang/catalog/translation-state.json', {
    version: 1,
    locales: {
      en: {
        [key]: { sourceFingerprint: fingerprintOf(text), review: 'current' }
      }
    }
  })
  const before = snapshotTree(root)
  const result = run(['check', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.blocking, [])
  assert.deepStrictEqual(report.localeCoverage.en, {
    translated: [key],
    missing: [],
    needsReview: [],
    stale: []
  })
  assert.deepStrictEqual(report.runtimeLocalization, {
    automaticallyRuntimeLocalizable: 1,
    alreadyLocalized: 0
  })
  assertReadOnly(root, before, result)
})

test('check stays read-only for malformed source catalog and translation state', () => {
  const catalogRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-bad-catalog-'))
  fs.mkdirSync(path.join(catalogRoot, 'src'), { recursive: true })
  fs.mkdirSync(path.join(catalogRoot, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(catalogRoot, 'src/app.js'), 'module.exports = 1\n')
  fs.writeFileSync(path.join(catalogRoot, 'i18n-collect.config.js'), 'module.exports = { include: ["src"] }\n')
  fs.writeFileSync(path.join(catalogRoot, 'lang/catalog/source-catalog.json'), '{not-json')
  const catalogBefore = snapshotTree(catalogRoot)
  const catalogResult = run(['check', '--json'], catalogRoot)
  assert.notStrictEqual(catalogResult.status, 0, catalogResult.stdout)
  const catalogReport = JSON.parse(catalogResult.stdout)
  assert.strictEqual(catalogReport.ok, false)
  assert.strictEqual(catalogReport.failure, 'configuration')
  assertReadOnly(catalogRoot, catalogBefore, catalogResult)

  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-bad-state-'))
  const text = '欢迎'
  const key = keyFor(text)
  fs.mkdirSync(path.join(stateRoot, 'src'), { recursive: true })
  fs.mkdirSync(path.join(stateRoot, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(stateRoot, 'src/app.js'), `module.exports = "${text}"\n`)
  fs.writeFileSync(
    path.join(stateRoot, 'i18n-collect.config.js'),
    'module.exports = { include: ["src"], targetLocales: ["en"] }\n'
  )
  writeJson(stateRoot, 'lang/catalog/source-catalog.json', { [key]: text })
  writeJson(stateRoot, 'lang/catalog/en.json', { [key]: 'Welcome' })
  fs.writeFileSync(path.join(stateRoot, 'lang/catalog/translation-state.json'), '{"version":2}')
  const stateBefore = snapshotTree(stateRoot)
  const stateResult = run(['check', '--json'], stateRoot)
  assert.notStrictEqual(stateResult.status, 0, stateResult.stdout)
  const stateReport = JSON.parse(stateResult.stdout)
  assert.strictEqual(stateReport.ok, false)
  assert.strictEqual(stateReport.failure, 'configuration')
  assertReadOnly(stateRoot, stateBefore, stateResult)
})

test('check stays read-only for human output, unknown options, and malformed target catalogs', () => {
  const humanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-human-'))
  writeCheckProject(humanRoot, '<p>未忽略</p>\n')
  const humanBefore = snapshotTree(humanRoot)
  const humanResult = run(['check'], humanRoot)
  assert.notStrictEqual(humanResult.status, 0, humanResult.stdout)
  assert.match(humanResult.stderr, /incomplete|unresolved/)
  assertReadOnly(humanRoot, humanBefore, humanResult)

  const okRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-human-ok-'))
  writeCheckProject(okRoot, [
    '<!-- i18n-ignore: legal copy stays Chinese -->',
    '<p>版权所有</p>',
    ''
  ].join('\n'))
  const okBefore = snapshotTree(okRoot)
  const okResult = run(['check'], okRoot)
  assert.strictEqual(okResult.status, 0, okResult.stderr)
  assert.match(okResult.stdout, /check: complete/)
  assertReadOnly(okRoot, okBefore, okResult)

  const unknownRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-unknown-'))
  writeCheckProject(unknownRoot, '<p></p>\n')
  const unknownBefore = snapshotTree(unknownRoot)
  const unknownResult = run(['check', '--nope'], unknownRoot)
  assert.notStrictEqual(unknownResult.status, 0, unknownResult.stdout)
  assert.match(unknownResult.stderr, /unknown option/)
  assertReadOnly(unknownRoot, unknownBefore, unknownResult)

  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-bad-target-'))
  const text = '欢迎'
  const key = keyFor(text)
  fs.mkdirSync(path.join(targetRoot, 'src'), { recursive: true })
  fs.mkdirSync(path.join(targetRoot, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(targetRoot, 'src/app.js'), `module.exports = "${text}"\n`)
  fs.writeFileSync(
    path.join(targetRoot, 'i18n-collect.config.js'),
    'module.exports = { include: ["src"], targetLocales: ["en"] }\n'
  )
  writeJson(targetRoot, 'lang/catalog/source-catalog.json', { [key]: text })
  fs.writeFileSync(path.join(targetRoot, 'lang/catalog/en.json'), '{bad')
  const targetBefore = snapshotTree(targetRoot)
  const targetResult = run(['check', '--json'], targetRoot)
  assert.notStrictEqual(targetResult.status, 0, targetResult.stdout)
  const targetReport = JSON.parse(targetResult.stdout)
  assert.strictEqual(targetReport.ok, false)
  assert.strictEqual(targetReport.failure, 'configuration')
  assertReadOnly(targetRoot, targetBefore, targetResult)
})
