const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { fingerprintOf } = require('../mycommon/catalog')
const { loadConfig } = require('../mycommon/config')
const { translate } = require('../cli/translate')

const bin = path.join(__dirname, '../bin/i18n-collect.js')

function run(args, cwd, env = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env }
  })
}

function runFailingReplacement(args, cwd) {
  const hook = path.join(cwd, 'fail-replacement.js')
  fs.writeFileSync(hook, `const fs = require('fs')
const path = require('path')
const rename = fs.renameSync.bind(fs)
const write = fs.writeFileSync.bind(fs)
const finals = new Set(['en.json', 'fr.json', 'translation-state.json'])
let replaced = 0
function noteFinal(file) {
  if (!finals.has(path.basename(String(file)))) return
  replaced += 1
  if (replaced === 3) {
    const error = new Error('simulated storage failure')
    error.code = 'EIO'
    throw error
  }
}
fs.writeFileSync = (file, ...args) => {
  noteFinal(file)
  return write(file, ...args)
}
fs.renameSync = (from, to) => {
  if (String(from).includes('.tmp-')) noteFinal(to)
  return rename(from, to)
}
`)
  return spawnSync(process.execPath, ['-r', hook, bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function networkProvider(body) {
  return `const fs = require('fs')
const path = require('path')
module.exports = {
  network: true,
  translate(request) {
    fs.writeFileSync(path.join(__dirname, 'sent.json'), JSON.stringify(request.items))
    ${body}
  }
}
`
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function entry(source) {
  return {
    source,
    fingerprint: fingerprintOf(source),
    origin: 'explicit',
    locations: []
  }
}

function writeProject(root, {
  provider,
  messages,
  targets = {},
  state = null,
  config = {
    translationProvider: 'i18n/provider.js',
    targetLocales: ['en']
  }
} = {}) {
  fs.mkdirSync(path.join(root, 'i18n'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, 'i18n/provider.js'), provider)
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), `module.exports = ${JSON.stringify(config, null, 2)}\n`)
  const entries = {}
  for (const [key, source] of Object.entries(messages)) entries[key] = entry(source)
  fs.writeFileSync(path.join(root, 'lang/catalog/zh.json'), json(messages))
  fs.writeFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), json({
    version: 1,
    sourceLocale: 'zh',
    format: 'json',
    entries
  }))
  for (const [locale, catalog] of Object.entries(targets)) {
    fs.writeFileSync(path.join(root, 'lang/catalog', `${locale}.json`), json(catalog))
  }
  if (state) fs.writeFileSync(path.join(root, 'lang/catalog/translation-state.json'), json(state))
}

test('translate fills missing target text from a local provider and keeps an existing translation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-translate-'))
  const sourceBytes = []
  writeProject(root, {
    messages: { 'home.keep': '保留', 'home.title': '首页' },
    targets: { en: { 'home.keep': 'Keep me' } },
    provider: `module.exports = {
      translate(request) {
        if (request.sourceLocale !== 'zh') throw new Error('unexpected source locale')
        if (!request.locales.includes('en')) throw new Error('missing requested locale')
        if (request.items.some(item => item.key === 'home.keep')) throw new Error('protected text was sent')
        const item = request.items.find(entry => entry.key === 'home.title')
        if (!item || item.source !== '首页' || item.locales.join(',') !== 'en') throw new Error('missing source text')
        return { drafts: [{ key: 'home.title', locale: 'en', text: 'Home' }] }
      }
    }
    `
  })
  sourceBytes.push(fs.readFileSync(path.join(root, 'lang/catalog/zh.json')))
  const result = run(['translate', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(result.stderr, '')
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8')), {
    'home.keep': 'Keep me',
    'home.title': 'Home'
  })
  const state = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/translation-state.json'), 'utf8'))
  assert.deepStrictEqual(state.locales.en['home.title'], {
    sourceFingerprint: fingerprintOf('首页'),
    review: 'current'
  })
  assert.deepStrictEqual(state.locales.en['home.keep'], {
    sourceFingerprint: fingerprintOf('保留'),
    review: 'current'
  })
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/zh.json')), sourceBytes[0])
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.command, 'translate')
  assert.deepStrictEqual(report.created, [{ key: 'home.title', locale: 'en' }])
  assert.deepStrictEqual(report.kept, [{ key: 'home.keep', locale: 'en' }])
  assert.deepStrictEqual(report.replaced, [])
  assert.deepStrictEqual(report.failures, [])
})

