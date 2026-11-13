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
    dynamicMessageCandidates: {
      total: 0,
      needsReview: 0,
      intentionallyIgnored: 0,
      translationApproved: 0,
      deferred: 0
    },
    ...overrides
  }
}

function dynamicCandidate(overrides = {}) {
  return {
    id: 'dynamic.abc123',
    expression: '`你好${name}`',
    staticFragments: ['你好'],
    location: { path: 'src/app.js', start: { line: 1, column: 0 }, end: { line: 1, column: 8 } },
    semanticRole: 'dynamic-message',
    capability: 'explicit-localization-required',
    disposition: 'needs-review',
    diagnostic: 'Template interpolation constructs user-facing copy and cannot be safely translated as fragments.',
    ...overrides
  }
}

function cleanAnalysis(overrides = {}) {
  return {
    runtimeMessages: [],
    auditFindings: [],
    dynamicMessageCandidates: [],
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
    alreadyLocalized: 0
  })
  assert.deepStrictEqual(report.dynamicMessageCandidates, {
    total: 0,
    needsReview: 0,
    intentionallyIgnored: 0,
    translationApproved: 0,
    deferred: 0
  })
  assert.deepStrictEqual(report.chineseSourceAudit, {
    total: 0,
    unresolved: 0,
    needsReview: 0,
    intentionallyIgnored: 0
  })
  assert.deepStrictEqual(report.localeCoverage, {})
  assert.deepStrictEqual(report.warnings, [])
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

