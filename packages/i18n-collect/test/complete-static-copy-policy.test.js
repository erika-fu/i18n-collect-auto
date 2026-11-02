const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { identityFiles } = require('../mycommon/config')
const {
  comparePolicyBaseline,
  readPolicyBaseline,
  scanCompleteStaticCopyPolicy
} = require('../mycommon/complete-static-copy-policy')

test('complete static string literals are not policy violations', () => {
  const violations = scanCompleteStaticCopyPolicy([
    { path: 'src/ok.js', source: 'const message = "你好"\nconst also = `纯静态`\n' }
  ])
  assert.deepStrictEqual(violations, [])
})

test('reports concatenation fragments with reason and source location', () => {
  const source = 'const split = "你" + missing + "好"\n'
  const violations = scanCompleteStaticCopyPolicy([{ path: 'src/split.js', source }])
  assert.strictEqual(violations.length, 2)
  assert.deepStrictEqual(violations.map(item => item.text).sort(), ['你', '好'])
  for (const item of violations) {
    assert.strictEqual(item.reason, 'concatenation')
    assert.strictEqual(item.path, 'src/split.js')
    assert.strictEqual(item.kind, 'script-string')
    assert.ok(item.start)
    assert.ok(item.end)
  }
  const left = violations.find(item => item.text === '你')
  assert.deepStrictEqual(left.start, { line: 1, column: 14 })
  assert.deepStrictEqual(left.end, { line: 1, column: 17 })
  assert.strictEqual(source.slice(14, 17), '"你"')
})

test('reports template interpolation segments as interpolation', () => {
  const source = 'const message = `你好${name}世界`\n'
  const violations = scanCompleteStaticCopyPolicy([{ path: 'src/tpl.js', source }])
  assert.deepStrictEqual(
    violations.map(item => ({ reason: item.reason, text: item.text, kind: item.kind })),
    [
      { reason: 'interpolation', text: '你好', kind: 'template-literal' },
      { reason: 'interpolation', text: '世界', kind: 'template-literal' }
    ]
  )
})

test('reports conditional construction selecting Chinese alternatives', () => {
  const violations = scanCompleteStaticCopyPolicy([
    { path: 'src/ternary.js', source: 'const label = ready ? "就绪" : "等待"\n' }
  ])
  assert.deepStrictEqual(
    new Set(violations.map(item => `${item.reason}:${item.text}`)),
    new Set(['conditional:就绪', 'conditional:等待'])
  )
})

test('reports conditional construction that mixes a complete literal with concatenation', () => {
  const source = 'const label = ok ? "成功" : "失败：" + detail\n'
  const violations = scanCompleteStaticCopyPolicy([{ path: 'src/cond.js', source }])
  assert.ok(violations.some(item => item.reason === 'conditional' && item.text === '成功'))
  assert.ok(violations.some(item => item.reason === 'conditional' && item.text === '失败：'))
})

test('reports formatting calls that transform Chinese copy', () => {
  const source = 'const label = "标题".repeat(2)\nconst other = format("你好 {name}", name)\n'
  const violations = scanCompleteStaticCopyPolicy([{ path: 'src/fmt.js', source }])
  assert.ok(violations.some(item => item.reason === 'formatting' && item.text === '标题'))
  assert.ok(violations.some(item => item.reason === 'formatting' && item.text === '你好 {name}'))
})

test('reports TypeScript and JSX interpolation shapes', () => {
  const ts = 'const count: number = 1\nconst summary = `还有${count}项`\n'
  const jsx = 'export function App() { const n = 1; return <p>{`你有${n}条`}</p> }\n'
  const violations = scanCompleteStaticCopyPolicy([
    { path: 'src/a.ts', source: ts },
    { path: 'src/App.jsx', source: jsx }
  ])
  assert.ok(violations.some(item => item.path === 'src/a.ts' && item.text === '还有'))
  assert.ok(violations.some(item => item.path === 'src/App.jsx' && item.text === '你有'))
})

test('reports Vue template interpolations and bindings while allowing complete static copy', () => {
  const source = [
    '<template>',
    '  <section>',
    '    <p>{{ `欢迎${name}回来` }}</p>',
    '    <p>{{ `纯静态插值` }}</p>',
    '    <p>{{ empty + \'拼接后的中文\' }}</p>',
    '    <p :title="`当前用户${name}`">静态标题文案</p>',
    '  </section>',
    '</template>',
    '',
    '<script>',
    'export default {',
    '  computed: {',
    '    greeting () { return `你有${this.count}条未读消息` }',
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
  const violations = scanCompleteStaticCopyPolicy([{ path: 'src/LiteralPage.vue', source }])
  assert.ok(violations.some(item => item.reason === 'interpolation' && item.text === '欢迎'))
  assert.ok(violations.some(item => item.reason === 'interpolation' && item.text === '回来'))
  assert.ok(violations.some(item => item.reason === 'concatenation' && item.text === '拼接后的中文'))
  assert.ok(violations.some(item => item.reason === 'interpolation' && item.text === '当前用户'))
  assert.ok(violations.some(item => item.reason === 'interpolation' && item.text === '你有'))
  assert.ok(!violations.some(item => item.text === '纯静态插值'))
  assert.ok(!violations.some(item => item.text === '静态标题文案'))
})

test('readPolicyBaseline loads a versioned committed baseline and rejects bad shapes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-policy-baseline-'))
  const file = path.join(root, 'complete-static-copy-baseline.json')
  assert.deepStrictEqual(readPolicyBaseline(file), [])
  fs.writeFileSync(file, `${JSON.stringify({
    version: 1,
    violations: [{
      reason: 'concatenation',
      path: 'src/a.js',
      kind: 'script-string',
      start: { line: 1, column: 4 },
      end: { line: 1, column: 8 },
      text: '你好'
    }]
  })}\n`)
  assert.deepStrictEqual(readPolicyBaseline(file), [{
    reason: 'concatenation',
    path: 'src/a.js',
    kind: 'script-string',
    start: { line: 1, column: 4 },
    end: { line: 1, column: 8 },
    text: '你好'
  }])
  fs.writeFileSync(file, '{"version":9,"violations":[]}\n')
  assert.throws(() => readPolicyBaseline(file), /version 9 is unsupported/)
})

test('identityFiles exposes the complete-static-copy baseline beside catalog metadata', () => {
  assert.strictEqual(
    identityFiles({ catalogDir: 'lang/catalog' }).completeStaticCopyBaseline,
    'lang/catalog/complete-static-copy-baseline.json'
  )
})

test('comparePolicyBaseline grandfathers exact matches and fails new or modified violations', () => {
  const baseline = [{
    reason: 'interpolation',
    path: 'src/a.js',
    kind: 'template-literal',
    start: { line: 2, column: 10 },
    end: { line: 2, column: 12 },
    text: '你好'
  }]
  const same = comparePolicyBaseline(baseline, baseline)
  assert.deepStrictEqual(same.newViolations, [])
  assert.deepStrictEqual(same.modifiedViolations, [])
  assert.strictEqual(same.grandfathered.length, 1)

  const added = comparePolicyBaseline([{
    ...baseline[0],
    path: 'src/b.js',
    text: '世界'
  }, baseline[0]], baseline)
  assert.strictEqual(added.newViolations.length, 1)
  assert.strictEqual(added.newViolations[0].text, '世界')

  const modified = comparePolicyBaseline([{
    ...baseline[0],
    text: '你好啊',
    end: { line: 2, column: 13 }
  }], baseline)
  assert.strictEqual(modified.modifiedViolations.length, 1)
  assert.strictEqual(modified.newViolations.length, 0)
})
