const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { keyFor } = require('../mycommon/store')

const bin = path.join(__dirname, '../bin/i18n-collect.js')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeMigrationProject(root, { sourceCatalog, metadata, targets, config = {} }) {
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  writeJson(path.join(root, 'lang/catalog/zh.json'), sourceCatalog)
  writeJson(path.join(root, 'lang/catalog/catalog.meta.json'), metadata)
  for (const [locale, catalog] of Object.entries(targets)) {
    writeJson(path.join(root, `lang/catalog/${locale}.json`), catalog)
  }
  const targetLocales = Object.keys(targets)
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    `module.exports = ${JSON.stringify({
      include: ['src'],
      targetLocales,
      ...config
    }, null, 2)}\n`
  )
}

function entry(source, origin = 'derived') {
  return {
    source,
    fingerprint: 'deadbeefdeadbeef',
    origin,
    representation: 'source-text',
    locations: [],
    occurrences: [
      {
        id: 'occ',
        semanticHost: 'src/app.js::script',
        childRole: 'script-string',
        localContext: 'sibling:0',
        origin,
        representation: 'source-text',
        location: {
          path: 'src/app.js',
          kind: 'script-string',
          start: { line: 1, column: 0 },
          end: { line: 1, column: 2 }
        }
      }
    ],
    status: 'active'
  }
}

test('migrate-keys help describes conflict-safe exact-text migration', () => {
  const result = run(['migrate-keys', '--help'])
  assert.strictEqual(result.status, 0, result.stderr)
  assert.match(result.stdout, /i18n-collect migrate-keys/)
  assert.match(result.stdout, /exact-text hash/)
  assert.match(result.stdout, /Conflicting historical translations/)
})

test('e2e one-to-one migration writes deterministic catalogs without occurrence identities', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-migrate-1to1-'))
  const oldKey = 'auto.01M6D71KFVAAAAAAAAAAAAAAA1'
  writeMigrationProject(root, {
    sourceCatalog: { [oldKey]: '姓名' },
    metadata: {
      version: 3,
      sourceLocale: 'zh',
      format: 'json',
      entries: { [oldKey]: entry('姓名') }
    },
    targets: { en: { [oldKey]: 'Name' } }
  })

  const beforeMeta = fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), 'utf8')
  const result = run(['migrate-keys', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(result.stderr, '')

  const hash = keyFor('姓名')
  assert.deepStrictEqual(readJson(path.join(root, 'lang/catalog/source-catalog.json')), {
    version: 1,
    messages: { [hash]: '姓名' }
  })
  assert.deepStrictEqual(readJson(path.join(root, 'lang/catalog/zh.json')), { [hash]: '姓名' })
  assert.deepStrictEqual(readJson(path.join(root, 'lang/catalog/en.json')), { [hash]: 'Name' })
  assert.strictEqual(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), 'utf8'), beforeMeta)
  assert.ok(!JSON.stringify(readJson(path.join(root, 'lang/catalog/source-catalog.json'))).includes('occurrences'))
})

test('e2e many-to-one migration merges equivalent historical translations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-migrate-many-'))
  const left = 'auto.01M6D71KFVAAAAAAAAAAAAAAA2'
  const right = 'auto.01M6D71KFVAAAAAAAAAAAAAAA3'
  writeMigrationProject(root, {
    sourceCatalog: { [left]: '请稍候', [right]: '请稍候' },
    metadata: {
      version: 3,
      sourceLocale: 'zh',
      format: 'json',
      entries: {
        [left]: entry('请稍候'),
        [right]: entry('请稍候')
      }
    },
    targets: { en: { [left]: 'Please wait', [right]: 'Please wait' } }
  })

  const result = run(['migrate-keys', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const hash = keyFor('请稍候')
  assert.deepStrictEqual(readJson(path.join(root, 'lang/catalog/en.json')), { [hash]: 'Please wait' })
  assert.deepStrictEqual(readJson(path.join(root, 'lang/catalog/zh.json')), { [hash]: '请稍候' })
})

test('e2e contextual conflict writes nothing and requires explicit keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-migrate-conflict-'))
  const left = 'auto.01M6D71KFVAAAAAAAAAAAAAAA4'
  const right = 'auto.01M6D71KFVAAAAAAAAAAAAAAA5'
  const sourceCatalog = { [left]: '欢迎', [right]: '欢迎' }
  const targets = { en: { [left]: 'Welcome aboard', [right]: 'Welcome back' } }
  writeMigrationProject(root, {
    sourceCatalog,
    metadata: {
      version: 3,
      sourceLocale: 'zh',
      format: 'json',
      entries: {
        [left]: entry('欢迎'),
        [right]: entry('欢迎')
      }
    },
    targets
  })
  const beforeZh = fs.readFileSync(path.join(root, 'lang/catalog/zh.json'), 'utf8')
  const beforeEn = fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8')

  const result = run(['migrate-keys', '--json'], root)
  assert.notStrictEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /Welcome aboard/)
  assert.match(result.stderr, /Welcome back/)
  assert.match(result.stderr, /explicit keys/)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/source-catalog.json')))
  assert.strictEqual(fs.readFileSync(path.join(root, 'lang/catalog/zh.json'), 'utf8'), beforeZh)
  assert.strictEqual(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8'), beforeEn)
})

