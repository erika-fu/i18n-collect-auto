const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { dynamicCandidateId } = require('../mycommon/complete-static-copy-policy')
const { analysisReport, analyzeProject, analyzeSnapshots, buildSourceCatalog } = require('../mycommon/project-analysis')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function writeProject(root, files) {
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
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

test('analyzeProject marks the one matching candidate intentionally ignored', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-ignore-'))
  const expression = '`你好${name}世界`'
  const entry = decisionEntry({
    projectPath: 'src/greet.js',
    expression,
    candidateReason: 'interpolation',
    decision: 'ignore',
    reason: 'greeting stays in source'
  })
  writeProject(root, {
    'src/greet.js': `const message = ${expression}\n`,
    'lang/catalog/dynamic-message-decisions.json': `${JSON.stringify({
      version: 1,
      decisions: [entry]
    }, null, 2)}\n`
  })

  const analysis = analyzeProject({
    files: [{ path: 'src/greet.js', source: `const message = ${expression}\n` }],
    config: { root, catalogDir: 'lang/catalog' }
  })

  assert.strictEqual(analysis.dynamicMessageCandidates.length, 1)
  const candidate = analysis.dynamicMessageCandidates[0]
  assert.strictEqual(candidate.id, entry.id)
  assert.strictEqual(candidate.disposition, 'intentionally-ignored')
  assert.strictEqual(candidate.ignoreReason, 'greeting stays in source')
  assert.strictEqual(analysis.coverage.dynamicMessageCandidates.intentionallyIgnored, 1)
  assert.strictEqual(analysis.coverage.dynamicMessageCandidates.needsReview, 0)
})

test('analyzeProject keeps a translate decision approved until the source is migrated', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-translate-'))
  const expression = "'已选择 ' + count + ' 个文件'"
  const entry = decisionEntry({
    projectPath: 'src/upload.js',
    expression,
    candidateReason: 'concatenation',
    decision: 'translate',
    key: 'upload.selectedFiles'
  })
  writeProject(root, {
    'src/upload.js': `const label = ${expression}\n`,
    'lang/catalog/dynamic-message-decisions.json': `${JSON.stringify({
      version: 1,
      decisions: [entry]
    }, null, 2)}\n`,
    'lang/catalog/explicit-messages.json': `${JSON.stringify({
      version: 1,
      messages: [{ key: 'upload.selectedFiles', source: '已选择 {count} 个文件' }]
    }, null, 2)}\n`
  })

  const analysis = analyzeProject({
    files: [{ path: 'src/upload.js', source: `const label = ${expression}\n` }],
    config: { root, catalogDir: 'lang/catalog' }
  })

  assert.strictEqual(analysis.dynamicMessageCandidates.length, 1)
  const candidate = analysis.dynamicMessageCandidates[0]
  assert.strictEqual(candidate.id, entry.id)
  assert.strictEqual(candidate.disposition, 'translation-approved')
  assert.strictEqual(candidate.key, 'upload.selectedFiles')
  assert.strictEqual(analysis.coverage.dynamicMessageCandidates.needsReview, 0)
  assert.strictEqual(analysis.coverage.dynamicMessageCandidates.intentionallyIgnored, 0)
  assert.strictEqual(analysis.coverage.dynamicMessageCandidates.translationApproved, 1)
  assert.deepStrictEqual(buildSourceCatalog(analysis), { version: 1, messages: {} })
})