test('--retranslate replaces existing translations that the default run keeps', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-retranslate-'))
  writeProject(root, {
    messages: { 'home.keep': '保留', 'home.title': '首页' },
    targets: { en: { 'home.keep': 'Keep me' } },
    state: {
      version: 1,
      locales: {
        en: {
          'home.keep': { sourceFingerprint: fingerprintOf('保留'), review: 'current' }
        }
      }
    },
    provider: `module.exports = {
      translate(request) {
        const keys = request.items.map(item => item.key + ':' + item.locales.join('+')).sort().join(',')
        if (keys === 'home.title:en') {
          return { drafts: [{ key: 'home.title', locale: 'en', text: 'Home' }] }
        }
        if (keys === 'home.keep:en,home.title:en') {
          return {
            drafts: [
              { key: 'home.keep', locale: 'en', text: 'Kept' },
              { key: 'home.title', locale: 'en', text: 'Home again' }
            ]
          }
        }
        throw new Error('unexpected selection ' + keys)
      }
    }
    `
  })
  const kept = run(['translate', '--json'], root)
  assert.strictEqual(kept.status, 0, kept.stderr)
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8'))['home.keep'], 'Keep me')

  const result = run(['translate', '--json', '--retranslate'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8')), {
    'home.keep': 'Kept',
    'home.title': 'Home again'
  })
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.retranslate, true)
  assert.deepStrictEqual(report.replaced, [
    { key: 'home.keep', locale: 'en' },
    { key: 'home.title', locale: 'en' }
  ])
  assert.deepStrictEqual(report.created, [])
  assert.deepStrictEqual(report.kept, [])
})

test('translate keeps orphaned translations and prunes retired keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-retire-translate-'))
  const liveFingerprint = fingerprintOf('在线')
  const orphanFingerprint = fingerprintOf('孤儿')
  const location = {
    path: 'src/a.js',
    kind: 'script-string',
    start: { line: 1, column: 0 },
    end: { line: 1, column: 2 }
  }
  writeProject(root, {
    messages: { 'home.live': '在线' },
    targets: {
      en: {
        'home.live': 'Live',
        'home.orphan': 'Orphan',
        'home.retired': 'Gone'
      }
    },
    state: {
      version: 1,
      locales: {
        en: {
          'home.live': { sourceFingerprint: liveFingerprint, review: 'current' },
          'home.orphan': { sourceFingerprint: orphanFingerprint, review: 'current' },
          'home.retired': { sourceFingerprint: orphanFingerprint, review: 'needs-review' }
        }
      }
    },
    provider: `module.exports = {
      translate() {
        throw new Error('provider should not be called')
      }
    }
    `
  })
  fs.writeFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), json({
    version: 2,
    sourceLocale: 'zh',
    format: 'json',
    entries: {
      'home.live': {
        source: '在线',
        fingerprint: liveFingerprint,
        origin: 'explicit',
        status: 'active',
        locations: [location],
        occurrences: [{
          id: 'aaaaaaaaaaaaaaaa',
          semanticHost: 'src/a.js::script',
          childRole: 'script-string',
          localContext: 'sibling:0',
          origin: 'explicit',
          location
        }]
      },
      'home.orphan': {
        source: '孤儿',
        fingerprint: orphanFingerprint,
        origin: 'explicit',
        status: 'orphaned',
        locations: [location],
        occurrences: [{
          id: 'bbbbbbbbbbbbbbbb',
          semanticHost: 'src/a.js::script',
          childRole: 'script-string',
          localContext: 'sibling:0',
          origin: 'explicit',
          location
        }]
      }
    }
  }))
  const result = run(['translate', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8')), {
    'home.live': 'Live',
    'home.orphan': 'Orphan'
  })
  const state = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/translation-state.json'), 'utf8'))
  assert.strictEqual(state.locales.en['home.retired'], undefined)
  assert.strictEqual(state.locales.en['home.orphan'].review, 'current')
  assert.deepStrictEqual(JSON.parse(result.stdout).pruned, [{ key: 'home.retired', locale: 'en' }])
})