test('e2e explicit-key preservation keeps distinct translations for shared source text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-migrate-explicit-'))
  const autoKey = 'auto.01M6D71KFVAAAAAAAAAAAAAAA6'
  writeMigrationProject(root, {
    sourceCatalog: {
      [autoKey]: '你好',
      'demo.visit.banner': '欢迎',
      'demo.visit.farewell': '欢迎'
    },
    metadata: {
      version: 3,
      sourceLocale: 'zh',
      format: 'json',
      entries: {
        [autoKey]: entry('你好'),
        'demo.visit.banner': entry('欢迎', 'explicit'),
        'demo.visit.farewell': entry('欢迎', 'explicit')
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

  const result = run(['migrate-keys', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.deepStrictEqual(readJson(path.join(root, 'lang/catalog/en.json')), {
    [keyFor('你好')]: 'Hello',
    'demo.visit.banner': 'Welcome aboard',
    'demo.visit.farewell': 'Welcome back'
  })
})

test('e2e collision diagnostics identify both messages and leave catalogs unpublished', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-migrate-collision-'))
  const left = 'auto.01M6D71KFVAAAAAAAAAAAAAAA7'
  const right = 'auto.01M6D71KFVAAAAAAAAAAAAAAA8'
  const sourceCatalog = { [left]: '甲', [right]: '乙' }
  const targets = { en: { [left]: 'A', [right]: 'B' } }
  const metadata = {
    version: 3,
    sourceLocale: 'zh',
    format: 'json',
    entries: {
      [left]: entry('甲'),
      [right]: entry('乙')
    }
  }
  writeMigrationProject(root, { sourceCatalog, metadata, targets })

  const { migrateToTextHashKeys } = require('../mycommon/migrate-text-hash-keys')
  const collision = migrateToTextHashKeys({
    sourceCatalog,
    metadata,
    targets,
    keyFor: () => 'ffffffffffffffffffffffffffffffff'
  })
  assert.strictEqual(collision.ok, false)
  assert.match(collision.report, /甲/)
  assert.match(collision.report, /乙/)
  assert.match(collision.report, /ffffffffffffffffffffffffffffffff/)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/source-catalog.json')))
  assert.deepStrictEqual(readJson(path.join(root, 'lang/catalog/zh.json')), sourceCatalog)
  assert.deepStrictEqual(readJson(path.join(root, 'lang/catalog/en.json')), targets.en)
})

test('e2e migration retries safely after conflicts are resolved with explicit keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-migrate-retry-'))
  const left = 'auto.01M6D71KFVAAAAAAAAAAAAAAA9'
  const right = 'auto.01M6D71KFVAAAAAAAAAAAAAA10'
  writeMigrationProject(root, {
    sourceCatalog: { [left]: '欢迎', [right]: '欢迎' },
    metadata: {
      version: 3,
      sourceLocale: 'zh',
      format: 'json',
      entries: {
        [left]: entry('欢迎'),
        [right]: entry('欢迎')
      }
    },
    targets: { en: { [left]: 'Welcome aboard', [right]: 'Welcome back' } }
  })

  const failed = run(['migrate-keys', '--json'], root)
  assert.notStrictEqual(failed.status, 0)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/source-catalog.json')))

  writeMigrationProject(root, {
    sourceCatalog: {
      'demo.visit.banner': '欢迎',
      'demo.visit.farewell': '欢迎'
    },
    metadata: {
      version: 3,
      sourceLocale: 'zh',
      format: 'json',
      entries: {
        'demo.visit.banner': entry('欢迎', 'explicit'),
        'demo.visit.farewell': entry('欢迎', 'explicit')
      }
    },
    targets: {
      en: {
        'demo.visit.banner': 'Welcome aboard',
        'demo.visit.farewell': 'Welcome back'
      }
    }
  })

  const resolved = run(['migrate-keys', '--json'], root)
  assert.strictEqual(resolved.status, 0, resolved.stderr)
  assert.deepStrictEqual(readJson(path.join(root, 'lang/catalog/source-catalog.json')), {
    version: 1,
    messages: {
      'demo.visit.banner': '欢迎',
      'demo.visit.farewell': '欢迎'
    }
  })
  assert.deepStrictEqual(readJson(path.join(root, 'lang/catalog/en.json')), {
    'demo.visit.banner': 'Welcome aboard',
    'demo.visit.farewell': 'Welcome back'
  })
})
