const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { SourceMapConsumer } = require('source-map')
const { extractScript } = require('../myloader/extract-script')
const { extractHtml } = require('../myloader/extract-html')
const { extractVueScript } = require('../myloader/extract-vue-compat')
const { transformBuildReplacement } = require('../mycommon/build-replace')
const { installVue2 } = require('./vue2-fixture')
const { installVue3 } = require('./vue3-fixture')

const ALLOW = ['title', 'placeholder', 'alt', 'aria-label', 'value']

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

test('unsupported positions fail closed without applying partial edits', () => {
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
  assert.ok(result.error)
  assert.strictEqual(result.changed, false)
  assert.strictEqual(result.code, source)
  const reasons = result.error.occurrences.map(item => ({ key: item.key, reason: item.reason }))
  assert.deepStrictEqual(reasons, [
    { key: 'a', reason: 'object key is not a supported semantic position' },
    { key: 'b', reason: 'switch case is not a supported semantic position' }
  ])
  for (const item of result.error.occurrences) {
    assert.strictEqual(item.path, 'src/app.js')
    assert.ok(item.kind)
    assert.ok(item.source)
    assert.ok(item.start)
    assert.ok(item.end)
    assert.ok(item.reason)
  }
})

test('JSX occurrences fail the build replacement instead of keeping Chinese', () => {
  const source = 'import { t } from "./i18n.js"\nexport const node = <span>{"你好"}</span>\n'
  const result = transform(source, {
    projectPath: 'src/app.jsx',
    occurrences: [occurrence('home.hello', '你好', source, 'src/app.jsx')]
  })
  assert.ok(result.error)
  assert.strictEqual(result.changed, false)
  assert.strictEqual(result.code, source)
  assert.strictEqual(result.error.occurrences.length, 1)
  assert.strictEqual(result.error.occurrences[0].reason, 'React JSX is outside replacement scope')
  assert.strictEqual(result.error.occurrences[0].key, 'home.hello')
  assert.strictEqual(result.error.occurrences[0].path, 'src/app.jsx')
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

function vueScriptEntries(projectPath, source) {
  const resource = { projectPath }
  const entries = []
  const pattern = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi
  let match = pattern.exec(source)
  while (match) {
    const openTag = match[0].slice(0, match[0].length - match[2].length - '</script>'.length)
    const innerStart = match.index + openTag.length
    const padded = `${source.slice(0, innerStart).replace(/[^\n]/g, ' ')}${match[2]}`
    entries.push(...extractScript({ source: padded, resource, config: {} }))
    match = pattern.exec(source)
  }
  if (entries.length === 0) {
    entries.push(...extractVueScript({ source, resource, config: {} }))
  }
  return entries
}

function vueOccurrences(projectPath, source, keys) {
  const resource = { projectPath }
  const html = extractHtml({
    source,
    resource: { ...resource, block: 'template', lang: 'html', query: '?vue&type=template' },
    config: { attributeAllowlist: ALLOW }
  }).entries
  const script = vueScriptEntries(projectPath, source)
  const entries = [...html, ...script]
  return Object.entries(keys).map(([text, key]) => {
    const entry = entries.find(item => (
      item.value === text
      || (item.representation === 'localized-call' && item.key === text)
    ))
    assert.ok(entry, `missing collected text ${text}`)
    return {
      key,
      source: text,
      location: {
        path: projectPath,
        kind: entry.locations[0].kind,
        start: entry.locations[0].start,
        end: entry.locations[0].end
      }
    }
  })
}

function transformVue(source, {
  projectPath = 'src/Home.vue',
  root,
  occurrences,
  runtimeModule = 'src/i18n.js',
  runtimeExport = 't'
} = {}) {
  const projectRoot = root || fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-vue-'))
  installVue3(projectRoot)
  return transformBuildReplacement({
    source,
    root: projectRoot,
    projectPath,
    resourcePath: path.join(projectRoot, projectPath),
    occurrences: occurrences || vueOccurrences(projectPath, source, { 欢迎: 'home.welcome' }),
    adapter: 'vue3',
    runtimeModule,
    runtimeExport,
    styleExtensions: ['.css']
  })
}

test('Vue 3 build replacement rewrites template text to $t before vue-loader would split the SFC', () => {
  const source = [
    '<template>',
    '  <p>欢迎</p>',
    '</template>',
    '<script>',
    'export default {}',
    '</script>',
    ''
  ].join('\n')
  const result = transformVue(source)
  assert.strictEqual(result.changed, true)
  assert.match(result.code, /\{\{\s*\$t\('home\.welcome'\)\s*\}\}/)
  assert.doesNotMatch(result.code, />欢迎</)
})

test('Vue 3 build replacement rewrites Options API methods with this.$t', () => {
  const source = [
    '<template><p>欢迎</p></template>',
    '<script>',
    'export default {',
    '  methods: {',
    '    greet() {',
    "      return '你好'",
    '    }',
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
  const result = transformVue(source, {
    occurrences: vueOccurrences('src/Home.vue', source, { 欢迎: 'home.welcome', 你好: 'home.hello' })
  })
  assert.match(result.code, /return this\.\$t\('home\.hello'\)/)
  assert.match(result.code, /\{\{\s*\$t\('home\.welcome'\)\s*\}\}/)
})

test('Vue 3 build replacement injects a runtime import into script setup when t is missing', () => {
  const source = [
    '<template><p>欢迎</p></template>',
    '<script setup>',
    "const title = '标题'",
    '</script>',
    ''
  ].join('\n')
  const result = transformVue(source, {
    occurrences: vueOccurrences('src/Home.vue', source, { 欢迎: 'home.welcome', 标题: 'home.title' })
  })
  assert.match(result.code, /<script setup>\s*import\s*\{\s*t(?:\s+as\s+\w+)?\s*\}\s*from\s*['"]\.\/i18n\.js['"]/)
  assert.match(result.code, /const title = t\('home\.title'\)/)
  assert.match(result.code, /\{\{\s*\$t\('home\.welcome'\)\s*\}\}/)
})

test('Vue 3 build replacement recognizes existing localized calls without nesting', () => {
  const source = [
    '<template>',
    "  <p>{{ $t('欢迎') }}</p>",
    '</template>',
    '<script setup>',
    "import { t } from './i18n.js'",
    "const title = t('标题')",
    '</script>',
    ''
  ].join('\n')
  const result = transformVue(source, {
    occurrences: vueOccurrences('src/Home.vue', source, { 欢迎: 'home.welcome', 标题: 'home.title' })
  })
  assert.strictEqual(result.changed, false)
  assert.match(result.code, /\$t\('欢迎'\)/)
  assert.match(result.code, /t\('标题'\)/)
  assert.doesNotMatch(result.code, /\$t\(\$t\(|t\(t\(/)
})

test('Vue 3 build replacement fails when Template IR does not match catalog locations', () => {
  const source = [
    '<template><p>Welcome</p></template>',
    '<script>',
    "const title = '标题'",
    '</script>',
    ''
  ].join('\n')
  const result = transformVue(source, {
    occurrences: [{
      key: 'home.title',
      source: '标题',
      location: {
        path: 'src/Home.vue',
        kind: 'html-text',
        start: { line: 3, column: 15 },
        end: { line: 3, column: 17 }
      }
    }]
  })
  assert.ok(result.error)
  assert.match(String(result.error.message || result.error), /catalog location does not match/)
  assert.strictEqual(result.changed, false)
  assert.strictEqual(result.code, source)
})

test('Vue 3 build replacement merges template and script edits with full SFC coordinates', () => {
  const source = [
    '<template>',
    '  <p title="提示">欢迎</p>',
    '</template>',
    '<script>',
    'export default {',
    '  data() {',
    "    return { label: '标题' }",
    '  },',
    '  methods: {',
    '    greet() {',
    "      return '你好'",
    '    }',
    '  }',
    '}',
    '</script>',
    '<script setup>',
    "const tip = '说明'",
    '</script>',
    ''
  ].join('\n')
  const result = transformVue(source, {
    occurrences: vueOccurrences('src/Home.vue', source, {
      提示: 'home.hint',
      欢迎: 'home.welcome',
      标题: 'home.title',
      你好: 'home.hello',
      说明: 'home.note'
    })
  })
  assert.strictEqual(result.changed, true)
  assert.match(result.code, /:title="\$t\('home\.hint'\)"|:title='\$t\('home\.hint'\)'/)
  assert.match(result.code, /\{\{\s*\$t\('home\.welcome'\)\s*\}\}/)
  assert.match(result.code, /label:\s*this\.\$t\('home\.title'\)/)
  assert.match(result.code, /return this\.\$t\('home\.hello'\)/)
  assert.match(result.code, /const tip = t\('home\.note'\)/)
  assert.match(result.code, /<script setup>\s*import\s*\{/)
})

test('Vue 3 build replacement keeps template expression structure and uses helpers outside instance methods', () => {
  const source = [
    '<template>',
    "  <p>{{ '前缀' + name }}</p>",
    '</template>',
    '<script>',
    "const top = '顶层'",
    'export default {',
    '  mounted() {',
    "    this.msg = '挂载'",
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
  const result = transformVue(source, {
    occurrences: vueOccurrences('src/Home.vue', source, {
      前缀: 'home.prefix',
      顶层: 'home.top',
      挂载: 'home.mounted'
    })
  })
  assert.match(result.code, /\{\{\s*\$t\('home\.prefix'\)\s*\+\s*name\s*\}\}/)
  assert.match(result.code, /const top = t\('home\.top'\)/)
  assert.match(result.code, /this\.msg = this\.\$t\('home\.mounted'\)/)
  assert.match(result.code, /<script>\s*import\s*\{\s*t(?:\s+as\s+\w+)?\s*\}\s*from/)
})

test('Vue 3 build replacement source map still points at the original SFC', async () => {
  const source = [
    '<template>',
    '  <p>欢迎</p>',
    '</template>',
    '<script setup>',
    "const title = '标题'",
    '</script>',
    ''
  ].join('\n')
  const result = transformVue(source, {
    occurrences: vueOccurrences('src/Home.vue', source, { 欢迎: 'home.welcome', 标题: 'home.title' })
  })
  assert.ok(result.map)
  const consumer = await new SourceMapConsumer(result.map)
  const generatedLine = result.code.split('\n').findIndex(line => /\$t\('home\.welcome'\)/.test(line)) + 1
  const original = consumer.originalPositionFor({ line: generatedLine, column: 0 })
  assert.strictEqual(original.source, 'src/Home.vue')
  assert.ok(original.line >= 1)
})

function transformVue2(source, {
  projectPath = 'src/Home.vue',
  root,
  occurrences,
  runtimeModule = 'src/i18n.js',
  runtimeExport = 't'
} = {}) {
  const projectRoot = root || fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-vue2-'))
  installVue2(projectRoot)
  return transformBuildReplacement({
    source,
    root: projectRoot,
    projectPath,
    resourcePath: path.join(projectRoot, projectPath),
    occurrences: occurrences || vueOccurrences(projectPath, source, { 欢迎: 'home.welcome' }),
    adapter: 'vue2',
    runtimeModule,
    runtimeExport,
    styleExtensions: ['.css']
  })
}

test('Vue 2 build replacement rewrites template text to $t before vue-loader would split the SFC', () => {
  const source = [
    '<template>',
    '  <p>欢迎</p>',
    '</template>',
    '<script>',
    'export default {}',
    '</script>',
    ''
  ].join('\n')
  const result = transformVue2(source)
  assert.strictEqual(result.changed, true)
  assert.match(result.code, /\{\{\s*\$t\('home\.welcome'\)\s*\}\}/)
  assert.doesNotMatch(result.code, />欢迎</)
})

test('Vue 2 build replacement rewrites template attributes, expressions, and Options API this.$t', () => {
  const source = [
    '<template>',
    '  <p title="提示">欢迎</p>',
    "  <p>{{ '前缀' + name }}</p>",
    '</template>',
    '<script>',
    'export default {',
    '  data() {',
    "    return { label: '标题' }",
    '  },',
    '  mounted() {',
    "    this.msg = '挂载'",
    '  },',
    '  methods: {',
    '    greet() {',
    "      return '你好'",
    '    }',
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
  const result = transformVue2(source, {
    occurrences: vueOccurrences('src/Home.vue', source, {
      提示: 'home.hint',
      欢迎: 'home.welcome',
      前缀: 'home.prefix',
      标题: 'home.title',
      挂载: 'home.mounted',
      你好: 'home.hello'
    })
  })
  assert.strictEqual(result.changed, true)
  assert.match(result.code, /:title="\$t\('home\.hint'\)"|:title='\$t\('home\.hint'\)'/)
  assert.match(result.code, /\{\{\s*\$t\('home\.welcome'\)\s*\}\}/)
  assert.match(result.code, /\{\{\s*\$t\('home\.prefix'\)\s*\+\s*name\s*\}\}/)
  assert.match(result.code, /label:\s*this\.\$t\('home\.title'\)/)
  assert.match(result.code, /this\.msg = this\.\$t\('home\.mounted'\)/)
  assert.match(result.code, /return this\.\$t\('home\.hello'\)/)
})

test('Vue 2 build replacement keeps template literal static segments as $t calls', () => {
  const source = [
    '<template>',
    '  <p>{{ `前缀${name}` }}</p>',
    '</template>',
    '<script>',
    'export default {}',
    '</script>',
    ''
  ].join('\n')
  const result = transformVue2(source, {
    occurrences: vueOccurrences('src/Home.vue', source, { 前缀: 'home.prefix' })
  })
  assert.strictEqual(result.changed, true)
  assert.match(result.code, /\{\{\s*`\$\{\$t\('home\.prefix'\)\}\$\{name\}`\s*\}\}/)
  assert.doesNotMatch(result.code, /前缀/)
})

test('Vue 2 build replacement fails closed for top-level, arrow methods, and nested functions', () => {
  const source = [
    '<template>',
    '  <p>欢迎</p>',
    '</template>',
    '<script>',
    "const top = '顶层'",
    'export default {',
    '  methods: {',
    "    arrow: () => '箭头',",
    '    greet() {',
    "      function inner() { return '内部' }",
    "      return '你好'",
    '    }',
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
  const result = transformVue2(source, {
    occurrences: vueOccurrences('src/Home.vue', source, {
      欢迎: 'home.welcome',
      顶层: 'home.top',
      箭头: 'home.arrow',
      内部: 'home.inner',
      你好: 'home.hello'
    })
  })
  assert.ok(result.error)
  assert.strictEqual(result.changed, false)
  assert.strictEqual(result.code, source)
  const keys = result.error.occurrences.map(item => item.key).sort()
  assert.deepStrictEqual(keys, ['home.arrow', 'home.inner', 'home.top'])
  assert.ok(result.error.occurrences.every(item => typeof item.reason === 'string' && item.reason.length > 0))
})

test('Vue 2 build replacement recognizes existing localized calls without nesting', () => {
  const source = [
    '<template>',
    "  <p>{{ $t('欢迎') }}</p>",
    '</template>',
    '<script>',
    'export default {',
    '  methods: {',
    '    greet() {',
    "      return this.$t('你好')",
    '    }',
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
  const result = transformVue2(source, {
    occurrences: vueOccurrences('src/Home.vue', source, { 欢迎: 'home.welcome', 你好: 'home.hello' })
  })
  assert.strictEqual(result.changed, false)
  assert.match(result.code, /\$t\('欢迎'\)/)
  assert.match(result.code, /this\.\$t\('你好'\)/)
  assert.doesNotMatch(result.code, /\$t\(\$t\(|this\.\$t\(this\.\$t\(/)
})

test('Vue 2 build replacement fails when Template IR does not match catalog locations', () => {
  const source = [
    '<template><p>Welcome</p></template>',
    '<script>',
    'export default {',
    '  methods: {',
    "    greet() { return '你好' }",
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
  const result = transformVue2(source, {
    occurrences: [{
      key: 'home.hello',
      source: '你好',
      location: {
        path: 'src/Home.vue',
        kind: 'html-text',
        start: { line: 3, column: 15 },
        end: { line: 3, column: 17 }
      }
    }]
  })
  assert.ok(result.error)
  assert.match(String(result.error.message || result.error), /catalog location does not match/)
  assert.strictEqual(result.changed, false)
  assert.strictEqual(result.code, source)
})

test('Vue 2 build replacement source map still points at the original SFC', async () => {
  const source = [
    '<template>',
    '  <p>欢迎</p>',
    '</template>',
    '<script>',
    'export default {',
    '  methods: {',
    "    greet() { return '你好' }",
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
  const result = transformVue2(source, {
    occurrences: vueOccurrences('src/Home.vue', source, { 欢迎: 'home.welcome', 你好: 'home.hello' })
  })
  assert.ok(result.map)
  const consumer = await new SourceMapConsumer(result.map)
  const generatedLine = result.code.split('\n').findIndex(line => /\$t\('home\.welcome'\)/.test(line)) + 1
  const original = consumer.originalPositionFor({ line: generatedLine, column: 0 })
  assert.strictEqual(original.source, 'src/Home.vue')
  assert.ok(original.line >= 1)
})