test('a changed source keeps the target text and marks it as needing review', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-review-'))
  const previous = fingerprintOf('首页')
  writeProject(root, {
    messages: { 'home.title': '主页' },
    targets: { en: { 'home.title': 'Home' } },
    state: {
      version: 1,
      locales: {
        en: {
          'home.title': { sourceFingerprint: previous, review: 'current' }
        }
      }
    },
    provider: `module.exports = {
      translate() {
        throw new Error('provider should not be called')
      }
    }
    `
  })
  const result = run(['translate', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8'))['home.title'], 'Home')
  const state = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/translation-state.json'), 'utf8'))
  assert.deepStrictEqual(state.locales.en['home.title'], {
    sourceFingerprint: previous,
    review: 'needs-review'
  })
  assert.deepStrictEqual(JSON.parse(result.stdout).needsReview, [{ key: 'home.title', locale: 'en' }])
})

test('a partial failure keeps the successful draft and reports the failed item', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-partial-'))
  writeProject(root, {
    messages: { 'home.body': '正文', 'home.title': '首页' },
    provider: `module.exports = {
      translate() {
        return {
          drafts: [{ key: 'home.title', locale: 'en', text: 'Home' }],
          failures: [{ key: 'home.body', locale: 'en', message: 'glossary rejected 正文' }]
        }
      }
    }
    `
  })
  const result = run(['translate', '--json'], root)
  assert.strictEqual(result.status, 4, result.stderr)
  assert.match(result.stderr, /translation: home\.body \[en\]: glossary rejected 正文/)
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8')), {
    'home.title': 'Home'
  })
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.strictEqual(report.policy, 'partial')
  assert.deepStrictEqual(report.created, [{ key: 'home.title', locale: 'en' }])
  assert.deepStrictEqual(report.failures, [{
    key: 'home.body',
    locale: 'en',
    message: 'glossary rejected 正文'
  }])
  const state = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/translation-state.json'), 'utf8'))
  assert.strictEqual(state.locales.en['home.title'].review, 'current')
  assert.strictEqual(state.locales.en['home.body'], undefined)
})

