const assert = require('assert')
const test = require('node:test')
const { extractScript } = require('../myloader/extract-script')
const { keyFor } = require('../mycommon/store')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  occurrencesForReplacement,
  prepareCompilationBuildReplacement
} = require('../mycommon/build-replacement-findings')
const {
  clearBuildReplacementContext,
  getBuildReplacementContext,
  prepareBuildReplacementContext
} = require('../mycommon/build-replacement-context')
const { loadConfig } = require('../mycommon/config')
const { json } = require('../mycommon/output')
const { analyzeSnapshots, buildSourceCatalog } = require('../mycommon/project-analysis')
const {
  planReplacementForModule,
  applyModuleReplacement
} = require('../mycommon/replacement-planner')
const { verifyCommittedCatalogAgainstCompilation } = require('../mycommon/source-catalog-freshness')
const { transformBuildReplacement } = require('../mycommon/build-replace')

function runtimeFinding(text, extras = {}) {
  return {
    text,
    key: keyFor(text),
    location: {
      path: extras.path || 'src/app.js',
      start: extras.start || { line: 1, column: 20 },
      end: extras.end || { line: 1, column: 22 }
    },
    semanticRole: extras.semanticRole || 'script-string',
    capability: extras.capability || 'automatically-runtime-localizable',
    ...extras.rest
  }
}

function scriptEntries(containingSource, projectPath) {
  if (!/\.vue$/i.test(projectPath)) {
    return extractScript({
      source: containingSource,
      resource: { projectPath },
      config: {}
    })
  }
  const entries = []
  const pattern = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi
  let match = pattern.exec(containingSource)
  while (match) {
    const openTag = match[0].slice(0, match[0].length - match[2].length - '</script>'.length)
    const innerStart = match.index + openTag.length
    const padded = `${containingSource.slice(0, innerStart).replace(/[^\n]/g, ' ')}${match[2]}`
    entries.push(...extractScript({
      source: padded,
      resource: { projectPath },
      config: {}
    }))
    match = pattern.exec(containingSource)
  }
  return entries
}

function scriptOccurrence(key, source, containingSource, projectPath = 'src/app.js') {
  const extracted = scriptEntries(containingSource, projectPath)
    .find(entry => entry.value === source)
  assert.ok(extracted, `missing occurrence for ${source}`)
  return {
    key,
    source,
    location: {
      path: projectPath,
      kind: extracted.locations[0].kind,
      start: extracted.locations[0].start,
      end: extracted.locations[0].end
    },
    status: 'active',
    reportedAmbiguity: false
  }
}

test('occurrencesForReplacement maps compilation runtime findings to replacement occurrences', () => {
  const analysis = {
    runtimeMessages: [
      runtimeFinding('你好'),
      runtimeFinding('世界', {
        path: 'src/Home.vue',
        semanticRole: 'script-string',
        start: { line: 3, column: 10 },
        end: { line: 3, column: 12 }
      })
    ],
    auditFindings: []
  }

  const occurrences = occurrencesForReplacement(analysis)

  assert.deepStrictEqual(occurrences, [
    {
      key: keyFor('你好'),
      source: '你好',
      location: {
        path: 'src/app.js',
        kind: 'script-string',
        start: { line: 1, column: 20 },
        end: { line: 1, column: 22 }
      },
      status: 'active',
      reportedAmbiguity: false
    },
    {
      key: keyFor('世界'),
      source: '世界',
      location: {
        path: 'src/Home.vue',
        kind: 'script-string',
        start: { line: 3, column: 10 },
        end: { line: 3, column: 12 }
      },
      status: 'active',
      reportedAmbiguity: false
    }
  ])
})

test('occurrencesForReplacement omits audit findings and standalone HTML or CSS kinds', () => {
  const analysis = {
    runtimeMessages: [
      runtimeFinding('欢迎'),
      runtimeFinding('页脚', {
        path: 'public/index.html',
        semanticRole: 'static-html-text'
      }),
      runtimeFinding('徽章', {
        path: 'src/badge.css',
        semanticRole: 'css-generated-content'
      }),
      runtimeFinding('标题', {
        path: 'public/about.html',
        semanticRole: 'static-html-attribute'
      })
    ],
    auditFindings: [
      runtimeFinding('样式', {
        path: 'src/badge.css',
        semanticRole: 'css-generated-content',
        capability: 'chinese-source-audit',
        rest: { disposition: 'unresolved' }
      })
    ]
  }

  const occurrences = occurrencesForReplacement(analysis)

  assert.strictEqual(occurrences.length, 1)
  assert.strictEqual(occurrences[0].source, '欢迎')
  assert.strictEqual(occurrences[0].location.kind, 'script-string')
})