test('each dynamic candidate occurrence keeps its own decision', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-each-'))
  const ignoredExpression = '`你好${name}世界`'
  const approvedExpression = "'已选择 ' + count + ' 个文件'"
  const deferredSource = 'const later = ready ? "稍后处理" : "继续等待"\n'
  const source = [
    `const message = ${ignoredExpression}`,
    `const label = ${approvedExpression}`,
    deferredSource.trimEnd()
  ].join('\n') + '\n'
  const ignored = decisionEntry({
    projectPath: 'src/mixed.js',
    expression: ignoredExpression,
    candidateReason: 'interpolation',
    decision: 'ignore',
    reason: 'greeting stays in source'
  })
  const approved = decisionEntry({
    projectPath: 'src/mixed.js',
    expression: approvedExpression,
    candidateReason: 'concatenation',
    decision: 'translate',
    key: 'upload.selectedFiles'
  })
  writeProject(root, {
    'src/mixed.js': source,
    'lang/catalog/dynamic-message-decisions.json': `${JSON.stringify({
      version: 1,
      decisions: [ignored, approved]
    }, null, 2)}\n`,
    'lang/catalog/explicit-messages.json': `${JSON.stringify({
      version: 1,
      messages: [{ key: 'upload.selectedFiles', source: '已选择 {count} 个文件' }]
    }, null, 2)}\n`
  })

  const analysis = analyzeProject({
    files: [{ path: 'src/mixed.js', source }],
    config: { root, catalogDir: 'lang/catalog' }
  })
  const byId = new Map(analysis.dynamicMessageCandidates.map(item => [item.id, item]))
  assert.strictEqual(byId.get(ignored.id).disposition, 'intentionally-ignored')
  assert.strictEqual(byId.get(ignored.id).ignoreReason, 'greeting stays in source')
  assert.strictEqual(byId.get(approved.id).disposition, 'translation-approved')
  assert.strictEqual(byId.get(approved.id).key, 'upload.selectedFiles')
  const unreviewed = analysis.dynamicMessageCandidates.find(item => item.expression.includes('稍后处理'))
  assert.ok(unreviewed)
  assert.notStrictEqual(unreviewed.id, ignored.id)
  assert.notStrictEqual(unreviewed.id, approved.id)
  assert.strictEqual(unreviewed.disposition, 'needs-review')
  assert.strictEqual(unreviewed.ignoreReason, undefined)
  assert.strictEqual(unreviewed.key, undefined)
})

test('a formatting-only source change still matches the recorded decision', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-format-'))
  const recorded = '`你好${name}世界`'
  const formatted = '`你好${ name }世界`'
  const entry = decisionEntry({
    projectPath: 'src/greet.js',
    expression: recorded,
    candidateReason: 'interpolation',
    decision: 'ignore',
    reason: 'greeting stays in source'
  })
  const source = `const message = ${formatted}\n`
  writeProject(root, {
    'src/greet.js': source,
    'lang/catalog/dynamic-message-decisions.json': `${JSON.stringify({
      version: 1,
      decisions: [entry]
    }, null, 2)}\n`
  })

  const analysis = analyzeProject({
    files: [{ path: 'src/greet.js', source }],
    config: { root, catalogDir: 'lang/catalog' }
  })
  assert.strictEqual(analysis.dynamicMessageCandidates.length, 1)
  assert.strictEqual(analysis.dynamicMessageCandidates[0].id, entry.id)
  assert.strictEqual(analysis.dynamicMessageCandidates[0].disposition, 'intentionally-ignored')
})

test('a semantic source change makes an active decision unverifiable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-changed-'))
  const recorded = '`你好${name}世界`'
  const changed = '`你好${name}宇宙`'
  const entry = decisionEntry({
    projectPath: 'src/greet.js',
    expression: recorded,
    candidateReason: 'interpolation',
    decision: 'ignore',
    reason: 'greeting stays in source'
  })
  const source = `const message = ${changed}\n`
  writeProject(root, {
    'src/greet.js': source,
    'lang/catalog/dynamic-message-decisions.json': `${JSON.stringify({
      version: 1,
      decisions: [entry]
    }, null, 2)}\n`
  })

  assert.throws(
    () => analyzeProject({
      files: [{ path: 'src/greet.js', source }],
      config: { root, catalogDir: 'lang/catalog' }
    }),
    error => error.kind === 'collection' && /does not match a current candidate/.test(error.message)
  )
})

