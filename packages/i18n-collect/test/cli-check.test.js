const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const bin = path.join(__dirname, '../bin/i18n-collect.js')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function writeCheckProject(root, html) {
  fs.mkdirSync(path.join(root, 'public'), { recursive: true })
  fs.writeFileSync(path.join(root, 'public/index.html'), html)
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { include: ["public"], attributeAllowlist: ["title"] }\n'
  )
}

test('check help describes read-only localization completeness', () => {
  const result = run(['check', '--help'])
  assert.strictEqual(result.status, 0, result.stderr)
  assert.match(result.stdout, /i18n-collect check/)
  assert.match(result.stdout, /localization completeness/i)
  assert.match(result.stdout, /--json/)
})

test('check fails when standalone HTML audit findings remain unresolved', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-html-fail-'))
  writeCheckProject(root, [
    '<!DOCTYPE html>',
    '<html><body><p>未忽略</p></body></html>',
    ''
  ].join('\n'))

  const result = run(['check', '--json'], root)
  assert.notStrictEqual(result.status, 0, result.stdout)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'check')
  assert.strictEqual(report.ok, false)
  assert.ok(report.chineseSourceAudit.unresolved >= 1)
  assert.ok(Array.isArray(report.auditFindings))
  assert.ok(report.auditFindings.some(item => item.disposition === 'unresolved' && item.text === '未忽略'))
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/analysis-report.json')))
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/source-catalog.json')))
})

test('check fails with an actionable diagnostic for an unused HTML i18n-ignore', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-ignore-fail-'))
  writeCheckProject(root, '<!-- i18n-ignore: leftover -->\n<span></span>\n<p>文案</p>\n')
  const result = run(['check', '--json'], root)
  assert.notStrictEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /unused i18n-ignore|i18n-ignore/)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.match(report.message, /i18n-ignore/)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/analysis-report.json')))
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

  const result = run(['check', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'check')
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.chineseSourceAudit, {
    total: 1,
    unresolved: 0,
    intentionallyIgnored: 1
  })
  assert.strictEqual(report.auditFindings.length, 1)
  assert.strictEqual(report.auditFindings[0].disposition, 'intentionally-ignored')
  assert.strictEqual(report.auditFindings[0].ignoreReason, 'legal copy stays Chinese')
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/analysis-report.json')))
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/source-catalog.json')))
})
