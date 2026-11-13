const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const {
  planDecisionWrites,
  pruneMigratedDecisions,
  compatibleCandidates,
  withOccurrences,
  writeReviewArtifacts
} = require('../mycommon/dynamic-message-review')

function candidate(overrides = {}) {
  return {
    id: 'dynamic.abcdef',
    expression: "'已选择 ' + count + ' 个文件'",
    staticFragments: ['已选择 ', ' 个文件'],
    location: {
      path: 'src/app.js',
      start: { line: 1, column: 14 },
      end: { line: 1, column: 40 }
    },
    reason: 'concatenation',
    occurrence: 0,
    disposition: 'needs-review',
    ...overrides
  }
}

test('planDecisionWrites translate keeps decision and explicit message mutually consistent', () => {
  const planned = planDecisionWrites({
    candidates: [candidate()],
    existingDecisions: [],
    existingExplicitMessages: [],
    decision: {
      decision: 'translate',
      key: 'upload.selectedFiles',
      source: '已选择 {count} 个文件'
    }
  })
  assert.strictEqual(planned.decisions.length, 1)
  assert.strictEqual(planned.decisions[0].decision, 'translate')
  assert.strictEqual(planned.decisions[0].key, 'upload.selectedFiles')
  assert.deepStrictEqual(planned.explicitMessages, [
    { key: 'upload.selectedFiles', source: '已选择 {count} 个文件' }
  ])
})

test('planDecisionWrites rejects translate source that drops static fragments', () => {
  assert.throws(
    () => planDecisionWrites({
      candidates: [candidate()],
      existingDecisions: [],
      existingExplicitMessages: [],
      decision: {
        decision: 'translate',
        key: 'upload.selectedFiles',
        source: '已选择文件'
      }
    }),
    /static fragments/
  )
})

test('compatibleCandidates groups equal expression fingerprints across occurrences', () => {
  const first = candidate({ id: 'dynamic.111111', occurrence: 0 })
  const second = candidate({ id: 'dynamic.222222', occurrence: 1 })
  const other = candidate({
    id: 'dynamic.333333',
    expression: '`你好${name}世界`',
    staticFragments: ['你好', '世界'],
    reason: 'interpolation'
  })
  const matched = compatibleCandidates(first, [first, second, other])
  assert.deepStrictEqual(matched.map(item => item.id), ['dynamic.111111', 'dynamic.222222'])
})

test('withOccurrences assigns stable occurrence indexes for duplicate fingerprints', () => {
  const annotated = withOccurrences([
    candidate({ id: 'dynamic.111111' }),
    candidate({ id: 'dynamic.222222' }),
    candidate({
      id: 'dynamic.333333',
      expression: '`你好${name}世界`',
      staticFragments: ['你好', '世界'],
      reason: 'interpolation'
    })
  ])
  assert.strictEqual(annotated[0].occurrence, 0)
  assert.strictEqual(annotated[1].occurrence, 1)
  assert.strictEqual(annotated[2].occurrence, 0)
})

test('pruneMigratedDecisions removes only migrated terminals', () => {
  const { decisions, pruned } = pruneMigratedDecisions([
    { id: 'dynamic.aaaaaa', decision: 'migrated', key: 'a' },
    { id: 'dynamic.bbbbbb', decision: 'ignore', reason: 'keep' },
    { id: 'dynamic.cccccc', decision: 'translate', key: 'c' },
    { id: 'dynamic.dddddd', decision: 'defer' }
  ])
  assert.deepStrictEqual(pruned.map(item => item.id), ['dynamic.aaaaaa'])
  assert.deepStrictEqual(decisions.map(item => item.decision), ['ignore', 'translate', 'defer'])
})

test('writeReviewArtifacts commits decision and explicit manifests together or not at all', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-review-atomic-'))
  const decisionsFile = path.join(root, 'dynamic-message-decisions.json')
  const explicitFile = path.join(root, 'explicit-messages.json')
  fs.writeFileSync(decisionsFile, `${JSON.stringify({ version: 1, decisions: [] }, null, 2)}\n`)
  fs.writeFileSync(explicitFile, `${JSON.stringify({
    version: 1,
    messages: [{ key: 'kept.existing', source: '保留文案' }]
  }, null, 2)}\n`)
  const beforeDecisions = fs.readFileSync(decisionsFile, 'utf8')
  const beforeExplicit = fs.readFileSync(explicitFile, 'utf8')

  const realRename = fs.renameSync.bind(fs)
  let renames = 0
  const failingFs = {
    ...fs,
    existsSync: fs.existsSync.bind(fs),
    mkdirSync: fs.mkdirSync.bind(fs),
    readFileSync: fs.readFileSync.bind(fs),
    writeFileSync: fs.writeFileSync.bind(fs),
    unlinkSync: fs.unlinkSync.bind(fs),
    readdirSync: fs.readdirSync.bind(fs),
    renameSync(from, to) {
      renames += 1
      if (renames === 3) {
        const error = new Error('simulated dual-write failure')
        error.kind = 'storage'
        throw error
      }
      return realRename(from, to)
    }
  }

  assert.throws(
    () => writeReviewArtifacts({
      decisionsFile,
      explicitFile,
      decisions: [{
        id: 'dynamic.abcdef',
        path: 'src/app.js',
        expression: "'已选择 ' + count + ' 个文件'",
        candidateReason: 'concatenation',
        decision: 'translate',
        key: 'upload.selectedFiles'
      }],
      explicitMessages: [
        { key: 'kept.existing', source: '保留文案' },
        { key: 'upload.selectedFiles', source: '已选择 {count} 个文件' }
      ],
      writeExplicit: true,
      fsImpl: failingFs
    }),
    /simulated dual-write failure|could not be saved|storage/
  )

  assert.strictEqual(fs.readFileSync(decisionsFile, 'utf8'), beforeDecisions)
  assert.strictEqual(fs.readFileSync(explicitFile, 'utf8'), beforeExplicit)
})
