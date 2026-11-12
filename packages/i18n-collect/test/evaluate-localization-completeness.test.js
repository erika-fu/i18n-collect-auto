const assert = require('assert')
const test = require('node:test')
const { fingerprintOf } = require('../mycommon/catalog')
const { keyFor } = require('../mycommon/store')
const {
  evaluateLocalizationCompleteness
} = require('../mycommon/evaluate-localization-completeness')

function emptyCoverage(overrides = {}) {
  return {
    sourceDiscovery: { total: 0 },
    runtimeLocalization: {
      total: 0,
      automaticallyRuntimeLocalizable: 0,
      alreadyLocalized: 0
    },
    chineseSourceAudit: {
      total: 0,
      unresolved: 0,
      needsReview: 0,
      intentionallyIgnored: 0
    },
    explicitRequired: { total: 0 },
    ...overrides
  }
}

function cleanAnalysis(overrides = {}) {
  return {
    runtimeMessages: [],
    auditFindings: [],
    explicitRequiredFindings: [],
    localizedCallFindings: [],
    coverage: emptyCoverage(),
    ...overrides
  }
}

test('evaluateLocalizationCompleteness passes when analysis is clean and source catalog matches', () => {
  const analysis = cleanAnalysis()
  const report = evaluateLocalizationCompleteness({
    analysis,
    committedSourceCatalog: {},
    targetLocales: [],
    targets: {},
    reviewState: { version: 1, locales: {} }
  })
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.blocking, [])
  assert.deepStrictEqual(report.runtimeLocalization, {
    automaticallyRuntimeLocalizable: 0,
    alreadyLocalized: 0,
    explicitRequired: 0
  })
  assert.deepStrictEqual(report.chineseSourceAudit, {
    total: 0,
    unresolved: 0,
    needsReview: 0,
    intentionallyIgnored: 0
  })
  assert.deepStrictEqual(report.localeCoverage, {})
  assert.strictEqual(report.sourceFreshness.ok, true)
})

test('evaluateLocalizationCompleteness fails when committed source catalog is stale', () => {
  const text = '你好'
  const key = keyFor(text)
  const analysis = cleanAnalysis({
    runtimeMessages: [{
      text,
      key,
      location: { path: 'src/app.js', start: { line: 1, column: 0 }, end: { line: 1, column: 2 } },
      semanticRole: 'script-string',
      capability: 'automatically-runtime-localizable'
    }],
    coverage: emptyCoverage({
      sourceDiscovery: { total: 1 },
      runtimeLocalization: {
        total: 1,
        automaticallyRuntimeLocalizable: 1,
        alreadyLocalized: 0
      }
    })
  })
  const report = evaluateLocalizationCompleteness({
    analysis,
    committedSourceCatalog: {},
    targetLocales: [],
    targets: {},
    reviewState: { version: 1, locales: {} }
  })
  assert.strictEqual(report.ok, false)
  assert.ok(report.blocking.includes('stale-source-analysis'))
  assert.strictEqual(report.sourceFreshness.ok, false)
  assert.match(report.message, /run collect/i)
})

test('evaluateLocalizationCompleteness fails for missing committed source catalog', () => {
  const report = evaluateLocalizationCompleteness({
    analysis: cleanAnalysis(),
    committedSourceCatalog: null,
    targetLocales: [],
    targets: {},
    reviewState: { version: 1, locales: {} }
  })
  assert.strictEqual(report.ok, false)
  assert.ok(report.blocking.includes('missing-source-catalog'))
  assert.match(report.message, /run collect/i)
})

