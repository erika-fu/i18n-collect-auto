#!/usr/bin/env node
const { spawnSync } = require('child_process')
const path = require('path')
const {
  changedFormalOutputs,
  loadFormalOutputPaths,
  restoreFormalOutputs,
  snapshotFormalOutputs
} = require('../packages/i18n-collect/mycommon/formal-outputs')

const ROOT = path.resolve(__dirname, '..')
const BIN = path.join(ROOT, 'packages/i18n-collect/bin/i18n-collect.js')

const EXIT = {
  ok: 0,
  configuration: 1,
  collection: 2,
  build: 3,
  policy: 8,
  stale: 9,
  tests: 10,
  demoBuild: 11
}

const STEPS = [
  'react-verify',
  'vue-formal-freshness',
  'vue-check-policy',
  'package-tests',
  'react-demo-build'
]

const CATEGORY_HINTS = {
  configuration: 'Fix i18n-collect configuration or command options, then re-run npm run verify.',
  collection: 'Fix the collection failure (key conflict, identity ambiguity, invalid metadata, or loader integration). The policy baseline cannot suppress it.',
  build: 'Fix the webpack/demo build failure, then re-run npm run verify.',
  policy: 'Migrate the new or modified hybrid-localization violation to an explicit message, or update complete-static-copy-baseline.json for an exact grandfathered entry. Runtime-multilingual boundary literals cannot be grandfathered.',
  stale: 'Refresh and commit formal outputs (dictionary, source map, source-locale catalog, catalog metadata) via the project collection/build workflow.',
  tests: 'Fix the failing package tests under packages/i18n-collect, then re-run npm run verify.',
  'demo-build': 'Fix the React demo production build, then re-run npm run verify.'
}

function write(stream, text) {
  if (!text) return
  stream.write(text.endsWith('\n') ? text : `${text}\n`)
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...(options.env || {}) },
    shell: false
  })
}

function runNpm(args, options = {}) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return spawnSync(npmCmd, args, {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...(options.env || {}) },
    shell: process.platform === 'win32',
    windowsHide: true
  })
}

function fail(category, code, message, details = '') {
  const hint = CATEGORY_HINTS[category] || ''
  const lines = [
    `${category}: ${message}`,
    details.trim(),
    hint ? `hint: ${hint}` : ''
  ].filter(Boolean)
  return { code, stderr: `${lines.join('\n')}\n`, stdout: '', category }
}

function mapVerifyExit(code) {
  if (code === 0) return null
  if (code === EXIT.configuration) return 'configuration'
  if (code === EXIT.collection) return 'collection'
  if (code === EXIT.build) return 'build'
  if (code === EXIT.policy) return 'policy'
  if (code === EXIT.stale) return 'stale'
  return 'build'
}

function verifyReactDemo(runners) {
  const result = runners.runNode([BIN, 'verify', '--cwd', path.join(ROOT, 'apps/react-demo')])
  if (result.status === 0) {
    return { code: EXIT.ok, stdout: result.stdout, stderr: result.stderr || '', category: null }
  }
  const category = mapVerifyExit(result.status)
  return {
    code: result.status == null ? EXIT.build : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || `${category}: react-demo verify failed\n`,
    category
  }
}

function verifyVueFormalFreshness(runners) {
  const demoRoot = path.join(ROOT, 'apps/demo')
  let snapshot
  try {
    snapshot = snapshotFormalOutputs(demoRoot, loadFormalOutputPaths(demoRoot))
  } catch (error) {
    return fail('configuration', EXIT.configuration, error.message)
  }
  const build = runners.runNpm(['run', 'build', '-w', 'i18n-auto-webpack-demo'])
  if (build.status !== 0) {
    return fail(
      'build',
      EXIT.build,
      'Vue demo production build failed while checking formal-output freshness',
      build.stderr || build.stdout || ''
    )
  }
  const changed = changedFormalOutputs(demoRoot, snapshot)
  if (changed.length > 0) {
    restoreFormalOutputs(demoRoot, snapshot)
    return fail(
      'stale',
      EXIT.stale,
      'Vue demo formal collection outputs differ from committed artifacts',
      changed.map(file => `changed: ${file}`).join('\n')
    )
  }
  return { code: EXIT.ok, stdout: 'vue formal outputs are current\n', stderr: '', category: null }
}

