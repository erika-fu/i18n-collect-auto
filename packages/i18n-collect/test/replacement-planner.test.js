const assert = require('assert')
const test = require('node:test')
const { ReplacementPlanner, planReplacement } = require('../mycommon/replacement-planner')
const { extractScript } = require('../myloader/extract-script')

function occurrence(key, source, containingSource, path = 'src/app.js') {
  const extracted = extractScript({ source: containingSource, resource: { projectPath: path }, config: {} })
    .find(entry => entry.value === source)
  const start = extracted
    ? extracted.locations[0].start
    : { line: 1, column: containingSource.indexOf(`"${source}"`) }
  const end = extracted
    ? extracted.locations[0].end
    : { line: 1, column: start.column + source.length + 2 }
  return {
    key,
    source,
    location: {
      path,
      kind: 'script-string',
      start,
      end
    }
  }
}

test('planner is a pure contract over keyed occurrences and resource snapshots', () => {
  const planner = new ReplacementPlanner({
    adapter: 'js',
    runtime: { localizationFunction: true }
  })
  const result = planner.plan({
    occurrences: [occurrence('home.hello', '你好', 'function render(t) { return "你好" }')],
    resources: new Map([['src/app.js', 'function render(t) { return "你好" }']])
  })

  assert.strictEqual(result.failure, null)
  assert.strictEqual(result.runtime.localizationFunction, true)
  assert.strictEqual(result.replacements[0].call, "t('home.hello')")
  assert.strictEqual(result.skipped.length, 0)
  assert.strictEqual(result.recognized.length, 0)
  assert.strictEqual(result.edits.length, 1)
  assert.strictEqual(result.edits[0].path, 'src/app.js')
  assert.strictEqual(result.edits[0].text, "t('home.hello')")
})

test('planner recognizes an existing localization call without nesting it', () => {
  const result = planReplacement({
    adapter: 'js',
    runtime: { localizationFunction: true },
    occurrences: [occurrence('home.hello', '你好', 'function render(t) { return t("你好") }')],
    resources: {
      'src/app.js': 'function render(t) { return t("你好") }'
    }
  })

  assert.strictEqual(result.replacements.length, 0)
  assert.strictEqual(result.recognized.length, 1)
  assert.strictEqual(result.recognized[0].call, "t('home.hello')")
})

test('planner recognizes a localized-call key argument after collection rebuilt the location', () => {
  const source = "function render(t) { return t('home.hello') }"
  const extracted = extractScript({
    source,
    resource: { projectPath: 'src/app.js' },
    config: {}
  }).find(entry => entry.representation === 'localized-call' && entry.key === 'home.hello')
  assert.ok(extracted, 'expected a localized-call occurrence for home.hello')
  const result = planReplacement({
    adapter: 'js',
    runtime: { localizationFunction: true },
    occurrences: [{
      key: 'home.hello',
      source: '你好',
      location: {
        path: 'src/app.js',
        kind: extracted.locations[0].kind,
        start: extracted.locations[0].start,
        end: extracted.locations[0].end
      }
    }],
    resources: { 'src/app.js': source }
  })

  assert.strictEqual(result.replacements.length, 0)
  assert.strictEqual(result.skipped.length, 0)
  assert.strictEqual(result.recognized.length, 1)
  assert.strictEqual(result.recognized[0].call, "t('home.hello')")
  assert.strictEqual(result.recognized[0].source, '你好')
})

test('planner reports missing resource content as a skip', () => {
  const result = planReplacement({
    adapter: 'js',
    occurrences: [occurrence('home.hello', '你好', 'const x = "你好"')],
    resources: { 'src/app.js': null }
  })

  assert.strictEqual(result.replacements.length, 0)
  assert.strictEqual(result.skipped[0].reason, 'source file is missing')
})

test('planner skips overlapping occurrence claims without rewriting either', () => {
  const source = 'function render(t) { return "你好" }'
  const item = occurrence('home.one', '你好', source)
  const rival = {
    ...item,
    key: 'home.two'
  }
  const result = planReplacement({
    adapter: 'js',
    runtime: { localizationFunction: true },
    occurrences: [item, rival],
    resources: { 'src/app.js': source }
  })

  assert.deepStrictEqual(result.replacements, [])
  assert.strictEqual(result.skipped.length, 2)
  assert.ok(result.skipped.every(entry => entry.reason === 'overlapping occurrence claims'))
})

test('planner consumes supplied Vue Template IR without resolving project files', () => {
  const source = '<template><p>你好</p></template>'
  const result = planReplacement({
    adapter: 'vue3',
    runtime: { localizationFunction: true },
    occurrences: [{
      key: 'home.hello',
      source: '你好',
      location: {
        path: 'src/Home.vue',
        kind: 'html-text',
        start: { line: 1, column: 13 },
        end: { line: 1, column: 15 }
      }
    }],
    resources: {
      'src/Home.vue': {
        source,
        template: {
          regions: [{
            type: 'text',
            start: 13,
            end: 15,
            value: '你好',
            sourceOffsets: [13, 14, 15]
          }]
        }
      }
    }
  })

  assert.strictEqual(result.replacements[0].call, "$t('home.hello')")
  assert.strictEqual(result.edits[0].text, "{{ $t('home.hello') }}")
})
