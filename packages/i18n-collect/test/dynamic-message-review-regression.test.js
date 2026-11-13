/**
 * End-to-end dynamic message review and demo regression (issue 08).
 * Seams: CLI collect/scan/review/check, formal collection outputs, demo workflows,
 * root regression / verify gate (no uncommitted generated artifacts).
 */
const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const {
  dynamicCandidateId,
  scanCompleteStaticCopyPolicy
} = require('../mycommon/complete-static-copy-policy')
const {
  changedFormalOutputs,
  loadFormalOutputPaths,
  snapshotFormalOutputs
} = require('../mycommon/formal-outputs')
const { installVue2 } = require('./vue2-fixture')
const { installVue3 } = require('./vue3-fixture')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')
const workspaceRoot = path.resolve(__dirname, '../../..')
const demoRoot = path.join(workspaceRoot, 'apps/demo')
const vue3DemoRoot = path.join(workspaceRoot, 'apps/vue3-demo')
const reactDemoRoot = path.join(workspaceRoot, 'apps/react-demo')

function run(args, cwd, env = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', CI: '1', ...env },
    timeout: 300000
  })
}

function writeFile(root, name, contents) {
  const file = path.join(root, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
  return file
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
}

function writeJson(root, relative, value) {
  writeFile(root, relative, `${JSON.stringify(value, null, 2)}\n`)
}

function decisionEntry({ projectPath, expression, candidateReason, decision, reason, key, occurrence }) {
  return {
    id: dynamicCandidateId({
      path: projectPath,
      expression,
      reason: candidateReason,
      occurrence
    }),
    path: projectPath,
    expression,
    candidateReason,
    decision,
    ...(occurrence ? { occurrence } : {}),
    ...(reason ? { reason } : {}),
    ...(key ? { key } : {})
  }
}

function writeWorkflowProject(root, {
  source,
  decisions = [],
  explicitMessages,
  webpack = false,
  configSource = 'module.exports = { include: ["src"] }\n'
}) {
  writeFile(root, 'src/app.js', source)
  writeFile(root, 'i18n-collect.config.js', configSource)
  writeJson(root, 'lang/catalog/dynamic-message-decisions.json', {
    version: 1,
    decisions
  })
  if (explicitMessages) {
    writeJson(root, 'lang/catalog/explicit-messages.json', {
      version: 1,
      messages: explicitMessages
    })
  }
  if (!webpack) return
  writeFile(root, 'webpack.config.js', `const path = require('path')
const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: 'development',
  devtool: false,
  entry: './src/app.js',
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist') },
  module: { rules: [{ test: /\\.[cm]?[jt]sx?$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin()]
}
`)
}

function candidateTuples(analysis) {
  return analysis.dynamicMessageCandidates.map(item => [
    item.id,
    item.disposition,
    item.key || item.ignoreReason || item.deferReason || null
  ])
}

function assertNoRetiredFragmentModel(report) {
  assert.ok(Array.isArray(report.dynamicMessageCandidates))
  assert.ok(!Object.prototype.hasOwnProperty.call(report, 'explicitRequiredFindings'))
}

function writeCompleteStaticCopyBaseline(root, files) {
  writeJson(root, 'lang/catalog/complete-static-copy-baseline.json', {
    version: 1,
    violations: scanCompleteStaticCopyPolicy(
      files.map(file => ({
        path: file.path,
        source: file.source != null
          ? file.source
          : fs.readFileSync(path.join(root, file.path), 'utf8')
      }))
    )
  })
}

function snapshotDemoTree(root) {
  const paths = loadFormalOutputPaths(root)
  return {
    formal: snapshotFormalOutputs(root, paths),
    decisions: fs.readFileSync(path.join(root, 'lang/catalog/dynamic-message-decisions.json')),
    explicit: fs.existsSync(path.join(root, 'lang/catalog/explicit-messages.json'))
      ? fs.readFileSync(path.join(root, 'lang/catalog/explicit-messages.json'))
      : null,
    sources: [
      'src/App.vue',
      'src/App.jsx',
      'src/App.js',
      'src/main.js',
      'src/index.js'
    ]
      .filter(relative => fs.existsSync(path.join(root, relative)))
      .map(relative => ({
        relative,
        content: fs.readFileSync(path.join(root, relative))
      }))
  }
}

function assertDemoUnchanged(root, before) {
  assert.deepStrictEqual(
    changedFormalOutputs(root, before.formal),
    [],
    `formal outputs changed under ${path.basename(root)}`
  )
  assert.deepStrictEqual(
    fs.readFileSync(path.join(root, 'lang/catalog/dynamic-message-decisions.json')),
    before.decisions
  )
  if (before.explicit) {
    assert.deepStrictEqual(
      fs.readFileSync(path.join(root, 'lang/catalog/explicit-messages.json')),
      before.explicit
    )
  }
  for (const entry of before.sources) {
    assert.deepStrictEqual(
      fs.readFileSync(path.join(root, entry.relative)),
      entry.content,
      `${entry.relative} changed under ${path.basename(root)}`
    )
  }
}

test('collect and scan publish equivalent candidate disposition semantics from shared decisions', {
  timeout: 60000
}, () => {
  const pendingExpression = "'已选择 ' + count + ' 个文件'"
  const ignoredExpression = '`你好${name}世界`'
  const pending = decisionEntry({
    projectPath: 'src/app.js',
    expression: pendingExpression,
    candidateReason: 'concatenation',
    decision: 'translate',
    key: 'upload.selectedFiles'
  })
  const ignored = decisionEntry({
    projectPath: 'src/app.js',
    expression: ignoredExpression,
    candidateReason: 'interpolation',
    decision: 'ignore',
    reason: 'greeting stays in source'
  })
  const source = [
    `const label = ${pendingExpression}`,
    `const message = ${ignoredExpression}`,
    'module.exports = { label, message }',
    ''
  ].join('\n')
  const explicitMessages = [
    { key: 'upload.selectedFiles', source: '已选择 {count} 个文件' }
  ]
  const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dmr-scan-parity-'))
  const collectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dmr-collect-parity-'))
  writeWorkflowProject(scanRoot, {
    source,
    decisions: [pending, ignored],
    explicitMessages
  })
  writeWorkflowProject(collectRoot, {
    source,
    decisions: [pending, ignored],
    explicitMessages,
    webpack: true
  })

  const scanned = run(['scan', '--json'], scanRoot)
  assert.strictEqual(scanned.status, 0, scanned.stderr)
  const collected = run(['collect', '--json'], collectRoot)
  assert.strictEqual(collected.status, 0, collected.stderr)

  const scanAnalysis = readJson(scanRoot, 'lang/catalog/analysis-report.json')
  const collectAnalysis = readJson(collectRoot, 'lang/catalog/analysis-report.json')
  assertNoRetiredFragmentModel(scanAnalysis)
  assertNoRetiredFragmentModel(collectAnalysis)
  const expected = [
    [pending.id, 'translation-approved', 'upload.selectedFiles'],
    [ignored.id, 'intentionally-ignored', 'greeting stays in source']
  ].sort((left, right) => left[0].localeCompare(right[0]))
  assert.deepStrictEqual(
    candidateTuples(scanAnalysis).sort((left, right) => left[0].localeCompare(right[0])),
    expected
  )
  assert.deepStrictEqual(
    candidateTuples(collectAnalysis).sort((left, right) => left[0].localeCompare(right[0])),
    expected
  )
})

test('failed decision validation does not replace prior formal collection outputs', {
  timeout: 60000
}, () => {
  const expression = '`你好${name}世界`'
  const entry = decisionEntry({
    projectPath: 'src/app.js',
    expression,
    candidateReason: 'interpolation',
    decision: 'ignore',
    reason: 'greeting stays in source'
  })

  const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dmr-scan-atomic-'))
  writeWorkflowProject(scanRoot, {
    source: 'const message = "你好"\nmodule.exports = message\n',
    decisions: []
  })
  assert.strictEqual(run(['scan', '--json'], scanRoot).status, 0)
  const scanCatalog = fs.readFileSync(path.join(scanRoot, 'lang/catalog/source-catalog.json'))
  const scanReport = fs.readFileSync(path.join(scanRoot, 'lang/catalog/analysis-report.json'))
  writeWorkflowProject(scanRoot, {
    source: `const message = ${expression}\nmodule.exports = message\n`,
    decisions: [{ ...entry, expression: '`你好${name}宇宙`' }]
  })
  const scanFailed = run(['scan', '--json'], scanRoot)
  assert.notStrictEqual(scanFailed.status, 0, scanFailed.stdout)
  assert.match(scanFailed.stderr, /does not match a current candidate|does not match its recorded candidate/)
  assert.deepStrictEqual(
    fs.readFileSync(path.join(scanRoot, 'lang/catalog/source-catalog.json')),
    scanCatalog
  )
  assert.deepStrictEqual(
    fs.readFileSync(path.join(scanRoot, 'lang/catalog/analysis-report.json')),
    scanReport
  )

  const collectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dmr-collect-atomic-'))
  writeWorkflowProject(collectRoot, {
    source: 'const message = "你好"\nmodule.exports = message\n',
    decisions: [],
    webpack: true
  })
  assert.strictEqual(run(['collect', '--json'], collectRoot).status, 0)
  const collectCatalog = fs.readFileSync(path.join(collectRoot, 'lang/catalog/source-catalog.json'))
  const collectReport = fs.readFileSync(path.join(collectRoot, 'lang/catalog/analysis-report.json'))
  const collectDictionary = fs.readFileSync(path.join(collectRoot, 'lang/zh_hash.json'))
  writeWorkflowProject(collectRoot, {
    source: `const message = ${expression}\nmodule.exports = message\n`,
    decisions: [{ ...entry, expression: '`你好${name}宇宙`' }],
    webpack: true
  })
  const collectFailed = run(['collect', '--json'], collectRoot)
  assert.notStrictEqual(collectFailed.status, 0, collectFailed.stdout)
  assert.deepStrictEqual(
    fs.readFileSync(path.join(collectRoot, 'lang/catalog/source-catalog.json')),
    collectCatalog
  )
  assert.deepStrictEqual(
    fs.readFileSync(path.join(collectRoot, 'lang/catalog/analysis-report.json')),
    collectReport
  )
  assert.deepStrictEqual(
    fs.readFileSync(path.join(collectRoot, 'lang/zh_hash.json')),
    collectDictionary
  )
})

test('review lifecycle covers decisions, proven-safe write success and refusal, and completeness policy', {
  timeout: 120000
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dmr-lifecycle-'))
  const safeSource = "const label = '已选择 ' + count + ' 个文件'"
  const unsafeSource = 'const status = ready ? "就绪" : "等待"'
  writeFile(root, 'src/app.js', `${safeSource}\n${unsafeSource}\nmodule.exports = { label, status }\n`)
  writeFile(root, 'i18n-collect.config.js', 'module.exports = { include: ["src"] }\n')

  const listed = run(['review', '--status', 'needs-review', '--json'], root)
  assert.strictEqual(listed.status, 0, listed.stderr)
  const candidates = JSON.parse(listed.stdout).candidates
  assert.strictEqual(candidates.length, 2)
  const safe = candidates.find(item => item.expression.includes('已选择'))
  const unsafe = candidates.find(item => item.expression.includes('就绪'))
  assert.ok(safe)
  assert.ok(unsafe)

  const blocked = run(['check', '--json'], root)
  assert.notStrictEqual(blocked.status, 0)
  assert.ok(JSON.parse(blocked.stdout).blocking.includes('unreviewed-dynamic-candidates'))

  const translated = run([
    'review', safe.id,
    '--translate',
    '--key', 'upload.selectedFiles',
    '--source', '已选择 {count} 个文件',
    '--yes',
    '--json'
  ], root)
  assert.strictEqual(translated.status, 0, translated.stderr)
  assert.strictEqual(JSON.parse(translated.stdout).action, 'translate')

  const approvedBlocked = run(['check', '--json'], root)
  assert.notStrictEqual(approvedBlocked.status, 0)
  const approvedReport = JSON.parse(approvedBlocked.stdout)
  assert.ok(approvedReport.blocking.includes('translation-approved-dynamic-candidates'))
  assert.ok(approvedReport.blocking.includes('unreviewed-dynamic-candidates'))

  const written = run([
    'review', safe.id,
    '--write',
    '--adapter', 'js',
    '--yes',
    '--json'
  ], root)
  assert.strictEqual(written.status, 0, written.stderr)
  assert.strictEqual(JSON.parse(written.stdout).action, 'write')
  assert.match(
    fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'),
    /t\('upload\.selectedFiles', \{ count \}\)/
  )
  assert.strictEqual(
    readJson(root, 'lang/catalog/dynamic-message-decisions.json').decisions
      .find(item => item.id === safe.id).decision,
    'migrated'
  )

  const deferred = run([
    'review', unsafe.id,
    '--defer',
    '--reason', 'conditional stays manual',
    '--yes',
    '--json'
  ], root)
  assert.strictEqual(deferred.status, 0, deferred.stderr)
  const deferredBlocked = run(['check', '--json'], root)
  assert.notStrictEqual(deferredBlocked.status, 0)
  assert.ok(JSON.parse(deferredBlocked.stdout).blocking.includes('deferred-dynamic-candidates'))

  const ignored = run([
    'review', unsafe.id,
    '--ignore',
    '--reason', 'conditional stays in source locale',
    '--yes',
    '--json'
  ], root)
  assert.strictEqual(ignored.status, 0, ignored.stderr)

  const refuseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dmr-lifecycle-refuse-'))
  const unsafeOnly = 'const status = ready ? "就绪" : "等待"\nmodule.exports = status\n'
  writeFile(refuseRoot, 'src/app.js', unsafeOnly)
  writeFile(refuseRoot, 'i18n-collect.config.js', 'module.exports = { include: ["src"] }\n')
  const refuseListed = run(['review', '--json'], refuseRoot)
  assert.strictEqual(refuseListed.status, 0, refuseListed.stderr)
  const refuseId = JSON.parse(refuseListed.stdout).candidates[0].id
  assert.strictEqual(run([
    'review', refuseId,
    '--translate',
    '--key', 'status.label',
    '--source', '就绪等待',
    '--yes',
    '--json'
  ], refuseRoot).status, 0)
  const beforeRefuse = fs.readFileSync(path.join(refuseRoot, 'src/app.js'), 'utf8')
  const refused = run([
    'review', refuseId,
    '--write',
    '--adapter', 'js',
    '--yes',
    '--json'
  ], refuseRoot)
  assert.notStrictEqual(refused.status, 0)
  assert.match(refused.stderr, /not proven-safe|proven-safe|refused|cannot/i)
  assert.strictEqual(fs.readFileSync(path.join(refuseRoot, 'src/app.js'), 'utf8'), beforeRefuse)
  assert.strictEqual(
    readJson(refuseRoot, 'lang/catalog/dynamic-message-decisions.json').decisions[0].decision,
    'translate'
  )
  const refuseCheck = run(['check', '--json'], refuseRoot)
  assert.notStrictEqual(refuseCheck.status, 0)
  assert.ok(JSON.parse(refuseCheck.stdout).blocking.includes('translation-approved-dynamic-candidates'))

  assert.strictEqual(run(['scan', '--json'], root).status, 0)
  const analysis = readJson(root, 'lang/catalog/analysis-report.json')
  assertNoRetiredFragmentModel(analysis)
  assert.deepStrictEqual(
    analysis.dynamicMessageCandidates.map(item => item.disposition).sort(),
    ['intentionally-ignored']
  )
  assert.ok(analysis.migratedDynamicDecisions.some(item => item.id === safe.id))

  assert.strictEqual(run(['review', '--prune', '--yes', '--json'], root).status, 0)
  assert.strictEqual(run(['scan', '--json'], root).status, 0)
  writeCompleteStaticCopyBaseline(root, [{
    path: 'src/app.js',
    source: fs.readFileSync(path.join(root, 'src/app.js'), 'utf8')
  }])

  const checked = run(['check', '--json'], root)
  assert.strictEqual(checked.status, 0, checked.stderr || checked.stdout)
  const checkReport = JSON.parse(checked.stdout)
  assert.strictEqual(checkReport.ok, true)
  assert.deepStrictEqual(checkReport.blocking, [])
  assert.strictEqual(checkReport.dynamicMessageCandidates.intentionallyIgnored, 1)
  assert.strictEqual(checkReport.dynamicMessageCandidates.translationApproved, 0)
  assert.strictEqual(checkReport.dynamicMessageCandidates.needsReview, 0)
})

test('Vue 2 demo fixture teaching path: scan → review → proven-safe --write → check', {
  timeout: 120000
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dmr-vue2-fixture-'))
  installVue2(root)
  const fixture = fs.readFileSync(
    path.join(demoRoot, 'fixtures/ForbiddenLiteralPatterns.vue'),
    'utf8'
  )
  writeFile(root, 'src/ForbiddenLiteralPatterns.vue', fixture)
  writeFile(root, 'i18n-collect.config.js', [
    'module.exports = {',
    '  include: ["src"],',
    '  vueVersion: 2',
    '}',
    ''
  ].join('\n'))

  const listed = run(['review', '--status', 'needs-review', '--json'], root)
  assert.strictEqual(listed.status, 0, listed.stderr)
  const candidates = JSON.parse(listed.stdout).candidates
  assert.ok(candidates.length >= 1)
  const interpolation = candidates.find(item => /欢迎.*回来/.test(item.expression))
  assert.ok(interpolation, 'expected welcome-back interpolation candidate')

  for (const leftover of candidates.filter(item => item.id !== interpolation.id)) {
    assert.strictEqual(run([
      'review', leftover.id,
      '--ignore',
      '--reason', 'fixture leftover kept for teaching',
      '--yes',
      '--json'
    ], root).status, 0)
  }

  assert.strictEqual(run([
    'review', interpolation.id,
    '--translate',
    '--key', 'demo.welcomeBack',
    '--source', '欢迎{name}回来',
    '--yes',
    '--json'
  ], root).status, 0)

  const written = run([
    'review', interpolation.id,
    '--write',
    '--adapter', 'vue2',
    '--yes',
    '--json'
  ], root)
  assert.strictEqual(written.status, 0, written.stderr)
  const next = fs.readFileSync(path.join(root, 'src/ForbiddenLiteralPatterns.vue'), 'utf8')
  assert.match(next, /\$t\('demo\.welcomeBack'/)
  assert.ok(!next.includes('`欢迎${name}回来`'))

  assert.strictEqual(run(['scan', '--json'], root).status, 0, 'scan after vue2 write')
  assert.strictEqual(run(['review', '--prune', '--yes', '--json'], root).status, 0)
  assert.strictEqual(run(['scan', '--json'], root).status, 0)
  writeCompleteStaticCopyBaseline(root, [{ path: 'src/ForbiddenLiteralPatterns.vue' }])
  const checked = run(['check', '--json'], root)
  assert.strictEqual(checked.status, 0, checked.stderr || checked.stdout)
  assert.strictEqual(JSON.parse(checked.stdout).ok, true)
})

test('Vue 3 demo fixture teaching path: scan → review → proven-safe --write → check', {
  timeout: 120000
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dmr-vue3-fixture-'))
  installVue3(root)
  const fixture = fs.readFileSync(
    path.join(vue3DemoRoot, 'fixtures/ForbiddenInterpolationPatterns.vue'),
    'utf8'
  )
  writeFile(root, 'src/ForbiddenInterpolationPatterns.vue', fixture)
  writeFile(root, 'i18n-collect.config.js', [
    'module.exports = {',
    '  include: ["src"],',
    '  vueVersion: 3',
    '}',
    ''
  ].join('\n'))

  const listed = run(['review', '--json'], root)
  assert.strictEqual(listed.status, 0, listed.stderr)
  const candidates = JSON.parse(listed.stdout).candidates
  assert.ok(candidates.length >= 1)
  const placeholder = candidates.find(item => /输入/.test(item.expression))
  assert.ok(placeholder)

  assert.strictEqual(run([
    'review', placeholder.id,
    '--translate',
    '--key', 'vue3.fieldPlaceholder',
    '--source', '输入{fieldName}名称',
    '--yes',
    '--json'
  ], root).status, 0)

  const written = run([
    'review', placeholder.id,
    '--write',
    '--adapter', 'vue3',
    '--yes',
    '--json'
  ], root)
  assert.strictEqual(written.status, 0, written.stderr)
  const next = fs.readFileSync(path.join(root, 'src/ForbiddenInterpolationPatterns.vue'), 'utf8')
  assert.match(next, /\$t\('vue3\.fieldPlaceholder'/)
  assert.ok(!next.includes("'输入' + fieldName + '名称'"))

  assert.strictEqual(run(['scan', '--json'], root).status, 0, 'scan after vue3 write')
  assert.strictEqual(run(['review', '--prune', '--yes', '--json'], root).status, 0)
  assert.strictEqual(run(['scan', '--json'], root).status, 0)
  const checked = run(['check', '--json'], root)
  assert.strictEqual(checked.status, 0, checked.stderr || checked.stdout)
  assert.strictEqual(JSON.parse(checked.stdout).ok, true)
})

test('standard, React, and Vue 3 demos keep supported review workflow artifacts clean', {
  timeout: 600000
}, () => {
  const demos = [
    {
      root: demoRoot,
      label: 'demo',
      reviewAdapter: 'vue2',
      expectsBuild: true,
      explicitKeys: ['demo.welcomeBack']
    },
    {
      root: vue3DemoRoot,
      label: 'vue3-demo',
      reviewAdapter: 'vue3',
      expectsBuild: true,
      explicitKeys: ['vue3.welcomeBack', 'vue3.fieldPlaceholder']
    },
    {
      root: reactDemoRoot,
      label: 'react-demo',
      reviewAdapter: null,
      expectsBuild: false,
      explicitKeys: ['react.app.title', 'react.app.taskSummary']
    }
  ]

  for (const demo of demos) {
    const before = snapshotDemoTree(demo.root)
    const decisions = readJson(demo.root, 'lang/catalog/dynamic-message-decisions.json')
    assert.strictEqual(decisions.version, 1)
    assert.ok(Array.isArray(decisions.decisions))

    const report = readJson(demo.root, 'lang/catalog/analysis-report.json')
    assertNoRetiredFragmentModel(report)
    assert.ok(
      !report.dynamicMessageCandidates.some(item => item.disposition === 'needs-review'),
      `${demo.label} still has needs-review live candidates`
    )

    const reviewed = run(['review', '--status', 'needs-review', '--json'], demo.root)
    assert.strictEqual(reviewed.status, 0, `${demo.label}: ${reviewed.stderr}`)
    assert.strictEqual(
      JSON.parse(reviewed.stdout).candidates.length,
      0,
      `${demo.label} review listed unresolved candidates`
    )

    const collected = run(['collect', '--json'], demo.root)
    assert.strictEqual(collected.status, 0, `${demo.label} collect: ${collected.stderr || collected.stdout}`)

    const checked = run(['check', '--json'], demo.root)
    assert.strictEqual(checked.status, 0, `${demo.label}: ${checked.stderr || checked.stdout}`)
    const checkReport = JSON.parse(checked.stdout)
    assert.strictEqual(checkReport.ok, true, demo.label)
    assert.deepStrictEqual(checkReport.blocking, [])

    const explicit = readJson(demo.root, 'lang/catalog/explicit-messages.json')
    for (const key of demo.explicitKeys) {
      assert.ok(
        explicit.messages.some(item => item.key === key),
        `${demo.label} missing explicit key ${key}`
      )
    }

    if (demo.expectsBuild) {
      const built = run(['build', '--json'], demo.root)
      assert.strictEqual(built.status, 0, `${demo.label}: ${built.stderr || built.stdout}`)
    }

    assertDemoUnchanged(demo.root, before)
  }

  const reactFormalBefore = snapshotFormalOutputs(
    reactDemoRoot,
    loadFormalOutputPaths(reactDemoRoot)
  )
  const reactBuild = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'build', '-w', 'i18n-auto-webpack-react-demo'],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      shell: process.platform === 'win32',
      timeout: 300000,
      windowsHide: true
    }
  )
  assert.strictEqual(reactBuild.status, 0, reactBuild.stderr || reactBuild.stdout)
  assert.deepStrictEqual(changedFormalOutputs(reactDemoRoot, reactFormalBefore), [])
})