test('removing a candidate makes an active ignore or translate decision unverifiable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-removed-'))
  const expression = "'已选择 ' + count + ' 个文件'"
  const entry = decisionEntry({
    projectPath: 'src/upload.js',
    expression,
    candidateReason: 'concatenation',
    decision: 'translate',
    key: 'upload.selectedFiles'
  })
  const source = 'const label = "已选择"\n'
  writeProject(root, {
    'src/upload.js': source,
    'lang/catalog/dynamic-message-decisions.json': `${JSON.stringify({
      version: 1,
      decisions: [entry]
    }, null, 2)}\n`,
    'lang/catalog/explicit-messages.json': `${JSON.stringify({
      version: 1,
      messages: [{ key: 'upload.selectedFiles', source: '已选择 {count} 个文件' }]
    }, null, 2)}\n`
  })

  assert.throws(
    () => analyzeProject({
      files: [{ path: 'src/upload.js', source }],
      config: { root, catalogDir: 'lang/catalog' }
    }),
    error => error.kind === 'collection' && /does not match a current candidate/.test(error.message)
  )
})

test('each copy of the same expression keeps its own review identity and decision', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-copies-'))
  const expression = "'已选择 ' + count + ' 个文件'"
  const first = decisionEntry({
    projectPath: 'src/upload.js',
    expression,
    candidateReason: 'concatenation',
    decision: 'ignore',
    reason: 'first copy stays'
  })
  const second = decisionEntry({
    projectPath: 'src/upload.js',
    expression,
    candidateReason: 'concatenation',
    decision: 'translate',
    key: 'upload.selectedFiles',
    occurrence: 1
  })
  const source = `const first = ${expression}\nconst second = ${expression}\n`
  writeProject(root, {
    'src/upload.js': source,
    'lang/catalog/dynamic-message-decisions.json': `${JSON.stringify({
      version: 1,
      decisions: [first, second]
    }, null, 2)}\n`,
    'lang/catalog/explicit-messages.json': `${JSON.stringify({
      version: 1,
      messages: [{ key: 'upload.selectedFiles', source: '已选择 {count} 个文件' }]
    }, null, 2)}\n`
  })

  const analysis = analyzeProject({
    files: [{ path: 'src/upload.js', source }],
    config: { root, catalogDir: 'lang/catalog' }
  })
  assert.notStrictEqual(first.id, second.id)
  const byId = new Map(analysis.dynamicMessageCandidates.map(item => [item.id, item]))
  assert.strictEqual(byId.get(first.id).disposition, 'intentionally-ignored')
  assert.strictEqual(byId.get(first.id).ignoreReason, 'first copy stays')
  assert.strictEqual(byId.get(second.id).disposition, 'translation-approved')
  assert.strictEqual(byId.get(second.id).key, 'upload.selectedFiles')
})

test('a duplicated decision id is an ambiguous match', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-duplicate-'))
  const expression = "'已选择 ' + count + ' 个文件'"
  const entry = decisionEntry({
    projectPath: 'src/upload.js',
    expression,
    candidateReason: 'concatenation',
    decision: 'ignore',
    reason: 'duplicate decision'
  })
  const source = `const label = ${expression}\n`
  writeProject(root, {
    'src/upload.js': source,
    'lang/catalog/dynamic-message-decisions.json': `${JSON.stringify({
      version: 1,
      decisions: [entry, { ...entry }]
    }, null, 2)}\n`
  })

  assert.throws(
    () => analyzeProject({
      files: [{ path: 'src/upload.js', source }],
      config: { root, catalogDir: 'lang/catalog' }
    }),
    error => error.kind === 'collection' && /is duplicated/.test(error.message)
  )
})

