const assert = require('assert')
const test = require('node:test')
const {
  discoverDynamicMessageCandidates,
  dynamicCandidateId
} = require('../mycommon/complete-static-copy-policy')

test('discoverDynamicMessageCandidates reports one whole-expression candidate for template interpolation', () => {
  const source = 'const message = `你好${name}世界`\n'
  const candidates = discoverDynamicMessageCandidates([{ path: 'src/tpl.js', source }])
  assert.strictEqual(candidates.length, 1)
  const candidate = candidates[0]
  assert.strictEqual(candidate.expression, '`你好${name}世界`')
  assert.deepStrictEqual(candidate.staticFragments, ['你好', '世界'])
  assert.strictEqual(candidate.location.path, 'src/tpl.js')
  assert.deepStrictEqual(candidate.location.start, { line: 1, column: 16 })
  assert.deepStrictEqual(candidate.location.end, { line: 1, column: 29 })
  assert.strictEqual(candidate.semanticRole, 'dynamic-message')
  assert.strictEqual(candidate.capability, 'explicit-localization-required')
  assert.strictEqual(candidate.disposition, 'needs-review')
  assert.strictEqual(candidate.kind, 'template-literal')
  assert.ok(candidate.id.startsWith('dynamic.'))
  assert.match(candidate.diagnostic, /interpolation|fragment/i)
})

test('discoverDynamicMessageCandidates reports one whole-expression candidate for concatenation', () => {
  const source = "const split = '已选择 ' + count + ' 个文件'\n"
  const candidates = discoverDynamicMessageCandidates([{ path: 'src/upload.js', source }])
  assert.strictEqual(candidates.length, 1)
  assert.strictEqual(candidates[0].expression, "'已选择 ' + count + ' 个文件'")
  assert.deepStrictEqual(candidates[0].staticFragments, ['已选择 ', ' 个文件'])
  assert.match(candidates[0].diagnostic, /concatenation|fragment/i)
})

test('dynamic candidate identity survives coordinate and formatting-only changes', () => {
  const base = discoverDynamicMessageCandidates([
    { path: 'src/tpl.js', source: 'const message = `你好${name}世界`\n' }
  ])[0]
  const shifted = discoverDynamicMessageCandidates([
    { path: 'src/tpl.js', source: '\n\nconst message = `你好${name}世界`\n' }
  ])[0]
  const formatted = discoverDynamicMessageCandidates([
    { path: 'src/tpl.js', source: 'const message = `你好${ name }世界`\n' }
  ])[0]
  assert.strictEqual(base.id, shifted.id)
  assert.strictEqual(base.id, formatted.id)

  const semantic = discoverDynamicMessageCandidates([
    { path: 'src/tpl.js', source: 'const message = `你好${name}宇宙`\n' }
  ])[0]
  const otherPath = discoverDynamicMessageCandidates([
    { path: 'src/other.js', source: 'const message = `你好${name}世界`\n' }
  ])[0]
  assert.notStrictEqual(base.id, semantic.id)
  assert.notStrictEqual(base.id, otherPath.id)
})

test('dynamicCandidateId is deterministic for the same fingerprint inputs', () => {
  const left = dynamicCandidateId({
    path: 'src/a.js',
    expression: '`你好${name}`',
    reason: 'interpolation'
  })
  const right = dynamicCandidateId({
    path: 'src/a.js',
    expression: '`你好${name}`',
    reason: 'interpolation'
  })
  assert.strictEqual(left, right)
  assert.match(left, /^dynamic\.[0-9a-f]{6}$/)
})

test('discoverDynamicMessageCandidates covers conditional, formatting, and dynamic keys', () => {
  const candidates = discoverDynamicMessageCandidates([
    {
      path: 'src/shapes.js',
      source: [
        'const label = ready ? "就绪" : "等待"',
        'const title = "标题".repeat(2)',
        'const keyed = messages[`键${id}`]'
      ].join('\n')
    }
  ])
  assert.ok(candidates.some(item => (
    item.expression.includes('ready ? "就绪" : "等待"')
    && item.staticFragments.includes('就绪')
    && item.staticFragments.includes('等待')
  )))
  assert.ok(candidates.some(item => (
    item.expression.includes('"标题".repeat(2)')
    && item.staticFragments.includes('标题')
  )))
  assert.ok(candidates.some(item => (
    item.expression.includes('`键${id}`')
    && item.staticFragments.includes('键')
    && /dynamic key|fragment/i.test(item.diagnostic)
  )))
})