function verifyVuePolicy(runners) {
  const result = runners.runNode([BIN, 'check-policy', '--cwd', path.join(ROOT, 'apps/demo')])
  if (result.status === 0) {
    return { code: EXIT.ok, stdout: result.stdout, stderr: '', category: null }
  }
  if (result.status === 1) {
    return {
      code: EXIT.configuration,
      stdout: result.stdout || '',
      stderr: result.stderr || 'configuration: Vue demo check-policy failed\n',
      category: 'configuration'
    }
  }
  return {
    code: EXIT.policy,
    stdout: result.stdout || '',
    stderr: result.stderr || 'policy: Vue demo hybrid localization policy check failed\n',
    category: 'policy'
  }
}

function runPackageTests(runners) {
  const result = runners.runNpm(['test', '-w', 'i18n-collect'])
  if (result.status === 0) {
    return { code: EXIT.ok, stdout: result.stdout || '', stderr: result.stderr || '', category: null }
  }
  return fail(
    'tests',
    EXIT.tests,
    'package test suite failed',
    result.stderr || result.stdout || ''
  )
}

function buildReactDemo(runners) {
  const demoRoot = path.join(ROOT, 'apps/react-demo')
  let snapshot
  try {
    snapshot = snapshotFormalOutputs(demoRoot, loadFormalOutputPaths(demoRoot))
  } catch (error) {
    return fail('configuration', EXIT.configuration, error.message)
  }
  const result = runners.runNpm(['run', 'build-react-demo'])
  if (result.status !== 0) {
    return fail(
      'demo-build',
      EXIT.demoBuild,
      'React demo production build failed',
      result.stderr || result.stdout || ''
    )
  }
  const changed = changedFormalOutputs(demoRoot, snapshot)
  if (changed.length > 0) {
    restoreFormalOutputs(demoRoot, snapshot)
    return fail(
      'stale',
      EXIT.stale,
      'React demo production build would change formal collection outputs',
      changed.map(file => `changed: ${file}`).join('\n')
    )
  }
  return { code: EXIT.ok, stdout: result.stdout || '', stderr: result.stderr || '', category: null }
}

const STEP_RUNNERS = {
  'react-verify': verifyReactDemo,
  'vue-formal-freshness': verifyVueFormalFreshness,
  'vue-check-policy': verifyVuePolicy,
  'package-tests': runPackageTests,
  'react-demo-build': buildReactDemo
}

function defaultRunners() {
  return { runNode, runNpm }
}

function main(options = {}) {
  const runners = options.runners || defaultRunners()
  const steps = options.steps || STEPS
  write(process.stdout, 'verify-hybrid-localization: starting')
  for (const step of steps) {
    const runStep = STEP_RUNNERS[step]
    if (!runStep) {
      const failure = fail('configuration', EXIT.configuration, `unknown verify step "${step}"`)
      write(process.stderr, failure.stderr)
      return failure.code
    }
    write(process.stdout, `verify-hybrid-localization: ${step}`)
    const result = runStep(runners)
    if (result.stdout) write(process.stdout, result.stdout)
    if (result.code !== EXIT.ok) {
      write(process.stderr, result.stderr)
      return result.code
    }
  }
  write(process.stdout, 'verify-hybrid-localization: ok')
  return EXIT.ok
}

if (require.main === module) {
  process.exitCode = main()
}

module.exports = {
  CATEGORY_HINTS,
  EXIT,
  STEPS,
  main,
  mapVerifyExit
}
