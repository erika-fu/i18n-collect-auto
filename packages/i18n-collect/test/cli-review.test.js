const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { dynamicCandidateId } = require('../mycommon/complete-static-copy-policy')
const { review } = require('../cli/review')

const bin = path.join(__dirname, '../bin/i18n-collect.js')

function run(args, cwd, env = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', CI: '1', ...env }
  })
}

function writeReviewProject(root, { source = 'const message = `你好${name}世界`\n', files = {} } = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = { include: ["src"] }\n')
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
}

test('review help describes dynamic candidate decisions and prune', () => {
  const result = run(['review', '--help'])
  assert.strictEqual(result.status, 0, result.stderr)
  assert.match(result.stdout, /i18n-collect review/)
  assert.match(result.stdout, /--status/)
  assert.match(result.stdout, /--translate|--ignore|--defer/)
  assert.match(result.stdout, /--prune/)
  assert.match(result.stdout, /--yes/)
  assert.match(result.stdout, /explicit-messages|dynamic-message-decisions/)
})

test('review lists unresolved needs-review candidates without writing files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-review-list-'))
  writeReviewProject(root)
  const before = fs.existsSync(path.join(root, 'lang/catalog/dynamic-message-decisions.json'))

  const result = run(['review', '--status', 'needs-review', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.command, 'review')
  assert.strictEqual(report.candidates.length, 1)
  assert.strictEqual(report.candidates[0].disposition, 'needs-review')
  assert.strictEqual(report.candidates[0].expression, '`你好${name}世界`')
  assert.match(report.candidates[0].id, /^dynamic\.[0-9a-f]{6}$/)
  assert.strictEqual(
    fs.existsSync(path.join(root, 'lang/catalog/dynamic-message-decisions.json')),
    before
  )
})

test('interactive review of one candidate records the chosen decision after confirmation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-review-interactive-'))
  writeReviewProject(root)
  const listed = run(['review', '--json'], root)
  assert.strictEqual(listed.status, 0, listed.stderr)
  const id = JSON.parse(listed.stdout).candidates[0].id
  const answers = ['ignore', 'China-only legal notice', 'yes']
  const questions = []

  const result = await review([id, '--cwd', root], {
    interactive: true,
    ask: async question => {
      questions.push(question)
      return answers.shift()
    }
  })
  assert.strictEqual(result.code, 0, result.stderr)
  assert.match(questions[0], /Choose \[t\]ranslate/)
  const decisions = readJson(root, 'lang/catalog/dynamic-message-decisions.json')
  assert.strictEqual(decisions.decisions[0].id, id)
  assert.strictEqual(decisions.decisions[0].decision, 'ignore')
  assert.strictEqual(decisions.decisions[0].reason, 'China-only legal notice')
})

test('review records an ignore decision non-interactively with --yes and a non-empty reason', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-review-ignore-'))
  writeReviewProject(root)
  const listed = run(['review', '--status', 'needs-review', '--json'], root)
  assert.strictEqual(listed.status, 0, listed.stderr)
  const id = JSON.parse(listed.stdout).candidates[0].id

  const result = run([
    'review', id,
    '--ignore',
    '--reason', 'China-only legal notice',
    '--yes',
    '--json'
  ], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.action, 'ignore')
  assert.deepStrictEqual(report.recorded, [id])

  const decisions = readJson(root, 'lang/catalog/dynamic-message-decisions.json')
  assert.strictEqual(decisions.version, 1)
  assert.strictEqual(decisions.decisions.length, 1)
  assert.strictEqual(decisions.decisions[0].id, id)
  assert.strictEqual(decisions.decisions[0].decision, 'ignore')
  assert.strictEqual(decisions.decisions[0].reason, 'China-only legal notice')
  assert.strictEqual(decisions.decisions[0].candidateReason, 'interpolation')

  const after = run(['review', '--status', 'needs-review', '--json'], root)
  assert.strictEqual(after.status, 0, after.stderr)
  assert.strictEqual(JSON.parse(after.stdout).candidates.length, 0)
})

