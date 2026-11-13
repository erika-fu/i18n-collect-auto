const assert = require('assert')
const test = require('node:test')
const { planProvenSafeMigration } = require('../mycommon/review-write-migration')

function candidate(overrides = {}) {
  return {
    id: 'dynamic.abcdef',
    expression: "'已选择 ' + count + ' 个文件'",
    staticFragments: ['已选择 ', ' 个文件'],
    location: {
      path: 'src/upload.js',
      start: { line: 1, column: 14 },
      end: { line: 1, column: 37 }
    },
    reason: 'concatenation',
    sourceSurface: 'script',
    ...overrides
  }
}

test('planProvenSafeMigration rewrites safe concatenation to an explicit call with named params', () => {
  const fileSource = "const label = '已选择 ' + count + ' 个文件'\n"
  const planned = planProvenSafeMigration({
    candidate: candidate(),
    key: 'upload.selectedFiles',
    source: '已选择 {count} 个文件',
    fileSource,
    adapter: 'js'
  })
  assert.strictEqual(planned.ok, true)
  assert.strictEqual(planned.call, "t('upload.selectedFiles', { count })")
  assert.strictEqual(planned.preview, "const label = t('upload.selectedFiles', { count })\n")
  assert.deepStrictEqual(planned.placeholders, ['count'])
})

test('planProvenSafeMigration rewrites safe template literals with identifier interpolations', () => {
  const fileSource = 'const message = `你好${name}世界`\n'
  const planned = planProvenSafeMigration({
    candidate: candidate({
      expression: '`你好${name}世界`',
      staticFragments: ['你好', '世界'],
      location: {
        path: 'src/greet.js',
        start: { line: 1, column: 16 },
        end: { line: 1, column: 29 }
      },
      reason: 'interpolation'
    }),
    key: 'greet.hello',
    source: '你好{name}世界',
    fileSource,
    adapter: 'js'
  })
  assert.strictEqual(planned.ok, true)
  assert.strictEqual(planned.call, "t('greet.hello', { name })")
  assert.strictEqual(planned.preview, "const message = t('greet.hello', { name })\n")
})

test('planProvenSafeMigration rewrites Vue template expressions with $t', () => {
  const fileSource = [
    '<template>',
    '  <p>{{ "已选择 " + count + " 个文件" }}</p>',
    '</template>',
    ''
  ].join('\n')
  const expression = '"已选择 " + count + " 个文件"'
  const startColumn = fileSource.indexOf(expression)
  const planned = planProvenSafeMigration({
    candidate: candidate({
      expression,
      staticFragments: ['已选择 ', ' 个文件'],
      location: {
        path: 'src/Home.vue',
        start: { line: 2, column: 8 },
        end: { line: 2, column: 8 + expression.length }
      },
      reason: 'concatenation',
      sourceSurface: 'vue-template'
    }),
    key: 'upload.selectedFiles',
    source: '已选择 {count} 个文件',
    fileSource,
    adapter: 'vue3'
  })
  assert.strictEqual(planned.ok, true, planned.reason)
  assert.strictEqual(planned.call, "$t('upload.selectedFiles', { count })")
  assert.ok(planned.preview.includes("{{ $t('upload.selectedFiles', { count }) }}"))
  assert.ok(startColumn > 0)
})

test('planProvenSafeMigration refuses conditional, formatting, dynamic-key, and structured cases', () => {
  const cases = [
    {
      reason: 'conditional',
      expression: 'ready ? "就绪" : "等待"',
      source: '就绪',
      fileSource: 'const label = ready ? "就绪" : "等待"\n',
      start: 14,
      end: 14 + 'ready ? "就绪" : "等待"'.length
    },
    {
      reason: 'formatting',
      expression: '"标题".repeat(2)',
      source: '标题',
      fileSource: 'const title = "标题".repeat(2)\n',
      start: 14,
      end: 14 + '"标题".repeat(2)'.length
    },
    {
      reason: 'dynamic-key',
      expression: '`键${id}`',
      source: '键{id}',
      fileSource: 'const keyed = messages[`键${id}`]\n',
      start: file => file.indexOf('`键${id}`'),
      end: file => file.indexOf('`键${id}`') + '`键${id}`'.length
    },
    {
      reason: 'structured-fragmentation',
      expression: '<span>你好</span>',
      source: '你好',
      fileSource: '<template><p><span>你好</span>世界</p></template>\n',
      start: 14,
      end: 14 + '<span>你好</span>'.length
    }
  ]
  for (const item of cases) {
    const fileSource = item.fileSource
    const start = typeof item.start === 'function' ? item.start(fileSource) : item.start
    const end = typeof item.end === 'function' ? item.end(fileSource) : item.end
    const planned = planProvenSafeMigration({
      candidate: candidate({
        expression: item.expression,
        staticFragments: [item.source.replace(/\{[^}]+\}/g, '') || item.source],
        location: {
          path: 'src/shapes.js',
          start: { line: 1, column: start },
          end: { line: 1, column: end }
        },
        reason: item.reason
      }),
      key: 'shapes.item',
      source: item.source,
      fileSource,
      adapter: 'js'
    })
    assert.strictEqual(planned.ok, false, item.reason)
    assert.match(planned.reason, /not proven-safe|proven-safe/i)
  }
})

test('planProvenSafeMigration refuses side-effecting interpolations and mismatched approved source', () => {
  const fileSource = 'const message = `你好${load()}世界`\n'
  const expression = '`你好${load()}世界`'
  const start = fileSource.indexOf(expression)
  const callRefusal = planProvenSafeMigration({
    candidate: candidate({
      expression,
      staticFragments: ['你好', '世界'],
      location: {
        path: 'src/greet.js',
        start: { line: 1, column: start },
        end: { line: 1, column: start + expression.length }
      },
      reason: 'interpolation'
    }),
    key: 'greet.hello',
    source: '你好{name}世界',
    fileSource,
    adapter: 'js'
  })
  assert.strictEqual(callRefusal.ok, false)
  assert.match(callRefusal.reason, /side-effect-free|identifier|placeholder/i)

  const concatSource = "const label = '已选择 ' + count + ' 个文件'\n"
  const concatExpr = "'已选择 ' + count + ' 个文件'"
  const mismatch = planProvenSafeMigration({
    candidate: candidate({
      expression: concatExpr,
      location: {
        path: 'src/upload.js',
        start: { line: 1, column: 14 },
        end: { line: 1, column: 37 }
      }
    }),
    key: 'upload.selectedFiles',
    source: '已选择 {total} 个文件',
    fileSource: concatSource,
    adapter: 'js'
  })
  assert.strictEqual(mismatch.ok, false)
  assert.match(mismatch.reason, /does not match|approved explicit source/i)
})