test('js adapter replaces when t is already in scope and never invents an import', () => {
  const source = 'import { t } from "./i18n.js"\nexport function label() {\n  return "你好"\n}\n'
  const planned = planReplacementForModule({
    adapter: 'js',
    projectPath: 'src/app.js',
    source,
    occurrences: [scriptOccurrence('home.hello', '你好', source)]
  })

  assert.strictEqual(planned.skipped.length, 0)
  assert.strictEqual(planned.replacements[0].call, "t('home.hello')")
  assert.strictEqual(planned.injected, false)

  const applied = applyModuleReplacement({ source, planned })
  assert.match(applied.code, /\bt\('home\.hello'\)/)
  assert.doesNotMatch(applied.code, /"你好"/)
  assert.strictEqual((applied.code.match(/from\s*['"]\.\/i18n\.js['"]/g) || []).length, 1)
})

test('js adapter skips when t is not in scope instead of injecting a helper', () => {
  const source = 'export function label() {\n  return "你好"\n}\n'
  const planned = planReplacementForModule({
    adapter: 'js',
    projectPath: 'src/app.js',
    source,
    occurrences: [scriptOccurrence('home.hello', '你好', source)]
  })

  assert.strictEqual(planned.replacements.length, 0)
  assert.strictEqual(planned.skipped.length, 1)
  assert.match(planned.skipped[0].reason, /requires t to already be in scope/)
  assert.strictEqual(planned.injected, false)

  const applied = applyModuleReplacement({ source, planned })
  assert.strictEqual(applied.code, source)
  assert.strictEqual(applied.changed, false)
})

test('vue3 adapter uses t when present and does not inject a runtime import', () => {
  const source = [
    '<script setup>',
    'import { t } from "./i18n.js"',
    'const title = "你好"',
    '</script>',
    ''
  ].join('\n')
  const planned = planReplacementForModule({
    adapter: 'vue3',
    projectPath: 'src/Home.vue',
    source,
    occurrences: [scriptOccurrence('home.hello', '你好', source, 'src/Home.vue')]
  })

  assert.strictEqual(planned.skipped.length, 0)
  assert.strictEqual(planned.replacements[0].call, "t('home.hello')")
  assert.strictEqual(planned.injected, false)

  const applied = applyModuleReplacement({ source, planned })
  assert.match(applied.code, /\bt\('home\.hello'\)/)
  assert.strictEqual((applied.code.match(/from\s*['"]\.\/i18n\.js['"]/g) || []).length, 1)
})

test('vue2 adapter requires a component instance method and does not inject helpers', () => {
  const source = [
    '<script>',
    'export default {',
    '  methods: {',
    '    label() { return "你好" }',
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
  const planned = planReplacementForModule({
    adapter: 'vue2',
    projectPath: 'src/Home.vue',
    source,
    occurrences: [scriptOccurrence('home.hello', '你好', source, 'src/Home.vue')]
  })

  assert.strictEqual(planned.replacements.length, 1)
  assert.match(planned.replacements[0].call, /\$t\('home\.hello'\)|this\.\$t\('home\.hello'\)/)
  assert.strictEqual(planned.injected, false)
})

test('prepareBuildReplacementContext stores compilation occurrences for the loader', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-ctx-'))
  try {
    const analysis = {
      runtimeMessages: [
        runtimeFinding('你好'),
        runtimeFinding('页脚', {
          path: 'public/index.html',
          semanticRole: 'static-html-text'
        })
      ],
      auditFindings: []
    }
    const sourceCatalog = {
      version: 1,
      messages: { [keyFor('你好')]: '你好' }
    }

    const prepared = prepareBuildReplacementContext(root, {
      analysis,
      sourceCatalog
    })

    assert.strictEqual(prepared.occurrences.length, 1)
    assert.strictEqual(prepared.occurrences[0].source, '你好')
    assert.deepStrictEqual(prepared.sourceCatalog, sourceCatalog)

    const loaded = getBuildReplacementContext(root)
    assert.ok(loaded)
    assert.deepStrictEqual(loaded.occurrences, prepared.occurrences)
    assert.deepStrictEqual(loaded.sourceCatalog, sourceCatalog)
  } finally {
    clearBuildReplacementContext(root)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('verifyCommittedCatalogAgainstCompilation accepts matching compilation catalogs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-verify-catalog-'))
  try {
    fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
    fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')
    const key = keyFor('你好')
    const catalog = { version: 1, messages: { [key]: '你好' } }
    fs.writeFileSync(path.join(root, 'lang/catalog/source-catalog.json'), json(catalog))
    const config = loadConfig({ root })
    const analysis = {
      runtimeMessages: [runtimeFinding('你好')],
      auditFindings: []
    }

    const verified = verifyCommittedCatalogAgainstCompilation(root, config, {
      analysis,
      sourceCatalog: catalog
    })

    assert.strictEqual(verified.occurrences.length, 1)
    assert.strictEqual(verified.occurrences[0].source, '你好')
    assert.strictEqual(verified.sourceCatalog[key], '你好')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('verifyCommittedCatalogAgainstCompilation fails when compilation catalog differs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-verify-catalog-'))
  try {
    fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
    fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')
    fs.writeFileSync(
      path.join(root, 'lang/catalog/source-catalog.json'),
      json({ version: 1, messages: { [keyFor('你好')]: '你好' } })
    )
    const config = loadConfig({ root })

    assert.throws(
      () => verifyCommittedCatalogAgainstCompilation(root, config, {
        analysis: {
          runtimeMessages: [runtimeFinding('世界')],
          auditFindings: []
        },
        sourceCatalog: { version: 1, messages: { [keyFor('世界')]: '世界' } }
      }),
      /no longer matches the committed source catalog|differs from the committed source catalog/
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('prepareCompilationBuildReplacement verifies catalog and publishes compilation occurrences', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-prep-comp-'))
  try {
    fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
    fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')
    const source = 'const { t } = require("./i18n.js")\nmodule.exports = () => "你好"\n'
    const snapshot = {
      identity: 'src/app.js::script',
      projectPath: 'src/app.js',
      entries: extractScript({
        source,
        resource: { projectPath: 'src/app.js', identity: 'src/app.js::script' },
        config: {}
      })
    }
    const analysis = analyzeSnapshots([snapshot], {})
    const catalog = buildSourceCatalog(analysis)
    fs.writeFileSync(path.join(root, 'lang/catalog/source-catalog.json'), json(catalog))
    const config = loadConfig({ root })

    const prepared = prepareCompilationBuildReplacement(root, config, {
      analysis,
      sourceCatalog: catalog,
      snapshots: [snapshot]
    })

    assert.ok(prepared.occurrences.length >= 1)
    assert.strictEqual(prepared.occurrences[0].source, '你好')
    const context = getBuildReplacementContext(root)
    assert.deepStrictEqual(context.occurrences, prepared.occurrences)
  } finally {
    clearBuildReplacementContext(root)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('transformBuildReplacement consumes occurrences without injecting runtime imports', () => {
  const source = 'import { t } from "./i18n.js"\nexport function label() {\n  return "你好"\n}\n'
  const occurrence = scriptOccurrence(keyFor('你好'), '你好', source)
  const result = transformBuildReplacement({
    source,
    root: '/project',
    projectPath: 'src/app.js',
    resourcePath: '/project/src/app.js',
    occurrences: [occurrence],
    adapter: 'js',
    runtimeModule: 'src/i18n.js',
    runtimeExport: 't',
    styleExtensions: []
  })

  assert.strictEqual(result.error, undefined)
  assert.strictEqual(result.changed, true)
  assert.strictEqual(result.injected, false)
  assert.match(result.code, /\bt\('/)
  assert.doesNotMatch(result.code, /"你好"/)
  assert.strictEqual((result.code.match(/from\s*['"]\.\/i18n\.js['"]/g) || []).length, 1)
})

test('strict replacement fails closed when t is missing from scope', () => {
  const source = 'export function label() {\n  return "你好"\n}\n'
  const occurrence = scriptOccurrence(keyFor('你好'), '你好', source)
  const result = transformBuildReplacement({
    source,
    root: '/project',
    projectPath: 'src/app.js',
    resourcePath: '/project/src/app.js',
    occurrences: [occurrence],
    adapter: 'js',
    runtimeModule: 'src/i18n.js',
    runtimeExport: 't',
    styleExtensions: [],
    strict: true
  })

  assert.ok(result.error)
  assert.strictEqual(result.error.name, 'BuildReplacementError')
  assert.ok(result.error.occurrences.length >= 1)
  assert.match(result.error.occurrences[0].reason, /requires t to already be in scope/)
  assert.strictEqual(result.code, source)
})