test('review refuses ignore without confirmation or without a non-empty reason', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-review-ignore-guard-'))
  writeReviewProject(root)
  const listed = run(['review', '--json'], root)
  const id = JSON.parse(listed.stdout).candidates[0].id

  const unconfirmed = run(['review', id, '--ignore', '--reason', 'blocked', '--json'], root)
  assert.notStrictEqual(unconfirmed.status, 0)
  assert.match(unconfirmed.stderr, /not confirmed|--yes/)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/dynamic-message-decisions.json')))

  const emptyReason = run([
    'review', id, '--ignore', '--reason', '   ', '--yes', '--json'
  ], root)
  assert.notStrictEqual(emptyReason.status, 0)
  assert.match(emptyReason.stderr, /non-empty|--reason|reason/)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/dynamic-message-decisions.json')))
})

test('review records a defer decision with an optional reason', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-review-defer-'))
  writeReviewProject(root)
  const listed = run(['review', '--json'], root)
  const id = JSON.parse(listed.stdout).candidates[0].id

  const result = run([
    'review', id,
    '--defer',
    '--reason', 'wait for product copy',
    '--yes',
    '--json'
  ], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.action, 'defer')
  assert.deepStrictEqual(report.recorded, [id])

  const decisions = readJson(root, 'lang/catalog/dynamic-message-decisions.json')
  assert.strictEqual(decisions.decisions[0].decision, 'defer')
  assert.strictEqual(decisions.decisions[0].reason, 'wait for product copy')

  const after = run(['review', '--status', 'needs-review', '--json'], root)
  assert.strictEqual(after.status, 0, after.stderr)
  const remaining = JSON.parse(after.stdout).candidates
  assert.strictEqual(remaining.length, 1)
  assert.strictEqual(remaining[0].id, id)
  assert.strictEqual(remaining[0].disposition, 'needs-review')
})

test('review translate atomically writes matching decision and explicit-message manifests', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-review-translate-'))
  writeReviewProject(root, {
    source: "const label = '已选择 ' + count + ' 个文件'\n"
  })
  const listed = run(['review', '--json'], root)
  assert.strictEqual(listed.status, 0, listed.stderr)
  const id = JSON.parse(listed.stdout).candidates[0].id

  const result = run([
    'review', id,
    '--translate',
    '--key', 'upload.selectedFiles',
    '--source', '已选择 {count} 个文件',
    '--yes',
    '--json'
  ], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.action, 'translate')
  assert.deepStrictEqual(report.recorded, [id])

  const decisions = readJson(root, 'lang/catalog/dynamic-message-decisions.json')
  assert.strictEqual(decisions.decisions[0].decision, 'translate')
  assert.strictEqual(decisions.decisions[0].key, 'upload.selectedFiles')

  const explicit = readJson(root, 'lang/catalog/explicit-messages.json')
  assert.deepStrictEqual(explicit.messages, [
    { key: 'upload.selectedFiles', source: '已选择 {count} 个文件' }
  ])

  const after = run(['review', '--status', 'translation-approved', '--json'], root)
  assert.strictEqual(after.status, 0, after.stderr)
  const approved = JSON.parse(after.stdout).candidates
  assert.strictEqual(approved.length, 1)
  assert.strictEqual(approved[0].id, id)
  assert.strictEqual(approved[0].disposition, 'translation-approved')
})