test('a completed migration keeps a verifiable migrated decision instead of failing as stale', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-migrated-'))
  const expression = "'已选择 ' + count + ' 个文件'"
  const entry = decisionEntry({
    projectPath: 'src/upload.js',
    expression,
    candidateReason: 'concatenation',
    decision: 'migrated',
    key: 'upload.selectedFiles'
  })
  const source = "const label = t('upload.selectedFiles', { count })\n"
  writeProject(root, {
    'src/upload.js': source,
    'lang/catalog/dynamic-message-decisions.json': `${JSON.stringify({
      version: 1,
      decisions: [entry]
    }, null, 2)}\n`,
    'lang/catalog/explicit-messages.json': `${JSON.stringify({
      version: 1,
      messages: [{ key: 'upload.selectedFiles', source: '已选择 {count} 个文件' }]
    }, null, 2)}\n`
  })

  const analysis = analyzeProject({
    files: [{ path: 'src/upload.js', source }],
    config: { root, catalogDir: 'lang/catalog' }
  })

  assert.ok(!analysis.dynamicMessageCandidates.some(item => item.id === entry.id))
  assert.ok(analysis.localizedCallFindings.some(item => (
    item.key === 'upload.selectedFiles' && item.location.path === 'src/upload.js'
  )))
  assert.deepStrictEqual(analysis.migratedDynamicDecisions, [{
    id: entry.id,
    path: 'src/upload.js',
    expression,
    key: 'upload.selectedFiles',
    disposition: 'migrated'
  }])
  assert.deepStrictEqual(analysisReport(analysis).migratedDynamicDecisions, analysis.migratedDynamicDecisions)
  assert.strictEqual(analysis.coverage.dynamicMessageCandidates.migrated, 1)
  assert.strictEqual(analysis.coverage.dynamicMessageCandidates.total, 0)
  assert.deepStrictEqual(buildSourceCatalog(analysis), {
    version: 1,
    messages: { 'upload.selectedFiles': '已选择 {count} 个文件' }
  })
})

test('a defer decision keeps the candidate unreviewed and records why it was deferred', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-defer-'))
  const expression = '`你好${name}世界`'
  const entry = decisionEntry({
    projectPath: 'src/greet.js',
    expression,
    candidateReason: 'interpolation',
    decision: 'defer',
    reason: 'waiting on copy'
  })
  const source = `const message = ${expression}\n`
  writeProject(root, {
    'src/greet.js': source,
    'lang/catalog/dynamic-message-decisions.json': `${JSON.stringify({
      version: 1,
      decisions: [entry]
    }, null, 2)}\n`
  })

  const analysis = analyzeProject({
    files: [{ path: 'src/greet.js', source }],
    config: { root, catalogDir: 'lang/catalog' }
  })
  assert.strictEqual(analysis.dynamicMessageCandidates.length, 1)
  const candidate = analysis.dynamicMessageCandidates[0]
  assert.strictEqual(candidate.id, entry.id)
  assert.strictEqual(candidate.disposition, 'needs-review')
  assert.strictEqual(candidate.decision, 'defer')
  assert.strictEqual(candidate.deferReason, 'waiting on copy')
  assert.strictEqual(analysis.coverage.dynamicMessageCandidates.needsReview, 1)
})