test('evaluateLocalizationCompleteness fails for explicit-required messages', () => {
  const finding = {
    text: '你好${name}',
    location: { path: 'src/app.js', start: { line: 1, column: 0 }, end: { line: 1, column: 8 } },
    semanticRole: 'script-string',
    capability: 'explicit-required',
    reason: 'interpolation'
  }
  const analysis = cleanAnalysis({
    explicitRequiredFindings: [finding],
    coverage: emptyCoverage({
      sourceDiscovery: { total: 1 },
      explicitRequired: { total: 1 }
    })
  })
  const report = evaluateLocalizationCompleteness({
    analysis,
    committedSourceCatalog: {},
    targetLocales: [],
    targets: {},
    reviewState: { version: 1, locales: {} }
  })
  assert.strictEqual(report.ok, false)
  assert.ok(report.blocking.includes('explicit-required'))
  assert.deepStrictEqual(report.runtimeLocalization, {
    automaticallyRuntimeLocalizable: 0,
    alreadyLocalized: 0,
    explicitRequired: 1
  })
  assert.strictEqual(report.explicitRequiredFindings.length, 1)
  assert.match(report.message, /explicit-required|explicit-messages/i)
})

test('evaluateLocalizationCompleteness fails for unresolved and needs-review audit findings', () => {
  const unresolved = {
    text: '未忽略',
    location: { path: 'public/index.html', start: { line: 1, column: 0 }, end: { line: 1, column: 3 } },
    semanticRole: 'static-html-text',
    capability: 'chinese-source-audit',
    disposition: 'unresolved'
  }
  const needsReview = {
    text: '待审',
    location: { path: 'src/theme.scss', start: { line: 1, column: 20 }, end: { line: 1, column: 22 } },
    semanticRole: 'css-preprocessor-candidate',
    capability: 'chinese-source-audit',
    disposition: 'needs-review'
  }
  const analysis = cleanAnalysis({
    auditFindings: [unresolved, needsReview],
    coverage: emptyCoverage({
      sourceDiscovery: { total: 2 },
      chineseSourceAudit: {
        total: 2,
        unresolved: 1,
        needsReview: 1,
        intentionallyIgnored: 0
      }
    })
  })
  const report = evaluateLocalizationCompleteness({
    analysis,
    committedSourceCatalog: {},
    targetLocales: [],
    targets: {},
    reviewState: { version: 1, locales: {} }
  })
  assert.strictEqual(report.ok, false)
  assert.ok(report.blocking.includes('unresolved-audit'))
  assert.ok(report.blocking.includes('needs-review-audit'))
  assert.deepStrictEqual(report.chineseSourceAudit, {
    total: 2,
    unresolved: 1,
    needsReview: 1,
    intentionallyIgnored: 0
  })
})

test('evaluateLocalizationCompleteness treats reasoned ignores as disposed and still visible', () => {
  const ignored = {
    text: '版权所有',
    location: { path: 'public/index.html', start: { line: 2, column: 0 }, end: { line: 2, column: 4 } },
    semanticRole: 'static-html-text',
    capability: 'chinese-source-audit',
    disposition: 'intentionally-ignored',
    ignoreReason: 'legal copy stays Chinese'
  }
  const analysis = cleanAnalysis({
    auditFindings: [ignored],
    coverage: emptyCoverage({
      sourceDiscovery: { total: 1 },
      chineseSourceAudit: {
        total: 1,
        unresolved: 0,
        needsReview: 0,
        intentionallyIgnored: 1
      }
    })
  })
  const report = evaluateLocalizationCompleteness({
    analysis,
    committedSourceCatalog: {},
    targetLocales: [],
    targets: {},
    reviewState: { version: 1, locales: {} }
  })
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.blocking, [])
  assert.strictEqual(report.chineseSourceAudit.intentionallyIgnored, 1)
  assert.strictEqual(report.auditFindings[0].ignoreReason, 'legal copy stays Chinese')
})