test('review translate validation failure leaves neither manifest partially changed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-review-translate-fail-'))
  writeReviewProject(root, {
    source: [
      "const label = '已选择 ' + count + ' 个文件'",
      "const existing = t('upload.selectedFiles', { count })",
      ''
    ].join('\n'),
    files: {
      'lang/catalog/explicit-messages.json': `${JSON.stringify({
        version: 1,
        messages: [{ key: 'upload.selectedFiles', source: '已有不同文案 {count}' }]
      }, null, 2)}\n`
    }
  })
  const listed = run(['review', '--json'], root)
  assert.strictEqual(listed.status, 0, listed.stderr)
  const id = JSON.parse(listed.stdout).candidates[0].id
  const beforeExplicit = fs.readFileSync(path.join(root, 'lang/catalog/explicit-messages.json'), 'utf8')

  const result = run([
    'review', id,
    '--translate',
    '--key', 'upload.selectedFiles',
    '--source', '已选择 {count} 个文件',
    '--yes',
    '--json'
  ], root)
  assert.notStrictEqual(result.status, 0)
  assert.match(result.stderr, /different source|already declares/)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/dynamic-message-decisions.json')))
  assert.strictEqual(
    fs.readFileSync(path.join(root, 'lang/catalog/explicit-messages.json'), 'utf8'),
    beforeExplicit
  )
})
test('review --bulk records a separate decision for every compatible occurrence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-review-bulk-'))
  writeReviewProject(root, {
    source: [
      "const first = '已选择 ' + count + ' 个文件'",
      "const second = '已选择 ' + count + ' 个文件'",
      "const other = `你好${name}世界`",
      ''
    ].join('\n')
  })
  const listed = run(['review', '--json'], root)
  assert.strictEqual(listed.status, 0, listed.stderr)
  const candidates = JSON.parse(listed.stdout).candidates
  assert.strictEqual(candidates.length, 3)
  const primary = candidates.find(item => item.expression.includes('已选择'))
  assert.ok(primary)

  const result = run([
    'review', primary.id,
    '--bulk',
    '--translate',
    '--key', 'upload.selectedFiles',
    '--source', '已选择 {count} 个文件',
    '--yes',
    '--json'
  ], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.recorded.length, 2)
  assert.ok(report.recorded.every(id => id.startsWith('dynamic.')))

  const decisions = readJson(root, 'lang/catalog/dynamic-message-decisions.json')
  assert.strictEqual(decisions.decisions.length, 2)
  assert.ok(decisions.decisions.every(item => item.decision === 'translate'))
  assert.ok(decisions.decisions.every(item => item.key === 'upload.selectedFiles'))
  assert.notStrictEqual(decisions.decisions[0].id, decisions.decisions[1].id)
  assert.ok(decisions.decisions.some(item => item.occurrence === 1))

  const remaining = run(['review', '--json'], root)
  assert.strictEqual(JSON.parse(remaining.stdout).candidates.length, 1)
  assert.match(JSON.parse(remaining.stdout).candidates[0].expression, /你好/)
})

test('review --prune removes migrated terminal decisions and never discards active ones', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-review-prune-'))
  const migratedExpression = "'已选择 ' + count + ' 个文件'"
  const migratedId = dynamicCandidateId({
    path: 'src/app.js',
    expression: migratedExpression,
    reason: 'concatenation'
  })
  writeReviewProject(root, {
    source: [
      "const active = `你好${name}世界`",
      "const migrated = t('upload.selectedFiles', { count })",
      ''
    ].join('\n'),
    files: {
      'lang/catalog/explicit-messages.json': `${JSON.stringify({
        version: 1,
        messages: [{ key: 'upload.selectedFiles', source: '已选择 {count} 个文件' }]
      }, null, 2)}\n`,
      'lang/catalog/dynamic-message-decisions.json': `${JSON.stringify({
        version: 1,
        decisions: [
          {
            id: migratedId,
            path: 'src/app.js',
            expression: migratedExpression,
            candidateReason: 'concatenation',
            decision: 'migrated',
            key: 'upload.selectedFiles'
          }
        ]
      }, null, 2)}\n`
    }
  })

  const ignoreListed = run(['review', '--json'], root)
  assert.strictEqual(ignoreListed.status, 0, ignoreListed.stderr)
  const activeId = JSON.parse(ignoreListed.stdout).candidates[0].id
  const ignored = run([
    'review', activeId,
    '--ignore',
    '--reason', 'keep for now',
    '--yes',
    '--json'
  ], root)
  assert.strictEqual(ignored.status, 0, ignored.stderr)

  const before = readJson(root, 'lang/catalog/dynamic-message-decisions.json')
  assert.ok(before.decisions.some(item => item.decision === 'migrated'))
  assert.ok(before.decisions.some(item => item.decision === 'ignore'))

  const unconfirmed = run(['review', '--prune', '--json'], root)
  assert.notStrictEqual(unconfirmed.status, 0)
  assert.match(unconfirmed.stderr, /not confirmed|--yes/)

  const result = run(['review', '--prune', '--yes', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.action, 'prune')
  assert.deepStrictEqual(report.pruned, [migratedId])

  const after = readJson(root, 'lang/catalog/dynamic-message-decisions.json')
  assert.strictEqual(after.decisions.length, 1)
  assert.strictEqual(after.decisions[0].decision, 'ignore')
  assert.strictEqual(after.decisions[0].id, activeId)
})