test('an unfinished or unverifiable migration is not a migrated terminal decision', () => {
  const expression = "'已选择 ' + count + ' 个文件'"
  const entry = decisionEntry({
    projectPath: 'src/upload.js',
    expression,
    candidateReason: 'concatenation',
    decision: 'migrated',
    key: 'upload.selectedFiles'
  })
  const manifest = {
    'lang/catalog/dynamic-message-decisions.json': `${JSON.stringify({
      version: 1,
      decisions: [entry]
    }, null, 2)}\n`,
    'lang/catalog/explicit-messages.json': `${JSON.stringify({
      version: 1,
      messages: [{ key: 'upload.selectedFiles', source: '已选择 {count} 个文件' }]
    }, null, 2)}\n`
  }

  const stillDynamic = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-migrated-live-'))
  const dynamicSource = `const label = ${expression}\n`
  writeProject(stillDynamic, { 'src/upload.js': dynamicSource, ...manifest })
  assert.throws(
    () => analyzeProject({
      files: [{ path: 'src/upload.js', source: dynamicSource }],
      config: { root: stillDynamic, catalogDir: 'lang/catalog' }
    }),
    error => error.kind === 'collection' && /still matches a dynamic candidate/.test(error.message)
  )

  const missingCall = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-migrated-call-'))
  const staticSource = 'const label = "你好"\n'
  writeProject(missingCall, { 'src/upload.js': staticSource, ...manifest })
  assert.throws(
    () => analyzeProject({
      files: [{ path: 'src/upload.js', source: staticSource }],
      config: { root: missingCall, catalogDir: 'lang/catalog' }
    }),
    error => error.kind === 'collection' && /is not called from src\/upload\.js/.test(error.message)
  )

  const unrelated = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-migrated-unrelated-'))
  const unrelatedSource = "const label = t('upload.selectedFiles', { count })\n"
  writeProject(unrelated, {
    'src/upload.js': unrelatedSource,
    'lang/catalog/dynamic-message-decisions.json': manifest['lang/catalog/dynamic-message-decisions.json'],
    'lang/catalog/explicit-messages.json': `${JSON.stringify({
      version: 1,
      messages: [{ key: 'upload.selectedFiles', source: '其他 {count} 文本' }]
    }, null, 2)}\n`
  })
  assert.throws(
    () => analyzeProject({
      files: [{ path: 'src/upload.js', source: unrelatedSource }],
      config: { root: unrelated, catalogDir: 'lang/catalog' }
    }),
    error => error.kind === 'collection' && /does not preserve the recorded expression/.test(error.message)
  )

  const repeated = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-migrated-repeated-'))
  const repeatedSource = [
    "const first = t('upload.selectedFiles', { count })",
    "const second = t('upload.selectedFiles', { count })",
    ''
  ].join('\n')
  writeProject(repeated, {
    'src/upload.js': repeatedSource,
    ...manifest
  })
  assert.throws(
    () => analyzeProject({
      files: [{ path: 'src/upload.js', source: repeatedSource }],
      config: { root: repeated, catalogDir: 'lang/catalog' }
    }),
    error => error.kind === 'collection' && /called 2 times/.test(error.message)
  )
})

test('analyzeSnapshots and analyzeProject regenerate the same decision dispositions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-parity-'))
  const expression = '`你好${name}世界`'
  const entry = decisionEntry({
    projectPath: 'src/greet.js',
    expression,
    candidateReason: 'interpolation',
    decision: 'ignore',
    reason: 'greeting stays in source'
  })
  const source = `const message = ${expression}\nconst plain = "完整静态"\n`
  writeProject(root, {
    'src/greet.js': source,
    'lang/catalog/dynamic-message-decisions.json': `${JSON.stringify({
      version: 1,
      decisions: [entry]
    }, null, 2)}\n`
  })
  const files = [{ path: 'src/greet.js', absolutePath: path.join(root, 'src/greet.js'), source }]
  const config = { root, catalogDir: 'lang/catalog' }
  const fromProject = analyzeProject({ files, config })
  const fromSnapshots = analyzeSnapshots([{
    identity: 'src/greet.js::script',
    projectPath: 'src/greet.js',
    entries: [{
      value: '完整静态',
      locations: [{
        path: 'src/greet.js',
        kind: 'script-string',
        start: { line: 2, column: 14 },
        end: { line: 2, column: 20 }
      }]
    }]
  }], config, { files })

  assert.strictEqual(fromSnapshots.dynamicMessageCandidates.length, fromProject.dynamicMessageCandidates.length)
  assert.deepStrictEqual(
    fromSnapshots.dynamicMessageCandidates.map(item => [item.id, item.disposition, item.ignoreReason]),
    fromProject.dynamicMessageCandidates.map(item => [item.id, item.disposition, item.ignoreReason])
  )
  assert.deepStrictEqual(fromSnapshots.migratedDynamicDecisions, fromProject.migratedDynamicDecisions)
})

