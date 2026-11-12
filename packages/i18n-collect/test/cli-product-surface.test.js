const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const {
  CHECK_POLICY_REMOVED,
  RUN_REMOVED
} = require('../mycommon/legacy-contraction')

const bin = path.join(__dirname, '../bin/i18n-collect.js')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

test('root help presents the five primary commands and migration stubs', () => {
  const result = run(['--help'])
  assert.strictEqual(result.status, 0, result.stderr)
  assert.match(result.stdout, /\bscan\b/)
  assert.match(result.stdout, /\btranslate\b/)
  assert.match(result.stdout, /\bbuild\b/)
  assert.match(result.stdout, /\breplace\b/)
  assert.match(result.stdout, /\bcheck\b/)
  assert.match(result.stdout, /migrate-keys/)
  assert.match(result.stdout, /collect\s+Removed|Removed; use scan/i)
  assert.match(result.stdout, /verify\s+Removed|Removed; use scan then check/i)
  assert.match(result.stdout, /run\s+Removed|Removed; use scan, translate, and replace/i)
  assert.match(result.stdout, /check-policy\s+Removed|Removed; use check/i)
  assert.doesNotMatch(result.stdout, /check-policy\s+Report complete-static-copy/)
})

test('command help states write ownership for each primary command', () => {
  const collapse = text => text.replace(/\s+/g, ' ')

  const scan = run(['scan', '--help'])
  assert.strictEqual(scan.status, 0)
  assert.match(collapse(scan.stdout), /source catalog/i)
  assert.match(collapse(scan.stdout), /analysis report/i)
  assert.match(collapse(scan.stdout), /does not rewrite application source/i)

  const translate = run(['translate', '--help'])
  assert.strictEqual(translate.status, 0)
  assert.match(collapse(translate.stdout), /target-locale catalog|target catalogs/i)
  assert.match(collapse(translate.stdout), /does not rewrite application source/i)

  const build = run(['build', '--help'])
  assert.strictEqual(build.status, 0)
  assert.match(collapse(build.stdout), /read-only/i)
  assert.match(collapse(build.stdout), /does not create, update|never.*catalog|not.*source catalog/i)

  const replace = run(['replace', '--help'])
  assert.strictEqual(replace.status, 0)
  assert.match(collapse(replace.stdout), /--write/)
  assert.match(collapse(replace.stdout), /does not write catalogs/i)

  const check = run(['check', '--help'])
  assert.strictEqual(check.status, 0)
  assert.match(collapse(check.stdout), /without writing|never rewrites|writes no/i)
  assert.match(collapse(check.stdout), /complete-static-copy|runtime-multilingual|policy/i)
})

test('run fails with a bounded migration error for any invocation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-run-gone-'))
  const result = run(['run', '--translate', '--json'], root)
  assert.strictEqual(result.status, 1, result.stderr)
  assert.match(result.stderr, /run is removed/i)
  assert.match(result.stderr, /scan/i)
  assert.match(result.stderr, /translate/i)
  assert.match(result.stderr, /replace/i)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.strictEqual(report.command, 'run')
  assert.strictEqual(report.message, RUN_REMOVED)
})

test('check-policy fails with a bounded migration error pointing at check', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-policy-gone-'))
  const result = run(['check-policy', '--json'], root)
  assert.strictEqual(result.status, 1, result.stderr)
  assert.match(result.stderr, /check-policy is removed/i)
  assert.match(result.stderr, /check/i)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.strictEqual(report.command, 'check-policy')
  assert.strictEqual(report.message, CHECK_POLICY_REMOVED)
})