test('strict failure leaves every catalog unchanged until a partial run is requested', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-strict-'))
  const previous = fingerprintOf('首页')
  writeProject(root, {
    messages: { 'home.body': '正文', 'home.keep': '主页', 'home.title': '首页' },
    targets: { en: { 'home.keep': 'Old home' } },
    state: {
      version: 1,
      locales: {
        en: { 'home.keep': { sourceFingerprint: previous, review: 'current' } }
      }
    },
    config: {
      translationProvider: 'i18n/provider.js',
      targetLocales: ['en'],
      translationFailure: 'strict'
    },
    provider: `module.exports = {
      translate() {
        return {
          drafts: [{ key: 'home.title', locale: 'en', text: 'Home' }],
          failures: [{ key: 'home.body', locale: 'en', message: 'glossary rejected 正文' }]
        }
      }
    }
    `
  })
  const beforeCatalog = fs.readFileSync(path.join(root, 'lang/catalog/en.json'))
  const beforeState = fs.readFileSync(path.join(root, 'lang/catalog/translation-state.json'))
  const strict = run(['translate', '--json'], root)
  assert.strictEqual(strict.status, 4, strict.stderr)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/en.json')), beforeCatalog)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/translation-state.json')), beforeState)
  const withheld = JSON.parse(strict.stdout)
  assert.strictEqual(withheld.policy, 'strict')
  assert.strictEqual(withheld.applied, false)
  assert.deepStrictEqual(withheld.created, [])
  assert.deepStrictEqual(withheld.needsReview, [])
  assert.deepStrictEqual(withheld.withheld, [{ key: 'home.title', locale: 'en' }])
  assert.deepStrictEqual(withheld.failures, [{
    key: 'home.body',
    locale: 'en',
    message: 'glossary rejected 正文'
  }])

  const partial = run(['translate', '--json', '--failure', 'partial'], root)
  assert.strictEqual(partial.status, 4, partial.stderr)
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8')), {
    'home.keep': 'Old home',
    'home.title': 'Home'
  })
  const saved = JSON.parse(partial.stdout)
  assert.strictEqual(saved.policy, 'partial')
  assert.strictEqual(saved.applied, true)
  assert.deepStrictEqual(saved.created, [{ key: 'home.title', locale: 'en' }])
  assert.deepStrictEqual(saved.needsReview, [{ key: 'home.keep', locale: 'en' }])
  const state = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/translation-state.json'), 'utf8'))
  assert.deepStrictEqual(state.locales.en['home.keep'], {
    sourceFingerprint: previous,
    review: 'needs-review'
  })
})

test('--retranslate replaces a review-marked translation and records the new source fingerprint', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-rereview-'))
  writeProject(root, {
    messages: { 'home.title': '主页' },
    targets: { en: { 'home.title': 'Home' } },
    state: {
      version: 1,
      locales: {
        en: { 'home.title': { sourceFingerprint: fingerprintOf('首页'), review: 'needs-review' } }
      }
    },
    provider: `module.exports = {
      translate(request) {
        const item = request.items[0]
        if (!item || item.key !== 'home.title' || item.source !== '主页') throw new Error('stale source was sent')
        return { drafts: [{ key: 'home.title', locale: 'en', text: 'Main page' }] }
      }
    }
    `
  })
  const result = run(['translate', '--json', '--retranslate'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8'))['home.title'], 'Main page')
  const state = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/translation-state.json'), 'utf8'))
  assert.deepStrictEqual(state.locales.en['home.title'], {
    sourceFingerprint: fingerprintOf('主页'),
    review: 'current'
  })
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.replaced, [{ key: 'home.title', locale: 'en' }])
  assert.deepStrictEqual(report.needsReview, [])
})

test('translate help documents the provider contract and failure policy', () => {
  const result = run(['translate', '--help'])
  assert.strictEqual(result.status, 0)
  assert.strictEqual(result.stderr, '')
  const help = result.stdout
  assert.match(help, /translate\(request\)/)
  assert.match(help, /sourceLocale/)
  assert.match(help, /\{ key, source, locales \}/)
  assert.match(help, /drafts/)
  assert.match(help, /--retranslate/)
  assert.match(help, /needs-review/)
  assert.match(help, /partial/)
  assert.match(help, /strict/)
  assert.match(help, /does not need credentials/)
  assert.match(help, /--allow-network/)
  assert.match(help, /network: true/)
})

test('a partial failure creates no catalog when every draft fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-empty-fail-'))
  writeProject(root, {
    messages: { 'home.title': '首页' },
    provider: `module.exports = {
      translate() {
        return { drafts: [], failures: [{ key: 'home.title', locale: 'en', message: 'provider down' }] }
      }
    }
    `
  })
  const result = run(['translate', '--json'], root)
  assert.strictEqual(result.status, 4, result.stderr)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/en.json')), false)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/translation-state.json')), false)
  assert.deepStrictEqual(JSON.parse(result.stdout).failures, [{
    key: 'home.title',
    locale: 'en',
    message: 'provider down'
  }])
})