function writeWorkflowProject(root, { source, decisions, explicitMessages, webpack = false }) {
  writeProject(root, {
    'src/app.js': source,
    'i18n-collect.config.js': 'module.exports = { include: ["src"] }\n',
    'lang/catalog/dynamic-message-decisions.json': `${JSON.stringify({
      version: 1,
      decisions
    }, null, 2)}\n`,
    ...(explicitMessages ? {
      'lang/catalog/explicit-messages.json': `${JSON.stringify({
        version: 1,
        messages: explicitMessages
      }, null, 2)}\n`
    } : {})
  })
  if (!webpack) return
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
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

test('scan publishes matched and unreviewed dispositions in one report', () => {
  const ignoredExpression = '`你好${name}世界`'
  const pendingExpression = "'已选择 ' + count + ' 个文件'"
  const ignored = decisionEntry({
    projectPath: 'src/app.js',
    expression: ignoredExpression,
    candidateReason: 'interpolation',
    decision: 'ignore',
    reason: 'greeting stays in source'
  })
  const source = [
    `const message = ${ignoredExpression}`,
    `const label = ${pendingExpression}`,
    'module.exports = { message, label }',
    ''
  ].join('\n')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-scan-mixed-'))
  writeWorkflowProject(root, { source, decisions: [ignored] })

  const scanned = run(['scan', '--json'], root)
  assert.strictEqual(scanned.status, 0, scanned.stderr)
  const analysis = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json'), 'utf8'))
  const byId = new Map(analysis.dynamicMessageCandidates.map(item => [item.id, item]))
  assert.strictEqual(byId.get(ignored.id).disposition, 'intentionally-ignored')
  const unreviewed = analysis.dynamicMessageCandidates.find(item => item.id !== ignored.id)
  assert.ok(unreviewed)
  assert.strictEqual(unreviewed.disposition, 'needs-review')
})

test('scan and collect publish the same matching decision disposition', { timeout: 60000 }, () => {
  const expression = '`你好${name}世界`'
  const entry = decisionEntry({
    projectPath: 'src/app.js',
    expression,
    candidateReason: 'interpolation',
    decision: 'ignore',
    reason: 'greeting stays in source'
  })
  const source = `const message = ${expression}\nmodule.exports = message\n`
  const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-scan-'))
  const collectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-collect-'))
  writeWorkflowProject(scanRoot, { source, decisions: [entry] })
  writeWorkflowProject(collectRoot, { source, decisions: [entry], webpack: true })

  const scanned = run(['scan', '--json'], scanRoot)
  assert.strictEqual(scanned.status, 0, scanned.stderr)
  const collected = run(['collect', '--json'], collectRoot)
  assert.strictEqual(collected.status, 0, collected.stderr)

  const scanAnalysis = JSON.parse(fs.readFileSync(path.join(scanRoot, 'lang/catalog/analysis-report.json'), 'utf8'))
  const collectAnalysis = JSON.parse(fs.readFileSync(path.join(collectRoot, 'lang/catalog/analysis-report.json'), 'utf8'))
  assert.deepStrictEqual(
    scanAnalysis.dynamicMessageCandidates.map(item => [item.id, item.disposition, item.ignoreReason]),
    [[entry.id, 'intentionally-ignored', 'greeting stays in source']]
  )
  assert.deepStrictEqual(
    collectAnalysis.dynamicMessageCandidates.map(item => [item.id, item.disposition, item.ignoreReason]),
    scanAnalysis.dynamicMessageCandidates.map(item => [item.id, item.disposition, item.ignoreReason])
  )
})

test('scan and collect publish translation-approved and migrated decision states', { timeout: 60000 }, () => {
  const pendingExpression = "'已选择 ' + count + ' 个文件'"
  const migratedExpression = '`你好${name}世界`'
  const pending = decisionEntry({
    projectPath: 'src/app.js',
    expression: pendingExpression,
    candidateReason: 'concatenation',
    decision: 'translate',
    key: 'upload.selectedFiles'
  })
  const migrated = decisionEntry({
    projectPath: 'src/app.js',
    expression: migratedExpression,
    candidateReason: 'interpolation',
    decision: 'migrated',
    key: 'greet.hello'
  })
  const source = [
    `const label = ${pendingExpression}`,
    "const hello = t('greet.hello', { name })",
    'module.exports = { label, hello }',
    ''
  ].join('\n')
  const explicitMessages = [
    { key: 'upload.selectedFiles', source: '已选择 {count} 个文件' },
    { key: 'greet.hello', source: '你好{name}世界' }
  ]
  const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-scan-states-'))
  const collectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-collect-states-'))
  writeWorkflowProject(scanRoot, { source, decisions: [pending, migrated], explicitMessages })
  writeWorkflowProject(collectRoot, { source, decisions: [pending, migrated], explicitMessages, webpack: true })

  const scanned = run(['scan', '--json'], scanRoot)
  assert.strictEqual(scanned.status, 0, scanned.stderr)
  const collected = run(['collect', '--json'], collectRoot)
  assert.strictEqual(collected.status, 0, collected.stderr)

  const expectedCandidates = [[pending.id, 'translation-approved', 'upload.selectedFiles']]
  const expectedMigrated = [{
    id: migrated.id,
    path: 'src/app.js',
    expression: migratedExpression,
    key: 'greet.hello',
    disposition: 'migrated'
  }]
  for (const root of [scanRoot, collectRoot]) {
    const analysis = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json'), 'utf8'))
    assert.deepStrictEqual(
      analysis.dynamicMessageCandidates.map(item => [item.id, item.disposition, item.key]),
      expectedCandidates
    )
    assert.deepStrictEqual(analysis.migratedDynamicDecisions, expectedMigrated)
  }
})

test('a failed decision round preserves the previous formal outputs', { timeout: 60000 }, () => {
  const expression = '`你好${name}世界`'
  const entry = decisionEntry({
    projectPath: 'src/app.js',
    expression,
    candidateReason: 'interpolation',
    decision: 'ignore',
    reason: 'greeting stays in source'
  })
  const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-scan-atomic-'))
  writeWorkflowProject(scanRoot, {
    source: 'const message = "你好"\nmodule.exports = message\n',
    decisions: []
  })
  const scanned = run(['scan', '--json'], scanRoot)
  assert.strictEqual(scanned.status, 0, scanned.stderr)
  const scanCatalog = fs.readFileSync(path.join(scanRoot, 'lang/catalog/source-catalog.json'))
  const scanReport = fs.readFileSync(path.join(scanRoot, 'lang/catalog/analysis-report.json'))
  writeWorkflowProject(scanRoot, {
    source: `const message = ${expression}\nmodule.exports = message\n`,
    decisions: [{ ...entry, expression: '`你好${name}宇宙`' }]
  })
  const scanFailed = run(['scan', '--json'], scanRoot)
  assert.notStrictEqual(scanFailed.status, 0, scanFailed.stdout)
  assert.match(scanFailed.stderr, /does not match a current candidate|does not match its recorded candidate/)
  assert.deepStrictEqual(fs.readFileSync(path.join(scanRoot, 'lang/catalog/source-catalog.json')), scanCatalog)
  assert.deepStrictEqual(fs.readFileSync(path.join(scanRoot, 'lang/catalog/analysis-report.json')), scanReport)

  const collectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dynamic-decision-collect-atomic-'))
  writeWorkflowProject(collectRoot, {
    source: 'const message = "你好"\nmodule.exports = message\n',
    decisions: [],
    webpack: true
  })
  const collected = run(['collect', '--json'], collectRoot)
  assert.strictEqual(collected.status, 0, collected.stderr)
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
  assert.deepStrictEqual(fs.readFileSync(path.join(collectRoot, 'lang/catalog/source-catalog.json')), collectCatalog)
  assert.deepStrictEqual(fs.readFileSync(path.join(collectRoot, 'lang/catalog/analysis-report.json')), collectReport)
  assert.deepStrictEqual(fs.readFileSync(path.join(collectRoot, 'lang/zh_hash.json')), collectDictionary)
})
