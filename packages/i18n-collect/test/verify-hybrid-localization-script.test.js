const assert = require('assert')
const fs = require('fs')
const path = require('path')
const test = require('node:test')
const {
  CATEGORY_HINTS,
  EXIT,
  SKIP_PACKAGE_TESTS_FLAG,
  STEPS,
  main,
  mapVerifyExit,
  resolveSteps
} = require('../../../scripts/verify-hybrid-localization')

test('workspace verify script exposes the hybrid gate steps and category hints', () => {
  assert.deepStrictEqual(STEPS, [
    'react-verify',
    'vue-formal-freshness',
    'vue-check-policy',
    'vue3-formal-freshness',
    'vue3-check-policy',
    'package-tests',
    'react-demo-build'
  ])
  assert.ok(CATEGORY_HINTS.stale)
  assert.ok(CATEGORY_HINTS.policy)
  assert.ok(CATEGORY_HINTS.collection)
  assert.ok(CATEGORY_HINTS.tests)
  assert.ok(CATEGORY_HINTS['demo-build'])
  assert.match(CATEGORY_HINTS.policy, /baseline/i)
  assert.match(CATEGORY_HINTS.stale, /formal outputs/i)
  assert.strictEqual(mapVerifyExit(EXIT.stale), 'stale')
  assert.strictEqual(mapVerifyExit(EXIT.policy), 'policy')
  assert.strictEqual(mapVerifyExit(EXIT.collection), 'collection')
  assert.deepStrictEqual(
    resolveSteps({ argv: [SKIP_PACKAGE_TESTS_FLAG] }),
    STEPS.filter(step => step !== 'package-tests')
  )

  const rootPackage = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'))
  assert.strictEqual(rootPackage.scripts.verify, 'node scripts/verify-hybrid-localization.js')
  assert.match(rootPackage.scripts.regression, /--skip-package-tests/)
})

test('workspace verify maps a failing react-verify step to its category and stops', () => {
  const calls = []
  const code = main({
    runners: {
      runNode(args) {
        calls.push(['node', ...args])
        return { status: EXIT.stale, stdout: '', stderr: 'stale: formal collection outputs differ\n' }
      },
      runNpm(args) {
        calls.push(['npm', ...args])
        return { status: 0, stdout: '', stderr: '' }
      }
    }
  })
  assert.strictEqual(code, EXIT.stale)
  assert.ok(calls.some(call => call[0] === 'node' && call.includes('verify')))
  assert.ok(!calls.some(call => call[0] === 'npm'))
})

test('workspace verify continues through mocked green steps', () => {
  const nodeCalls = []
  const npmCalls = []
  const code = main({
    steps: [
      'react-verify',
      'vue-check-policy',
      'vue3-check-policy',
      'package-tests',
      'react-demo-build'
    ],
    runners: {
      runNode(args) {
        nodeCalls.push(args)
        return { status: 0, stdout: 'ok\n', stderr: '' }
      },
      runNpm(args) {
        npmCalls.push(args)
        return { status: 0, stdout: 'ok\n', stderr: '' }
      }
    }
  })
  assert.strictEqual(code, EXIT.ok)
  assert.ok(nodeCalls.some(args => args.includes('verify')))
  assert.ok(nodeCalls.filter(args => args.includes('check-policy')).length >= 2)
  assert.ok(nodeCalls.some(args => args.some(part => String(part).includes('vue3-demo'))))
  assert.deepStrictEqual(npmCalls[0], ['test', '-w', 'i18n-collect'])
  assert.deepStrictEqual(npmCalls[1], ['run', 'build-react-demo'])
})

test('workspace verify can skip package tests for the regression gate', () => {
  const npmCalls = []
  const code = main({
    argv: [SKIP_PACKAGE_TESTS_FLAG],
    steps: ['react-verify', 'package-tests', 'react-demo-build'],
    runners: {
      runNode() {
        return { status: 0, stdout: 'ok\n', stderr: '' }
      },
      runNpm(args) {
        npmCalls.push(args)
        return { status: 0, stdout: 'ok\n', stderr: '' }
      }
    }
  })
  assert.strictEqual(code, EXIT.ok)
  assert.deepStrictEqual(npmCalls, [['run', 'build-react-demo']])
})

test('workspace react-demo-build fails as stale when the production build rewrites formal outputs', () => {
  const demoRoot = path.join(__dirname, '../../../apps/react-demo')
  const metaPath = path.join(demoRoot, 'lang/catalog/catalog.meta.json')
  const before = fs.readFileSync(metaPath)
  const code = main({
    steps: ['react-demo-build'],
    runners: {
      runNode() {
        return { status: 0, stdout: '', stderr: '' }
      },
      runNpm() {
        fs.writeFileSync(metaPath, `${before.toString('utf8').trim()}\n\n`)
        return { status: 0, stdout: 'built\n', stderr: '' }
      }
    }
  })
  assert.strictEqual(code, EXIT.stale)
  assert.deepStrictEqual(fs.readFileSync(metaPath), before)
})