test('evaluateLocalizationCompleteness fails for unreviewed dynamic candidates with an actionable diagnostic', () => {
  const finding = dynamicCandidate()
  const analysis = cleanAnalysis({
    dynamicMessageCandidates: [finding],
    coverage: emptyCoverage({
      sourceDiscovery: { total: 1 },
      dynamicMessageCandidates: {
        total: 1,
        needsReview: 1,
        intentionallyIgnored: 0,
        translationApproved: 0,
        deferred: 0
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
  assert.ok(report.blocking.includes('unreviewed-dynamic-candidates'))
  assert.ok(!report.blocking.includes('deferred-dynamic-candidates'))
  assert.ok(!report.blocking.includes('translation-approved-dynamic-candidates'))
  assert.ok(!report.blocking.includes('needs-review-audit'))
  assert.ok(!report.blocking.includes('needs-review-translations'))
  assert.deepStrictEqual(report.runtimeLocalization, {
    automaticallyRuntimeLocalizable: 0,
    alreadyLocalized: 0
  })
  assert.deepStrictEqual(report.dynamicMessageCandidates, {
    total: 1,
    needsReview: 1,
    intentionallyIgnored: 0,
    translationApproved: 0,
    deferred: 0
  })
  assert.strictEqual(report.dynamicMessageCandidateFindings.length, 1)
  assert.deepStrictEqual(report.warnings, [])
  assert.match(report.message, /unreviewed dynamic message candidate/i)
  assert.match(report.message, /review to translate, intentionally ignore, or defer/i)
})

test('evaluateLocalizationCompleteness fails for translation-approved candidates awaiting source migration', () => {
  const finding = dynamicCandidate({
    id: 'dynamic.approved',
    disposition: 'translation-approved',
    key: 'upload.greeting'
  })
  const analysis = cleanAnalysis({
    dynamicMessageCandidates: [finding],
    coverage: emptyCoverage({
      sourceDiscovery: { total: 1 },
      dynamicMessageCandidates: {
        total: 1,
        needsReview: 0,
        intentionallyIgnored: 0,
        translationApproved: 1,
        deferred: 0
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
  assert.deepStrictEqual(report.blocking, ['translation-approved-dynamic-candidates'])
  assert.deepStrictEqual(report.dynamicMessageCandidates, {
    total: 1,
    needsReview: 0,
    intentionallyIgnored: 0,
    translationApproved: 1,
    deferred: 0
  })
  assert.deepStrictEqual(report.warnings, [])
  assert.match(report.message, /translation-approved dynamic message candidate/i)
  assert.match(report.message, /awaiting source migration|migrate source/i)
})

test('evaluateLocalizationCompleteness fails for deferred candidates by default', () => {
  const finding = dynamicCandidate({
    id: 'dynamic.deferred',
    decision: 'defer',
    deferReason: 'waiting on copy'
  })
  const analysis = cleanAnalysis({
    dynamicMessageCandidates: [finding],
    coverage: emptyCoverage({
      sourceDiscovery: { total: 1 },
      dynamicMessageCandidates: {
        total: 1,
        needsReview: 1,
        intentionallyIgnored: 0,
        translationApproved: 0,
        deferred: 1
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
  assert.deepStrictEqual(report.blocking, ['deferred-dynamic-candidates'])
  assert.deepStrictEqual(report.dynamicMessageCandidates, {
    total: 1,
    needsReview: 1,
    intentionallyIgnored: 0,
    translationApproved: 0,
    deferred: 1
  })
  assert.deepStrictEqual(report.warnings, [])
  assert.match(report.message, /deferred dynamic message candidate/i)
})

test('evaluateLocalizationCompleteness can warn for deferred candidates without waiving never-reviewed ones', () => {
  const deferred = dynamicCandidate({
    id: 'dynamic.deferred',
    decision: 'defer',
    deferReason: 'waiting on copy'
  })
  const unreviewed = dynamicCandidate({
    id: 'dynamic.unreviewed',
    expression: '`再见${name}`',
    staticFragments: ['再见']
  })
  const analysis = cleanAnalysis({
    dynamicMessageCandidates: [deferred, unreviewed],
    coverage: emptyCoverage({
      sourceDiscovery: { total: 2 },
      dynamicMessageCandidates: {
        total: 2,
        needsReview: 2,
        intentionallyIgnored: 0,
        translationApproved: 0,
        deferred: 1
      }
    })
  })
  const report = evaluateLocalizationCompleteness({
    analysis,
    committedSourceCatalog: {},
    targetLocales: [],
    targets: {},
    reviewState: { version: 1, locales: {} },
    deferredDynamicCandidates: 'warn'
  })
  assert.strictEqual(report.ok, false)
  assert.deepStrictEqual(report.blocking, ['unreviewed-dynamic-candidates'])
  assert.strictEqual(report.warnings.length, 1)
  assert.strictEqual(report.warnings[0].code, 'deferred-dynamic-candidates')
  assert.match(report.warnings[0].message, /deferred dynamic message candidate/i)
  assert.match(report.message, /unreviewed dynamic message candidate/i)
  assert.ok(!/deferred dynamic message candidate/i.test(report.message))
})

test('evaluateLocalizationCompleteness passes with deferred warnings when policy is warn and nothing else blocks', () => {
  const deferred = dynamicCandidate({
    id: 'dynamic.deferred',
    decision: 'defer',
    deferReason: 'waiting on copy'
  })
  const analysis = cleanAnalysis({
    dynamicMessageCandidates: [deferred],
    coverage: emptyCoverage({
      sourceDiscovery: { total: 1 },
      dynamicMessageCandidates: {
        total: 1,
        needsReview: 1,
        intentionallyIgnored: 0,
        translationApproved: 0,
        deferred: 1
      }
    })
  })
  const report = evaluateLocalizationCompleteness({
    analysis,
    committedSourceCatalog: {},
    targetLocales: [],
    targets: {},
    reviewState: { version: 1, locales: {} },
    deferredDynamicCandidates: 'warn'
  })
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.blocking, [])
  assert.strictEqual(report.warnings.length, 1)
  assert.strictEqual(report.warnings[0].code, 'deferred-dynamic-candidates')
})

test('evaluateLocalizationCompleteness does not block intentionally ignored dynamic candidates', () => {
  const ignored = dynamicCandidate({
    id: 'dynamic.ignored',
    disposition: 'intentionally-ignored',
    ignoreReason: 'China-only legal notice'
  })
  const analysis = cleanAnalysis({
    dynamicMessageCandidates: [ignored],
    coverage: emptyCoverage({
      sourceDiscovery: { total: 1 },
      dynamicMessageCandidates: {
        total: 1,
        needsReview: 0,
        intentionallyIgnored: 1,
        translationApproved: 0,
        deferred: 0
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
  assert.deepStrictEqual(report.warnings, [])
  assert.deepStrictEqual(report.dynamicMessageCandidates, {
    total: 1,
    needsReview: 0,
    intentionallyIgnored: 1,
    translationApproved: 0,
    deferred: 0
  })
})

test('evaluateLocalizationCompleteness keeps audit and translation needs-review distinct from dynamic candidates', () => {
  const unreviewed = dynamicCandidate()
  const auditNeedsReview = {
    text: '待审',
    location: { path: 'src/theme.scss', start: { line: 1, column: 20 }, end: { line: 1, column: 22 } },
    semanticRole: 'css-preprocessor-candidate',
    capability: 'chinese-source-audit',
    disposition: 'needs-review'
  }
  const key = keyFor('标题')
  const previous = fingerprintOf('旧标题')
  const analysis = cleanAnalysis({
    dynamicMessageCandidates: [unreviewed],
    auditFindings: [auditNeedsReview],
    runtimeMessages: [{
      text: '标题',
      key,
      location: { path: 'src/title.js', start: { line: 1, column: 0 }, end: { line: 1, column: 2 } },
      semanticRole: 'script-string',
      capability: 'automatically-runtime-localizable'
    }],
    coverage: emptyCoverage({
      sourceDiscovery: { total: 3 },
      runtimeLocalization: {
        total: 1,
        automaticallyRuntimeLocalizable: 1,
        alreadyLocalized: 0
      },
      chineseSourceAudit: {
        total: 1,
        unresolved: 0,
        needsReview: 1,
        intentionallyIgnored: 0
      },
      dynamicMessageCandidates: {
        total: 1,
        needsReview: 1,
        intentionallyIgnored: 0,
        translationApproved: 0,
        deferred: 0
      }
    })
  })
  const report = evaluateLocalizationCompleteness({
    analysis,
    committedSourceCatalog: { [key]: '标题' },
    targetLocales: ['en'],
    targets: { en: { [key]: 'Title' } },
    reviewState: {
      version: 1,
      locales: {
        en: { [key]: { sourceFingerprint: previous, review: 'current' } }
      }
    }
  })
  assert.strictEqual(report.ok, false)
  assert.ok(report.blocking.includes('unreviewed-dynamic-candidates'))
  assert.ok(report.blocking.includes('needs-review-audit'))
  assert.ok(report.blocking.includes('needs-review-translations'))
  assert.ok(!report.blocking.includes('dynamic-message-candidates'))
  assert.match(report.message, /unreviewed dynamic message candidate/i)
  assert.match(report.message, /needs-review Chinese source audit finding/i)
  assert.match(report.message, /needs-review translation/i)
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
    alreadyLocalized: 1
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
