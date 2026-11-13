const assert = require('assert')
const test = require('node:test')
const {
  evaluateDynamicMessageLifecycle,
  markDecisionMigrated,
  selectReviewCandidates
} = require('../mycommon/dynamic-message-lifecycle')

function candidate(id, overrides = {}) {
  return {
    id,
    expression: "'Selected ' + count + ' files'",
    reason: 'concatenation',
    disposition: 'needs-review',
    location: { path: 'src/app.js' },
    ...overrides
  }
}

test('dynamic message lifecycle owns classification, coverage, occurrences, and review selection', () => {
  const candidates = [
    candidate('dynamic.111111'),
    candidate('dynamic.222222', { decision: 'defer' }),
    candidate('dynamic.333333', {
      disposition: 'intentionally-ignored',
      expression: "'Internal ' + count"
    }),
    candidate('dynamic.444444', {
      disposition: 'translation-approved',
      expression: "'Hello ' + name"
    })
  ]

  const lifecycle = evaluateDynamicMessageLifecycle({
    candidates,
    migrated: [{ id: 'dynamic.555555' }]
  })

  assert.deepStrictEqual(
    lifecycle.candidates.map(item => item.occurrence),
    [0, 1, 0, 0]
  )
  assert.deepStrictEqual(
    Object.fromEntries(
      Object.entries(lifecycle.groups).map(([name, items]) => [name, items.map(item => item.id)])
    ),
    {
      unreviewed: ['dynamic.111111'],
      deferred: ['dynamic.222222'],
      translationApproved: ['dynamic.444444'],
      intentionallyIgnored: ['dynamic.333333']
    }
  )
  assert.deepStrictEqual(lifecycle.coverage, {
    total: 4,
    needsReview: 2,
    intentionallyIgnored: 1,
    translationApproved: 1,
    deferred: 1,
    migrated: 1
  })
  assert.deepStrictEqual(
    selectReviewCandidates({
      candidates: lifecycle.candidates,
      id: 'dynamic.111111',
      bulk: true,
      status: 'needs-review'
    }).map(item => item.id),
    ['dynamic.111111', 'dynamic.222222']
  )
  assert.deepStrictEqual(
    markDecisionMigrated({ id: 'dynamic.444444', decision: 'translate', key: 'greeting' }),
    { id: 'dynamic.444444', decision: 'migrated', key: 'greeting' }
  )
})
