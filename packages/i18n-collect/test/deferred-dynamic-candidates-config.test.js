const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { loadConfig, validate } = require('../mycommon/config')

test('validate defaults deferredDynamicCandidates to error', () => {
  const config = validate('/project', {})
  assert.strictEqual(config.deferredDynamicCandidates, 'error')
})

test('validate accepts deferredDynamicCandidates warn and error', () => {
  assert.strictEqual(
    validate('/project', { deferredDynamicCandidates: 'warn' }).deferredDynamicCandidates,
    'warn'
  )
  assert.strictEqual(
    validate('/project', { deferredDynamicCandidates: 'error' }).deferredDynamicCandidates,
    'error'
  )
})

test('validate rejects invalid deferredDynamicCandidates values', () => {
  assert.throws(
    () => validate('/project', { deferredDynamicCandidates: 'ignore' }),
    /deferredDynamicCandidates must be "error" or "warn"/
  )
  assert.throws(
    () => validate('/project', { deferredDynamicCandidates: true }),
    /deferredDynamicCandidates must be "error" or "warn"/
  )
})

test('loadConfig reads deferredDynamicCandidates from the project config file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-deferred-policy-config-'))
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { include: ["src"], deferredDynamicCandidates: "warn" }\n'
  )
  const config = loadConfig({ root })
  assert.strictEqual(config.deferredDynamicCandidates, 'warn')
})
