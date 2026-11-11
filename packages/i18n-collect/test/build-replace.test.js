const assert = require('assert')
const path = require('path')
const test = require('node:test')
const { SourceMapConsumer } = require('source-map')
const { extractScript } = require('../myloader/extract-script')
const { transformBuildReplacement } = require('../mycommon/build-replace')

function occurrence(key, source, containingSource, projectPath = 'src/app.js') {
  const extracted = extractScript({
    source: containingSource,
    resource: { projectPath },
    config: {}
  }).find(entry => entry.value === source)
  assert.ok(extracted, `missing occurrence for ${source}`)
  return {
    key,
    source,
    location: {
      path: projectPath,
      kind: extracted.locations[0].kind,
      start: extracted.locations[0].start,
      end: extracted.locations[0].end
    }
  }
}

function transform(source, {
  projectPath = 'src/app.js',
  root = '/project',
  occurrences,
  runtimeModule = 'src/i18n.js',
  runtimeExport = 't'
} = {}) {
  return transformBuildReplacement({
    source,
    root,
    projectPath,
    resourcePath: path.join(root, projectPath),
    occurrences: occurrences || [occurrence('home.hello', '你好', source, projectPath)],
    adapter: 'js',
    runtimeModule,
    runtimeExport,
    styleExtensions: ['.css']
  })
}

test('ESM modules inject a named runtime import and replace supported strings', () => {
  const source = 'export function label() {\n  return "你好"\n}\n'
  const result = transform(source)
  assert.match(result.code, /import\s*\{\s*t(?:\s+as\s+\w+)?\s*\}\s*from\s*['"]\.\/i18n\.js['"]/)
  assert.match(result.code, /\bt\('home\.hello'\)/)
  assert.doesNotMatch(result.code, /"你好"/)
  assert.strictEqual(result.changed, true)
})

test('CommonJS modules inject a require binding for the runtime export', () => {
  const source = 'module.exports = function label() {\n  return "你好"\n}\n'
  const result = transform(source)
  assert.match(result.code, /const\s+\{\s*t(?:\s*:\s*\w+)?\s*\}\s*=\s*require\(['"]\.\/i18n\.js['"]\)/)
  assert.match(result.code, /\bt\('home\.hello'\)/)
  assert.strictEqual(result.changed, true)
})

test('runtime module requests are resolved relative to the current resource', () => {
  const source = 'export const label = "你好"\n'
  const result = transform(source, {
    projectPath: 'src/components/Button.js',
    occurrences: [occurrence('home.hello', '你好', source, 'src/components/Button.js')]
  })
  assert.match(result.code, /from\s*['"]\.\.\/i18n\.js['"]/)
})

test('generated helper names avoid existing bindings and stay unique for every call', () => {
  const source = [
    'const t = 1',
    'const __i18n_t = 2',
    'export function label() {',
    '  return "你好" + "世界"',
    '}',
    ''
  ].join('\n')
  const hello = occurrence('home.hello', '你好', source)
  const world = occurrence('home.world', '世界', source)
  const result = transform(source, { occurrences: [hello, world] })
  const match = result.code.match(/import\s*\{\s*t as (\w+)\s*\}/)
  assert.ok(match)
  assert.notStrictEqual(match[1], 't')
  assert.notStrictEqual(match[1], '__i18n_t')
  const calls = result.code.match(new RegExp(`${match[1]}\\('home\\.(hello|world)'\\)`, 'g')) || []
  assert.strictEqual(calls.length, 2)
})

test('existing t bindings are reused without reinjection', () => {
  const source = [
    'import { t } from "./i18n.js"',
    'export function label() {',
    '  return "你好"',
    '}',
    ''
  ].join('\n')
  const result = transform(source)
  assert.strictEqual((result.code.match(/import\s*\{/g) || []).length, 1)
  assert.match(result.code, /return t\('home\.hello'\)/)
})

test('existing localized calls are recognized without wrapping again', () => {
  const source = [
    'import { t } from "./i18n.js"',
    'export function label() {',
    '  return t("你好")',
    '}',
    ''
  ].join('\n')
  const result = transform(source, {
    occurrences: [{
      key: 'home.hello',
      source: '你好',
      location: {
        path: 'src/app.js',
        kind: 'script-string',
        start: { line: 3, column: 11 },
        end: { line: 3, column: 15 }
      }
    }]
  })
  assert.strictEqual((result.code.match(/import\s*\{/g) || []).length, 1)
  assert.match(result.code, /t\("你好"\)/)
  assert.doesNotMatch(result.code, /t\(t\(/)
  assert.strictEqual(result.changed, false)
})

test('unsupported positions are left alone', () => {
  const source = [
    'import { t } from "./i18n.js"',
    'const table = { "你好": 1 }',
    'switch (value) { case "世界": break }',
    'export const ok = "欢迎"',
    ''
  ].join('\n')
  const items = [
    occurrence('a', '你好', source),
    occurrence('b', '世界', source),
    occurrence('c', '欢迎', source)
  ]
  const result = transform(source, { occurrences: items })
  assert.match(result.code, /\{\s*"你好":\s*1\s*\}/)
  assert.match(result.code, /case "世界"/)
  assert.match(result.code, /t\('c'\)|t\("c"\)|\w+\('c'\)/)
})

test('JSX text is not silently rewritten', () => {
  const source = 'import { t } from "./i18n.js"\nexport const node = <span>{"你好"}</span>\n'
  const result = transform(source, {
    projectPath: 'src/app.jsx',
    occurrences: [occurrence('home.hello', '你好', source, 'src/app.jsx')]
  })
  assert.match(result.code, /"你好"/)
  assert.doesNotMatch(result.code, /t\('home\.hello'\)/)
})

test('existing runtimeExport bindings are reused when the export is not named t', () => {
  const source = [
    'import { translate } from "./i18n.js"',
    'export function label() {',
    '  return "你好"',
    '}',
    ''
  ].join('\n')
  const result = transform(source, { runtimeExport: 'translate' })
  assert.strictEqual((result.code.match(/import\s*\{/g) || []).length, 1)
  assert.match(result.code, /return translate\('home\.hello'\)/)
})

test('template literals replace only complete static Chinese copies', () => {
  const source = 'import { t } from "./i18n.js"\nexport const label = `你好`\n'
  const result = transform(source, {
    occurrences: [occurrence('home.hello', '你好', source)]
  })
  assert.match(result.code, /t\('home\.hello'\)/)
  assert.doesNotMatch(result.code, /`你好`/)
})

test('TypeScript syntax is accepted and rewritten', () => {
  const source = 'export function label(): string {\n  return "你好"\n}\n'
  const result = transform(source, { projectPath: 'src/app.ts' })
  assert.match(result.code, /import\s*\{\s*t(?:\s+as\s+\w+)?\s*\}/)
  assert.match(result.code, /\bt\('home\.hello'\)/)
})

test('transform emits a source map that maps generated code back to the original source', async () => {
  const source = 'export const label = "你好"\n'
  const result = transform(source)
  assert.ok(result.map)
  const consumer = await new SourceMapConsumer(result.map)
  const generatedLine = result.code.split('\n').findIndex(line => /\('home\.hello'\)/.test(line)) + 1
  const original = consumer.originalPositionFor({ line: generatedLine, column: 0 })
  assert.strictEqual(original.source, 'src/app.js')
  assert.ok(original.line >= 1)
})