test('a restored source fingerprint clears needs-review and keeps the translation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-restore-'))
  writeProject(root, {
    messages: { 'home.title': '首页' },
    targets: { en: { 'home.title': 'Home' } },
    state: {
      version: 1,
      locales: {
        en: { 'home.title': { sourceFingerprint: fingerprintOf('首页'), review: 'needs-review' } }
      }
    },
    provider: `module.exports = {
      translate() {
        throw new Error('provider should not be called')
      }
    }
    `
  })
  const result = run(['translate', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8'))['home.title'], 'Home')
  const state = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/translation-state.json'), 'utf8'))
  assert.deepStrictEqual(state.locales.en['home.title'], {
    sourceFingerprint: fingerprintOf('首页'),
    review: 'current'
  })
  assert.deepStrictEqual(JSON.parse(result.stdout).needsReview, [])
})

test('a network provider cannot send source text unless translation is authorized', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-auth-'))
  writeProject(root, {
    messages: { 'home.keep': '保留', 'home.title': '首页' },
    targets: { en: { 'home.keep': 'Keep me' } },
    provider: `const fs = require('fs')
const path = require('path')
module.exports = {
  network: true,
  translate(request) {
    fs.writeFileSync(path.join(__dirname, 'sent.json'), JSON.stringify(request))
    return { drafts: [{ key: 'home.title', locale: 'en', text: 'Home' }] }
  }
}
`
  })
  const catalog = path.join(root, 'lang/catalog/en.json')
  const before = fs.readFileSync(catalog)
  const result = run(['translate', '--json'], root)
  assert.strictEqual(result.status, 5, result.stderr)
  assert.match(result.stderr, /^authorization: /)
  assert.strictEqual(fs.existsSync(path.join(root, 'i18n/sent.json')), false)
  assert.deepStrictEqual(fs.readFileSync(catalog), before)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/translation-state.json')), false)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'translate')
  assert.strictEqual(report.failure, 'authorization')
  assert.strictEqual(report.ok, false)
  assert.match(report.message, /--allow-network/)
})

test('--allow-network authorizes a network provider to receive source text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-allow-'))
  writeProject(root, {
    messages: { 'home.title': '首页' },
    provider: `const fs = require('fs')
const path = require('path')
module.exports = {
  network: true,
  translate(request) {
    fs.writeFileSync(path.join(__dirname, 'sent.json'), JSON.stringify(request.items))
    const item = request.items[0]
    return { drafts: [{ key: item.key, locale: 'en', text: 'Home' }] }
  }
}
`
  })
  const result = run(['translate', '--json', '--allow-network'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(result.stderr, '')
  const sent = JSON.parse(fs.readFileSync(path.join(root, 'i18n/sent.json'), 'utf8'))
  assert.deepStrictEqual(sent, [{ key: 'home.title', source: '首页', locales: ['en'] }])
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8')), {
    'home.title': 'Home'
  })
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.failure, undefined)
  assert.deepStrictEqual(report.created, [{ key: 'home.title', locale: 'en' }])
})

test('interactive confirmation sends source text only after an explicit yes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-prompt-'))
  writeProject(root, {
    messages: { 'home.title': '首页' },
    provider: networkProvider(`return { drafts: [{ key: 'home.title', locale: 'en', text: 'Home' }] }`)
  })
  const questions = []
  const declined = await translate(['--cwd', root, '--json'], {
    interactive: true,
    ask: async question => {
      questions.push(question)
      return 'n'
    }
  })
  assert.strictEqual(declined.code, 5, declined.stderr)
  assert.match(declined.stderr, /^authorization: /)
  assert.match(questions[0], /outside the project/)
  assert.strictEqual(fs.existsSync(path.join(root, 'i18n/sent.json')), false)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/en.json')), false)

  const accepted = await translate(['--cwd', root, '--json'], {
    interactive: true,
    ask: async () => 'yes'
  })
  assert.strictEqual(accepted.code, 0, accepted.stderr)
  const sent = JSON.parse(fs.readFileSync(path.join(root, 'i18n/sent.json'), 'utf8'))
  assert.deepStrictEqual(sent, [{ key: 'home.title', source: '首页', locales: ['en'] }])
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8'))['home.title'], 'Home')
})