test('evaluateLocalizationCompleteness reports runtime buckets separately including already localized', () => {
  const autoKey = keyFor('自动')
  const analysis = cleanAnalysis({
    runtimeMessages: [{
      text: '自动',
      key: autoKey,
      location: { path: 'src/a.js', start: { line: 1, column: 0 }, end: { line: 1, column: 2 } },
      semanticRole: 'script-string',
      capability: 'automatically-runtime-localizable'
    }],
    localizedCallFindings: [{
      text: '已本地化',
      key: 'home.title',
      source: '已本地化',
      location: { path: 'src/b.js', start: { line: 1, column: 0 }, end: { line: 1, column: 4 } },
      semanticRole: 'script-string',
      capability: 'already-localized'
    }],
    coverage: emptyCoverage({
      sourceDiscovery: { total: 2 },
      runtimeLocalization: {
        total: 2,
        automaticallyRuntimeLocalizable: 1,
        alreadyLocalized: 1
      }
    })
  })
  const catalog = {
    [autoKey]: '自动',
    'home.title': '已本地化'
  }
  const report = evaluateLocalizationCompleteness({
    analysis,
    committedSourceCatalog: catalog,
    targetLocales: [],
    targets: {},
    reviewState: { version: 1, locales: {} }
  })
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.runtimeLocalization, {
    automaticallyRuntimeLocalizable: 1,
    alreadyLocalized: 1,
    explicitRequired: 0
  })
})

test('evaluateLocalizationCompleteness fails for missing and needs-review translations', () => {
  const key = keyFor('标题')
  const previous = fingerprintOf('旧标题')
  const analysis = cleanAnalysis({
    runtimeMessages: [{
      text: '标题',
      key,
      location: { path: 'src/app.js', start: { line: 1, column: 0 }, end: { line: 1, column: 2 } },
      semanticRole: 'script-string',
      capability: 'automatically-runtime-localizable'
    }],
    coverage: emptyCoverage({
      sourceDiscovery: { total: 1 },
      runtimeLocalization: {
        total: 1,
        automaticallyRuntimeLocalizable: 1,
        alreadyLocalized: 0
      }
    })
  })
  const catalog = { [key]: '标题' }
  const report = evaluateLocalizationCompleteness({
    analysis,
    committedSourceCatalog: catalog,
    targetLocales: ['en', 'fr'],
    targets: {
      en: {},
      fr: { [key]: 'Titre' }
    },
    reviewState: {
      version: 1,
      locales: {
        fr: { [key]: { sourceFingerprint: previous, review: 'current' } }
      }
    }
  })
  assert.strictEqual(report.ok, false)
  assert.ok(report.blocking.includes('missing-translations'))
  assert.ok(report.blocking.includes('needs-review-translations'))
  assert.deepStrictEqual(report.localeCoverage.en, {
    translated: [],
    missing: [key],
    needsReview: [],
    stale: []
  })
  assert.deepStrictEqual(report.localeCoverage.fr, {
    translated: [],
    missing: [],
    needsReview: [key],
    stale: []
  })
  assert.deepStrictEqual(report.missingTranslations, [{ key, locale: 'en' }])
  assert.deepStrictEqual(report.needsReviewTranslations, [{ key, locale: 'fr' }])
})

test('evaluateLocalizationCompleteness reports stale target keys without failing', () => {
  const live = keyFor('在线')
  const analysis = cleanAnalysis({
    runtimeMessages: [{
      text: '在线',
      key: live,
      location: { path: 'src/app.js', start: { line: 1, column: 0 }, end: { line: 1, column: 2 } },
      semanticRole: 'script-string',
      capability: 'automatically-runtime-localizable'
    }],
    coverage: emptyCoverage({
      sourceDiscovery: { total: 1 },
      runtimeLocalization: {
        total: 1,
        automaticallyRuntimeLocalizable: 1,
        alreadyLocalized: 0
      }
    })
  })
  const catalog = { [live]: '在线' }
  const fp = fingerprintOf('在线')
  const report = evaluateLocalizationCompleteness({
    analysis,
    committedSourceCatalog: catalog,
    targetLocales: ['en'],
    targets: {
      en: {
        [live]: 'Online',
        'home.stale': 'Stale'
      }
    },
    reviewState: {
      version: 1,
      locales: {
        en: {
          [live]: { sourceFingerprint: fp, review: 'current' },
          'home.stale': { sourceFingerprint: fingerprintOf('旧文案'), review: 'current' }
        }
      }
    }
  })
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.blocking, [])
  assert.deepStrictEqual(report.localeCoverage.en, {
    translated: [live],
    missing: [],
    needsReview: [],
    stale: ['home.stale']
  })
  assert.deepStrictEqual(report.staleTargetKeys, [{ key: 'home.stale', locale: 'en' }])
})
