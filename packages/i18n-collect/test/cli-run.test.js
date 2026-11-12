const assert = require('assert')
const { spawnSync } = require('child_process')
const path = require('path')
const test = require('node:test')
const { RUN_REMOVED } = require('../mycommon/legacy-contraction')

const bin = path.join(__dirname, '../bin/i18n-collect.js')

function run(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

test('run help describes removal and points at the primary workflow', () => {
  const help = run(['run', '--help'])
  assert.strictEqual(help.status, 0)
  assert.strictEqual(help.stderr, '')
  assert.match(help.stdout, /i18n-collect run/)
  assert.match(help.stdout, /Removed/i)
  assert.match(help.stdout, /scan/)
  assert.match(help.stdout, /translate/)
  assert.match(help.stdout, /replace/)
})

test('run always fails with migration guidance', () => {
  const result = run(['run', '--translate', '--json'])
  assert.strictEqual(result.status, 1, result.stderr)
  assert.match(result.stderr, /run is removed/i)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.strictEqual(report.command, 'run')
  assert.strictEqual(report.message, RUN_REMOVED)
})