test('a network provider skips confirmation when no source text is transmitted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-local-review-'))
  writeProject(root, {
    messages: { 'home.title': '主页' },
    targets: { en: { 'home.title': 'Home' } },
    state: {
      version: 1,
      locales: {
        en: { 'home.title': { sourceFingerprint: fingerprintOf('首页'), review: 'current' } }
      }
    },
    provider: networkProvider(`throw new Error('source text was sent')`)
  })
  const result = run(['translate', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(fs.existsSync(path.join(root, 'i18n/sent.json')), false)
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/en.json'), 'utf8'))['home.title'], 'Home')
  const state = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/translation-state.json'), 'utf8'))
  assert.strictEqual(state.locales.en['home.title'].review, 'needs-review')
})

test('an authorized provider failure stays a translation failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-provider-fail-'))
  writeProject(root, {
    messages: { 'home.title': '首页' },
    provider: networkProvider(`return { drafts: [], failures: [{ key: 'home.title', locale: 'en', message: 'provider down' }] }`)
  })
  const result = run(['translate', '--json', '--allow-network'], root)
  assert.strictEqual(result.status, 4, result.stderr)
  assert.match(result.stderr, /^translation: home\.title \[en\]: provider down/)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/en.json')), false)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.failure, undefined)
  assert.strictEqual(report.policy, 'partial')
  assert.deepStrictEqual(report.failures, [{ key: 'home.title', locale: 'en', message: 'provider down' }])
})

test('a failed replacement restores every translation artifact from that run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-rollback-'))
  writeProject(root, {
    messages: { 'home.keep': '保留', 'home.title': '首页' },
    targets: { en: { 'home.keep': 'Keep me' } },
    state: {
      version: 1,
      locales: {
        en: { 'home.keep': { sourceFingerprint: fingerprintOf('保留'), review: 'current' } }
      }
    },
    config: {
      translationProvider: 'i18n/provider.js',
      targetLocales: ['en', 'fr']
    },
    provider: `module.exports = {
      translate() {
        return {
          drafts: [
            { key: 'home.title', locale: 'en', text: 'Home' },
            { key: 'home.title', locale: 'fr', text: 'Accueil' }
          ]
        }
      }
    }
    `
  })
  const catalog = path.join(root, 'lang/catalog')
  const beforeEn = fs.readFileSync(path.join(catalog, 'en.json'))
  const beforeState = fs.readFileSync(path.join(catalog, 'translation-state.json'))
  const result = runFailingReplacement(['translate', '--json'], root)
  assert.strictEqual(result.status, 6, result.stderr)
  assert.match(result.stderr, /^storage: /)
  assert.deepStrictEqual(fs.readFileSync(path.join(catalog, 'en.json')), beforeEn)
  assert.strictEqual(fs.existsSync(path.join(catalog, 'fr.json')), false)
  assert.deepStrictEqual(fs.readFileSync(path.join(catalog, 'translation-state.json')), beforeState)
  assert.deepStrictEqual(
    fs.readdirSync(catalog).filter(name => name.includes('.tmp-') || name.includes('.bak-') || name.startsWith('.commit-')),
    []
  )
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'translate')
  assert.strictEqual(report.failure, 'storage')
  assert.strictEqual(report.ok, false)
  assert.strictEqual(report.policy, undefined)
  assert.match(report.message, /simulated storage failure/)
})

