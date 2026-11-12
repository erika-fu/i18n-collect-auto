const assert = require('assert')
const test = require('node:test')
const { analyzeProject, buildSourceCatalog } = require('../mycommon/project-analysis')
const { migrateToTextHashKeys } = require('../mycommon/migrate-text-hash-keys')
const { keyFor } = require('../mycommon/store')

test('keyFor hashes exact source text without whitespace, punctuation, case, or Unicode normalization', () => {
  assert.strictEqual(keyFor('你好'), '7eca689f0d3389d9dea66ae112e5cfd7')
  assert.notStrictEqual(keyFor('你好'), keyFor('你好 '))
  assert.notStrictEqual(keyFor('你好'), keyFor('你好！'))
  assert.notStrictEqual(keyFor('你好'), keyFor('您好'))
  assert.strictEqual(keyFor('你好'), keyFor('你好'))
})

test('text-hash keys stay stable across path, line movement, and collection order', () => {
  const first = analyzeProject({
    files: [
      { path: 'src/a.js', source: 'const a = "稳定"\n' },
      { path: 'src/b.js', source: '\n\nconst b = "稳定"\n' }
    ]
  })
  const second = analyzeProject({
    files: [
      { path: 'lib/moved.js', source: 'const b = "稳定"\n' },
      { path: 'src/a.js', source: 'const a = "稳定"\n' }
    ]
  })
  assert.deepStrictEqual(buildSourceCatalog(first), buildSourceCatalog(second))
  assert.deepStrictEqual(buildSourceCatalog(first), { version: 1, messages: { [keyFor('稳定')]: '稳定' } })
})

test('equal exact source text across JavaScript, TypeScript, and Vue shares one automatic key', () => {
  const analysis = analyzeProject({
    files: [
      { path: 'src/app.js', source: 'const a = "共享"\n' },
      { path: 'src/app.ts', source: 'const b: string = "共享"\n' },
      {
        path: 'src/App.vue',
        source: [
          '<template><p>共享</p></template>',
          '<script>export default { name: "App" }</script>',
          ''
        ].join('\n')
      }
    ],
    config: { vueVersion: 3 }
  })
  assert.deepStrictEqual(buildSourceCatalog(analysis), { version: 1, messages: { [keyFor('共享')]: '共享' } })
  assert.strictEqual(analysis.runtimeMessages.length, 3)
})

test('hash collision between unequal source texts fails with both messages identified', () => {
  const analysis = {
    runtimeMessages: [
      { text: '甲', key: 'deadbeefdeadbeefdeadbeefdeadbeef' },
      { text: '乙', key: 'deadbeefdeadbeefdeadbeefdeadbeef' }
    ],
    localizedCallFindings: []
  }
  assert.throws(
    () => buildSourceCatalog(analysis),
    error => {
      assert.match(error.message, /甲/)
      assert.match(error.message, /乙/)
      assert.match(error.message, /deadbeefdeadbeefdeadbeefdeadbeef/)
      assert.strictEqual(error.kind, 'collection')
      return true
    }
  )
})

test('explicit keys remain unchanged beside automatic text-hash keys', () => {
  const analysis = analyzeProject({
    files: [{
      path: 'src/app.js',
      source: [
        'const title = /* i18n-key: home.title */ "首页"',
        'const shared = "你好"',
        'const again = "你好"',
        ''
      ].join('\n')
    }]
  })
  assert.deepStrictEqual(buildSourceCatalog(analysis), { version: 1, messages: {
    'home.title': '首页',
    [keyFor('你好')]: '你好'
  } })
})