test('root regression and verify scripts cover package tests plus demo verification without artifact mutation', {
  timeout: 600000
}, () => {
  const workspace = require(path.join(workspaceRoot, 'package.json'))
  assert.strictEqual(
    workspace.scripts.regression,
    'npm test && npm run build && npm run build-vue3-demo && npm run build-react-demo && node scripts/verify-hybrid-localization.js --skip-package-tests'
  )
  assert.strictEqual(
    workspace.scripts.verify,
    'node scripts/verify-hybrid-localization.js'
  )
  assert.ok(workspace.scripts['update-demo-collection'])
  assert.ok(workspace.scripts['update-vue3-demo-collection'])
  assert.ok(workspace.scripts['update-react-demo-collection'])

  const {
    SKIP_PACKAGE_TESTS_FLAG,
    STEPS,
    resolveSteps
  } = require('../../../scripts/verify-hybrid-localization')
  assert.deepStrictEqual(
    resolveSteps({}),
    [
      'react-check',
      'vue-formal-freshness',
      'vue-check',
      'vue3-formal-freshness',
      'vue3-check',
      'package-tests',
      'react-demo-build'
    ]
  )
  assert.deepStrictEqual(
    resolveSteps({ argv: [SKIP_PACKAGE_TESTS_FLAG] }),
    STEPS.filter(step => step !== 'package-tests')
  )
  assert.ok(STEPS.includes('package-tests'))
  assert.ok(STEPS.includes('vue-formal-freshness'))
  assert.ok(STEPS.includes('vue3-formal-freshness'))
  assert.ok(STEPS.includes('react-demo-build'))

  for (const demo of [demoRoot, vue3DemoRoot, reactDemoRoot]) {
    const pkg = require(path.join(demo, 'package.json'))
    assert.ok(pkg.scripts.collect, `${path.basename(demo)} missing collect`)
    assert.ok(pkg.scripts.review, `${path.basename(demo)} missing review`)
    assert.ok(pkg.scripts.check, `${path.basename(demo)} missing check`)
  }

  const before = {
    demo: snapshotDemoTree(demoRoot),
    vue3: snapshotDemoTree(vue3DemoRoot),
    react: snapshotDemoTree(reactDemoRoot)
  }
  const verified = spawnSync(
    process.execPath,
    [path.join(workspaceRoot, 'scripts/verify-hybrid-localization.js'), SKIP_PACKAGE_TESTS_FLAG],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      timeout: 600000
    }
  )
  assert.strictEqual(verified.status, 0, verified.stderr || verified.stdout)
  assertDemoUnchanged(demoRoot, before.demo)
  assertDemoUnchanged(vue3DemoRoot, before.vue3)
  assertDemoUnchanged(reactDemoRoot, before.react)
})