test('removing a backup after a finished replacement does not undo the catalogs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-bak-'))
  writeProject(root, {
    messages: { 'home.title': '首页' },
    targets: { en: { 'home.title': 'Old' } },
    state: {
      version: 1,
      locales: {
        en: { 'home.title': { sourceFingerprint: fingerprintOf('首页'), review: 'current' } }
      }
    },
    config: {
      translationProvider: 'i18n/provider.js',
      targetLocales: ['en', 'fr']
    },
    provider: `module.exports = {
      translate() {
        return {
          drafts: [
            { key: 'home.title', locale: 'en', text: 'Home' },
            { key: 'home.title', locale: 'fr', text: 'Accueil' }
          ]
        }
      }
    }
    `
  })
  const hook = path.join(root, 'fail-backup-cleanup.js')
  fs.writeFileSync(hook, `const fs = require('fs')
const unlink = fs.unlinkSync.bind(fs)
let backups = 0
fs.unlinkSync = file => {
  if (String(file).includes('.bak-')) {
    backups += 1
    if (backups === 2) throw Object.assign(new Error('backup cleanup failed'), { code: 'EPERM' })
  }
  return unlink(file)
}
`)
  const result = spawnSync(process.execPath, ['-r', hook, bin, 'translate', '--json', '--retranslate'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
  assert.strictEqual(result.status, 0, result.stderr)
  const catalog = path.join(root, 'lang/catalog')
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(catalog, 'en.json'), 'utf8')), {
    'home.title': 'Home'
  })
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(catalog, 'fr.json'), 'utf8')), {
    'home.title': 'Accueil'
  })
  const state = JSON.parse(fs.readFileSync(path.join(catalog, 'translation-state.json'), 'utf8'))
  assert.strictEqual(state.locales.en['home.title'].review, 'current')
  assert.strictEqual(state.locales.en['home.title'].sourceFingerprint, fingerprintOf('首页'))
  assert.strictEqual(state.locales.fr['home.title'].review, 'current')
})

test('an interrupted replacement is restored before the next translation is saved', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-interrupt-'))
  writeProject(root, {
    messages: { 'home.keep': '保留', 'home.title': '首页' },
    targets: { en: { 'home.keep': 'Keep me' } },
    state: {
      version: 1,
      locales: {
        en: { 'home.keep': { sourceFingerprint: fingerprintOf('保留'), review: 'current' } }
      }
    },
    config: {
      translationProvider: 'i18n/provider.js',
      targetLocales: ['en', 'fr']
    },
    provider: `const fs = require('fs')
const path = require('path')
module.exports = {
  translate(request) {
    fs.writeFileSync(path.join(__dirname, 'sent.json'), JSON.stringify(request.items))
    const drafts = []
    for (const item of request.items) {
      for (const locale of item.locales) {
        let text = 'Home'
        if (item.key === 'home.title' && locale === 'fr') text = 'Accueil'
        if (item.key === 'home.keep') text = locale === 'fr' ? 'Garder' : 'Keep me'
        drafts.push({ key: item.key, locale, text })
      }
    }
    return { drafts }
  }
}
`
  })
  const hook = path.join(root, 'interrupt-replacement.js')
  fs.writeFileSync(hook, `const fs = require('fs')
const path = require('path')
const rename = fs.renameSync.bind(fs)
fs.renameSync = (from, to) => {
  if (String(from).includes('.tmp-') && path.basename(String(to)) === 'fr.json') process.exit(99)
  return rename(from, to)
}
`)
  const catalog = path.join(root, 'lang/catalog')
  const beforeEn = fs.readFileSync(path.join(catalog, 'en.json'))
  const beforeState = fs.readFileSync(path.join(catalog, 'translation-state.json'))
  const interrupted = spawnSync(process.execPath, ['-r', hook, bin, 'translate', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
  assert.strictEqual(interrupted.status, 99, interrupted.stderr)
  assert.deepStrictEqual(fs.readFileSync(path.join(catalog, 'en.json')), beforeEn)
  assert.deepStrictEqual(fs.readFileSync(path.join(catalog, 'translation-state.json')), beforeState)
  assert.strictEqual(fs.existsSync(path.join(catalog, 'fr.json')), false)
  assert.deepStrictEqual(fs.readdirSync(catalog).filter(name => name.includes('.tmp-') || name.includes('.bak-') || name.startsWith('.commit-')), [])

  const result = run(['translate', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const sent = JSON.parse(fs.readFileSync(path.join(root, 'i18n/sent.json'), 'utf8'))
  assert.deepStrictEqual(sent, [
    { key: 'home.keep', source: '保留', locales: ['fr'] },
    { key: 'home.title', source: '首页', locales: ['en', 'fr'] }
  ])
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(catalog, 'en.json'), 'utf8')), {
    'home.keep': 'Keep me',
    'home.title': 'Home'
  })
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(catalog, 'fr.json'), 'utf8')), {
    'home.keep': 'Garder',
    'home.title': 'Accueil'
  })
  assert.deepStrictEqual(fs.readdirSync(catalog).filter(name => name.includes('.tmp-') || name.includes('.bak-') || name.startsWith('.commit-')), [])
})