test('migration one-to-one maps an automatic key onto its exact-text hash', () => {
  const oldKey = 'auto.01M6D71KFV03PK11J86A275RFG'
  const result = migrateToTextHashKeys({
    sourceCatalog: { [oldKey]: '姓名' },
    metadata: {
      version: 3,
      entries: {
        [oldKey]: { source: '姓名', origin: 'derived', status: 'active' }
      }
    },
    targets: { en: { [oldKey]: 'Name' } }
  })
  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(result.sourceCatalog, { [keyFor('姓名')]: '姓名' })
  assert.deepStrictEqual(result.targets.en, { [keyFor('姓名')]: 'Name' })
  assert.deepStrictEqual(result.keyMapping, { [oldKey]: keyFor('姓名') })
  assert.deepStrictEqual(Object.values(result.sourceCatalog), ['姓名'])
})

test('migration many-to-one merges equal translations for the same source text', () => {
  const left = 'auto.01M6D71KFVAAAAAAAAAAAAAAA1'
  const right = 'auto.01M6D71KFVAAAAAAAAAAAAAAA2'
  const result = migrateToTextHashKeys({
    sourceCatalog: { [left]: '请稍候', [right]: '请稍候' },
    metadata: {
      version: 3,
      entries: {
        [left]: { source: '请稍候', origin: 'derived', status: 'active' },
        [right]: { source: '请稍候', origin: 'derived', status: 'active' }
      }
    },
    targets: { en: { [left]: 'Please wait', [right]: 'Please wait' } }
  })
  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(result.sourceCatalog, { [keyFor('请稍候')]: '请稍候' })
  assert.deepStrictEqual(result.targets.en, { [keyFor('请稍候')]: 'Please wait' })
})

test('migration stops with a report when historical translations conflict for one source text', () => {
  const left = 'auto.01M6D71KFVAAAAAAAAAAAAAAA3'
  const right = 'auto.01M6D71KFVAAAAAAAAAAAAAAA4'
  const result = migrateToTextHashKeys({
    sourceCatalog: { [left]: '欢迎', [right]: '欢迎' },
    metadata: {
      version: 3,
      entries: {
        [left]: { source: '欢迎', origin: 'derived', status: 'active' },
        [right]: { source: '欢迎', origin: 'derived', status: 'active' }
      }
    },
    targets: { en: { [left]: 'Welcome aboard', [right]: 'Welcome back' } }
  })
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.conflicts.length, 1)
  assert.strictEqual(result.conflicts[0].source, '欢迎')
  assert.deepStrictEqual(result.conflicts[0].keys.sort(), [left, right].sort())
  assert.match(result.report, /欢迎/)
  assert.match(result.report, /Welcome aboard/)
  assert.match(result.report, /Welcome back/)
  assert.strictEqual(result.sourceCatalog, undefined)
  assert.strictEqual(result.targets, undefined)
})

test('migration never picks one conflicting historical translation heuristically', () => {
  const left = 'auto.01M6D71KFVAAAAAAAAAAAAAAA5'
  const right = 'auto.01M6D71KFVAAAAAAAAAAAAAAA6'
  const result = migrateToTextHashKeys({
    sourceCatalog: { [left]: '关闭', [right]: '关闭' },
    metadata: {
      version: 3,
      entries: {
        [left]: { source: '关闭', origin: 'derived', status: 'active' },
        [right]: { source: '关闭', origin: 'derived', status: 'active' }
      }
    },
    targets: { en: { [left]: 'Close', [right]: 'Dismiss' } }
  })
  assert.strictEqual(result.ok, false)
  assert.ok(!JSON.stringify(result).includes('"Close"') || result.targets == null)
  assert.strictEqual(result.targets, undefined)
})

test('migration conflicts when only some old keys have a target translation', () => {
  const left = 'auto.01M6D71KFVAAAAAAAAAAAAAA12'
  const right = 'auto.01M6D71KFVAAAAAAAAAAAAAA13'
  const result = migrateToTextHashKeys({
    sourceCatalog: { [left]: '关闭', [right]: '关闭' },
    metadata: {
      version: 3,
      entries: {
        [left]: { source: '关闭', origin: 'derived', status: 'active' },
        [right]: { source: '关闭', origin: 'derived', status: 'active' }
      }
    },
    targets: { en: { [left]: 'Close' } }
  })
  assert.strictEqual(result.ok, false)
  assert.match(result.report, /missing translation|Close/)
  assert.strictEqual(result.targets, undefined)
})