test('an unreadable commit journal fails before source text is sent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-journal-'))
  writeProject(root, {
    messages: { 'home.title': '首页' },
    targets: { en: { 'home.title': 'Old' } },
    provider: networkProvider(`return { drafts: [{ key: 'home.title', locale: 'en', text: 'Home' }] }`)
  })
  const catalog = path.join(root, 'lang/catalog')
  fs.writeFileSync(path.join(catalog, '.commit-broken.json'), '{')
  const before = fs.readFileSync(path.join(catalog, 'en.json'))
  const result = run(['translate', '--json', '--allow-network'], root)
  assert.strictEqual(result.status, 6, result.stderr)
  assert.match(result.stderr, /^storage: /)
  assert.strictEqual(fs.existsSync(path.join(root, 'i18n/sent.json')), false)
  assert.deepStrictEqual(fs.readFileSync(path.join(catalog, 'en.json')), before)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.failure, 'storage')
  assert.strictEqual(report.policy, undefined)
})

test('a piped answer does not authorize a non-interactive network provider', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-piped-'))
  writeProject(root, {
    messages: { 'home.title': '首页' },
    provider: networkProvider(`return { drafts: [{ key: 'home.title', locale: 'en', text: 'Home' }] }`)
  })
  const result = spawnSync(process.execPath, [bin, 'translate', '--json'], {
    cwd: root,
    encoding: 'utf8',
    input: 'y\n',
    env: { ...process.env, NO_COLOR: '1' }
  })
  assert.strictEqual(result.status, 5, result.stderr)
  assert.match(result.stderr, /^authorization: /)
  assert.strictEqual(fs.existsSync(path.join(root, 'i18n/sent.json')), false)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/en.json')), false)
})

test('a provider function marked network cannot send source text without authorization', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-fn-network-'))
  writeProject(root, {
    messages: { 'home.title': '首页' },
    provider: `const fs = require('fs')
const path = require('path')
function translate(request) {
  fs.writeFileSync(path.join(__dirname, 'sent.json'), JSON.stringify(request.items))
  return { drafts: [{ key: 'home.title', locale: 'en', text: 'Home' }] }
}
translate.network = true
module.exports = translate
`
  })
  const denied = run(['translate', '--json'], root)
  assert.strictEqual(denied.status, 5, denied.stderr)
  assert.strictEqual(fs.existsSync(path.join(root, 'i18n/sent.json')), false)

  const allowed = run(['translate', '--json', '--allow-network'], root)
  assert.strictEqual(allowed.status, 0, allowed.stderr)
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'i18n/sent.json'), 'utf8')), [
    { key: 'home.title', source: '首页', locales: ['en'] }
  ])
})

test('translation settings do not change the collection config hash', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-hash-'))
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')
  const plain = loadConfig({ root })
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), [
    'module.exports = {',
    '  translationProvider: "i18n/provider.js",',
    '  targetLocales: ["en"],',
    '  translationFailure: "strict"',
    '}',
    ''
  ].join('\n'))
  const configured = loadConfig({ root })
  assert.strictEqual(configured.configHash, plain.configHash)
  assert.strictEqual(configured.fileConfigHash, plain.fileConfigHash)
  assert.deepStrictEqual(configured.targetLocales, ['en'])
})