test('migration preserves explicit keys and their translations unchanged', () => {
  const autoKey = 'auto.01M6D71KFVAAAAAAAAAAAAAAA7'
  const result = migrateToTextHashKeys({
    sourceCatalog: {
      [autoKey]: '你好',
      'demo.visit.banner': '欢迎',
      'demo.visit.farewell': '欢迎'
    },
    metadata: {
      version: 3,
      entries: {
        [autoKey]: { source: '你好', origin: 'derived', status: 'active' },
        'demo.visit.banner': { source: '欢迎', origin: 'explicit', status: 'active' },
        'demo.visit.farewell': { source: '欢迎', origin: 'explicit', status: 'active' }
      }
    },
    targets: {
      en: {
        [autoKey]: 'Hello',
        'demo.visit.banner': 'Welcome aboard',
        'demo.visit.farewell': 'Welcome back'
      }
    }
  })
  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(result.sourceCatalog, {
    [keyFor('你好')]: '你好',
    'demo.visit.banner': '欢迎',
    'demo.visit.farewell': '欢迎'
  })
  assert.deepStrictEqual(result.targets.en, {
    [keyFor('你好')]: 'Hello',
    'demo.visit.banner': 'Welcome aboard',
    'demo.visit.farewell': 'Welcome back'
  })
})

test('migration collision diagnostics identify both unequal source texts', () => {
  const left = 'auto.01M6D71KFVAAAAAAAAAAAAAAA8'
  const right = 'auto.01M6D71KFVAAAAAAAAAAAAAAA9'
  const result = migrateToTextHashKeys({
    sourceCatalog: { [left]: '甲', [right]: '乙' },
    metadata: {
      version: 3,
      entries: {
        [left]: { source: '甲', origin: 'derived', status: 'active' },
        [right]: { source: '乙', origin: 'derived', status: 'active' }
      }
    },
    targets: { en: { [left]: 'A', [right]: 'B' } },
    keyFor: () => 'collision-hash-key'
  })
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.collisions.length, 1)
  assert.match(result.report, /甲/)
  assert.match(result.report, /乙/)
  assert.match(result.report, /collision-hash-key/)
})

test('migration can be retried safely after conflicts are resolved with explicit keys', () => {
  const left = 'auto.01M6D71KFVAAAAAAAAAAAAAA10'
  const right = 'auto.01M6D71KFVAAAAAAAAAAAAAA11'
  const conflicting = migrateToTextHashKeys({
    sourceCatalog: { [left]: '欢迎', [right]: '欢迎' },
    metadata: {
      version: 3,
      entries: {
        [left]: { source: '欢迎', origin: 'derived', status: 'active' },
        [right]: { source: '欢迎', origin: 'derived', status: 'active' }
      }
    },
    targets: { en: { [left]: 'Welcome aboard', [right]: 'Welcome back' } }
  })
  assert.strictEqual(conflicting.ok, false)

  const resolved = migrateToTextHashKeys({
    sourceCatalog: {
      'demo.visit.banner': '欢迎',
      'demo.visit.farewell': '欢迎'
    },
    metadata: {
      version: 3,
      entries: {
        'demo.visit.banner': { source: '欢迎', origin: 'explicit', status: 'active' },
        'demo.visit.farewell': { source: '欢迎', origin: 'explicit', status: 'active' }
      }
    },
    targets: {
      en: {
        'demo.visit.banner': 'Welcome aboard',
        'demo.visit.farewell': 'Welcome back'
      }
    }
  })
  assert.strictEqual(resolved.ok, true)
  assert.deepStrictEqual(resolved.sourceCatalog, {
    'demo.visit.banner': '欢迎',
    'demo.visit.farewell': '欢迎'
  })
  assert.deepStrictEqual(resolved.targets.en, {
    'demo.visit.banner': 'Welcome aboard',
    'demo.visit.farewell': 'Welcome back'
  })
})
