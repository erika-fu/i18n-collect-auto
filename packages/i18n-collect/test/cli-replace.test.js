const assert = require('assert')
const { spawnSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { buildCatalog, catalogMetadata } = require('../mycommon/catalog')
const { extractScript } = require('../myloader/extract-script')
const { extractHtml } = require('../myloader/extract-html')
const { extractVueScript } = require('../myloader/extract-vue-compat')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const ALLOW = ['title', 'placeholder', 'alt', 'aria-label', 'value']

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function projectFiles(root) {
  const files = []
  const visit = directory => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name)
      if (fs.statSync(file).isDirectory()) visit(file)
      else files.push(file)
    }
  }
  visit(root)
  return files.sort()
}

function snapshotFiles(root) {
  return new Map(projectFiles(root).map(file => [file, fs.readFileSync(file)]))
}

function assertUnchanged(root, before) {
  for (const [file, bytes] of before) assert.deepStrictEqual(fs.readFileSync(file), bytes)
  assert.deepStrictEqual(projectFiles(root), [...before.keys()].sort())
}

function write(root, name, contents) {
  const file = path.join(root, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function keyed(entries, keys) {
  return entries.map(entry => {
    const key = keys[entry.value]
    if (!key) throw new Error(`missing key for ${JSON.stringify(entry.value)}`)
    return { ...entry, key }
  })
}

function vueEntries(projectPath, source) {
  const resource = { projectPath }
  const html = extractHtml({
    source,
    resource: { ...resource, block: 'template', lang: 'html', query: '?vue&type=template' },
    config: { attributeAllowlist: ALLOW }
  }).entries
  const script = extractVueScript({ source, resource, config: {} })
  return [...html, ...script]
}

function scriptEntries(projectPath, source) {
  return extractScript({ source, resource: { projectPath }, config: {} })
}

function htmlEntries(projectPath, source) {
  return extractHtml({
    source,
    resource: { projectPath, block: 'html', lang: 'html' },
    config: { attributeAllowlist: ALLOW }
  }).entries
}

function writeCatalog(root, entries) {
  const catalog = buildCatalog([{ entries }])
  assert.deepStrictEqual(catalog.conflicts, [])
  fs.mkdirSync(path.join(root, 'lang/catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, 'lang/catalog/zh.json'), json(catalog.messages))
  fs.writeFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), json(catalogMetadata(catalog, {
    sourceLocale: 'zh',
    format: 'json'
  })))
  return catalog
}

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-replace-'))
}

test('replace help describes a dry-run and the three runtime adapters', () => {
  const result = run(['replace', '--help'])
  assert.strictEqual(result.status, 0)
  assert.strictEqual(result.stderr, '')
  const help = result.stdout
  assert.match(help, /i18n-collect replace/)
  assert.match(help, /dry-run/)
  assert.match(help, /does not write source files or catalog files/)
  assert.match(help, /does not install dependencies/)
  assert.match(help, /does not rewrite application bootstrap/)
  assert.match(help, /vue2/)
  assert.match(help, /vue3/)
  assert.match(help, /--adapter/)
  assert.match(help, /--strict/)
  assert.match(help, /--write/)
  assert.match(help, /React JSX/)
  assert.match(help, /standalone HTML/)
  assert.match(help, /CSS generated content/)
  assert.match(help, /already localized/)
  assert.match(help, /\$t\('key'\)/)
  assert.match(help, /this\.\$t\('key'\)/)
  assert.match(help, /t\('key'\)/)
  assert.match(help, /arrow function bodies/)
  assert.match(help, /default exports/)
})

test('replace requires a known adapter and catalog metadata', () => {
  const root = tempProject()
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  const missing = run(['replace', '--json'], root)
  assert.strictEqual(missing.status, 1)
  assert.match(missing.stderr, /replace requires --adapter/)
  const unknown = run(['replace', '--adapter', 'react', '--json'], root)
  assert.strictEqual(unknown.status, 1)
  assert.match(unknown.stderr, /unknown adapter "react"/)
  const noCatalog = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(noCatalog.status, 1)
  assert.match(noCatalog.stderr, /source catalog metadata is missing/)
  const writeFlag = run(['replace', '--adapter', 'js', '--write'], root)
  assert.strictEqual(writeFlag.status, 1)
  assert.match(writeFlag.stderr, /source catalog metadata is missing/)
})

test('replace previews a JavaScript string through t() and leaves every file unchanged', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    'const message = "你好"',
    'export default message',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, keyed(scriptEntries('src/app.js', source), { 你好: 'home.hello' }))
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(result.stderr, '')
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.dryRun, true)
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.adapter, 'js')
  assert.deepStrictEqual(report.skipped, [])
  assert.deepStrictEqual(report.recognized, [])
  assert.strictEqual(report.replacements.length, 1)
  assert.strictEqual(report.replacements[0].call, "t('home.hello')")
  assert.strictEqual(report.replacements[0].kind, 'script-string')
  assert.strictEqual(report.replacements[0].source, '你好')
  assert.deepStrictEqual(report.previews, [{
    path: 'src/app.js',
    content: [
      "import { t } from './i18n'",
      "const message = t('home.hello')",
      'export default message',
      ''
    ].join('\n')
  }])
  assertUnchanged(root, before)
  const again = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(again.stdout, result.stdout)
  assertUnchanged(root, before)
})

test('replace recognizes an existing localization call and does not nest it', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    "const message = t('你好')",
    'export default message',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, keyed(scriptEntries('src/app.js', source), { 你好: 'home.hello' }))
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.replacements, [])
  assert.deepStrictEqual(report.skipped, [])
  assert.deepStrictEqual(report.previews, [])
  assert.strictEqual(report.recognized.length, 1)
  assert.strictEqual(report.recognized[0].source, '你好')
  assert.strictEqual(report.recognized[0].key, 'home.hello')
  assertUnchanged(root, before)
})

test('replace fails when the js adapter has no exported localization function', () => {
  const root = tempProject()
  const source = 'const message = "你好"\n'
  write(root, 'src/local.js', 'function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, keyed(scriptEntries('src/app.js', source), { 你好: 'home.hello' }))
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 1)
  assert.match(result.stderr, /exports a localization function named t/)
  assert.match(result.stderr, /does not rewrite application bootstrap/)
  assertUnchanged(root, before)
})

test('replace accepts a CommonJS module that exports t', () => {
  const root = tempProject()
  const source = "const { t } = require('./i18n')\nmodule.exports = t('保留')\nconst message = \"你好\"\n"
  write(root, 'src/i18n.js', 'module.exports = { t(key) { return key } }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, keyed(scriptEntries('src/app.js', source), { 你好: 'home.hello', 保留: 'home.keep' }))
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.replacements.map(item => item.call), ["t('home.hello')"])
  assert.strictEqual(report.recognized.length, 1)
  assert.strictEqual(report.previews[0].content, "const { t } = require('./i18n')\nmodule.exports = t('保留')\nconst message = t('home.hello')\n")
})

test('replace previews template literals and TypeScript without inserting an import', () => {
  const root = tempProject()
  const script = [
    "import { t } from './i18n'",
    'const plain = `欢迎`',
    'const greeting = `你好${name}`',
    ''
  ].join('\n')
  const typed = [
    "import { t } from './i18n'",
    "const label: string = '标签'",
    'export default label',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/copy.js', script)
  write(root, 'src/label.ts', typed)
  writeCatalog(root, keyed([
    ...scriptEntries('src/copy.js', script),
    ...scriptEntries('src/label.ts', typed)
  ], { 欢迎: 'home.plain', 你好: 'home.hello', 标签: 'home.label' }))
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.previews, [
    {
      path: 'src/copy.js',
      content: [
        "import { t } from './i18n'",
        "const plain = t('home.plain')",
        "const greeting = `${t('home.hello')}${name}`",
        ''
      ].join('\n')
    },
    {
      path: 'src/label.ts',
      content: [
        "import { t } from './i18n'",
        "const label: string = t('home.label')",
        'export default label',
        ''
      ].join('\n')
    }
  ])
  assertUnchanged(root, before)
})

test('replace skips an object key and strict mode fails without writing', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    "const labels = { '标题': '你好' }",
    'export default labels',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, keyed(scriptEntries('src/app.js', source), { 标题: 'home.title', 你好: 'home.hello' }))
  const before = snapshotFiles(root)
  const loose = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(loose.status, 0, loose.stderr)
  const looseReport = JSON.parse(loose.stdout)
  assert.deepStrictEqual(looseReport.replacements.map(item => item.call), ["t('home.hello')"])
  assert.deepStrictEqual(looseReport.skipped.map(item => item.reason), ['object key is not a supported semantic position'])
  assert.strictEqual(looseReport.previews[0].content, [
    "import { t } from './i18n'",
    "const labels = { '标题': t('home.hello') }",
    'export default labels',
    ''
  ].join('\n'))
  const strict = run(['replace', '--adapter', 'js', '--strict', '--json'], root)
  assert.strictEqual(strict.status, 7)
  assert.match(strict.stderr, /replacement: skipped candidates fail strict mode/)
  const strictReport = JSON.parse(strict.stdout)
  assert.strictEqual(strictReport.ok, false)
  assert.strictEqual(strictReport.failure, 'replacement')
  assert.strictEqual(strictReport.previews[0].content, looseReport.previews[0].content)
  assertUnchanged(root, before)
})

test('replace skips a switch case label', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    'switch (kind) {',
    "  case '标题':",
    '    break',
    '}',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, keyed(scriptEntries('src/app.js', source), { 标题: 'home.title' }))
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.replacements, [])
  assert.deepStrictEqual(report.previews, [])
  assert.strictEqual(report.skipped[0].reason, 'switch case is not a supported semantic position')
})

test('replace skips a string when t is not already in scope', () => {
  const root = tempProject()
  const source = 'const message = "你好"\n'
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, keyed(scriptEntries('src/app.js', source), { 你好: 'home.hello' }))
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.replacements, [])
  assert.deepStrictEqual(report.previews, [])
  assert.strictEqual(report.skipped[0].reason, 'js adapter requires t to already be in scope')
})

test('replace skips React JSX, standalone HTML, CSS generated content, and Vue text for the js adapter', () => {
  const root = tempProject()
  const script = "import { t } from './i18n'\nconst label = '你好'\nexport default label\n"
  const jsx = "import { t } from './i18n'\nexport function Button() {\n  return <button title=\"标题\">{label}</button>\n}\n"
  const html = '<p title="页面">正文</p>\n'
  const vue = '<template><p>面板</p></template>\n'
  const css = '.button::before { content: "按钮"; }\n'
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', script)
  write(root, 'src/Button.jsx', jsx)
  write(root, 'public/index.html', html)
  write(root, 'src/Panel.vue', vue)
  write(root, 'src/app.css', css)
  const entries = keyed([
    ...scriptEntries('src/app.js', script),
    ...scriptEntries('src/Button.jsx', jsx),
    ...htmlEntries('public/index.html', html),
    ...vueEntries('src/Panel.vue', vue)
  ], { 你好: 'home.hello', 标题: 'home.jsx', 页面: 'home.page', 正文: 'home.body', 面板: 'home.panel' })
  entries.push({
    value: '按钮',
    key: 'home.css',
    locations: [{
      path: 'src/app.css',
      kind: 'css-generated-content',
      start: { line: 1, column: 32 },
      end: { line: 1, column: 34 }
    }]
  })
  writeCatalog(root, entries)
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.replacements.map(item => item.call), ["t('home.hello')"])
  assert.deepStrictEqual(report.skipped.map(item => [item.path, item.reason]), [
    ['public/index.html', 'standalone HTML is outside replacement scope'],
    ['public/index.html', 'standalone HTML is outside replacement scope'],
    ['src/Button.jsx', 'React JSX is outside replacement scope'],
    ['src/Panel.vue', 'Vue template text is not a js adapter position'],
    ['src/app.css', 'CSS generated content is outside replacement scope']
  ])
  assertUnchanged(root, before)
})

function vue2Runtime(root) {
  write(root, 'package.json', json({ dependencies: { 'vue-i18n': '8.28.2' } }))
  write(root, 'src/main.js', 'import Vue from \'vue\'\nimport VueI18n from \'vue-i18n\'\nVue.use(VueI18n)\nnew VueI18n({})\n')
}

const VUE2_SOURCE = [
  '<template>',
  '  <p title="标题">欢迎</p>',
  '  <input :placeholder="\'请输入\'">',
  '  <p>{{ \'单独字符串\' }}</p>',
  '  <p>{{ `前缀${name}` }}</p>',
  '</template>',
  '<script>',
  'export default {',
  '  data() {',
  '    return { title: \'数据\' }',
  '  },',
  '  methods: {',
  '    greet() {',
  '      return \'你好\'',
  '    }',
  '  }',
  '}',
  '</script>',
  ''
].join('\n')

const VUE2_PREVIEW = [
  '<template>',
  '  <p :title="$t(\'home.title\')">{{ $t(\'home.welcome\') }}</p>',
  '  <input :placeholder="$t(\'home.hint\')">',
  '  <p>{{ $t(\'home.only\') }}</p>',
  '  <p>{{ `${$t(\'home.prefix\')}${name}` }}</p>',
  '</template>',
  '<script>',
  'export default {',
  '  data() {',
  '    return { title: this.$t(\'home.data\') }',
  '  },',
  '  methods: {',
  '    greet() {',
  '      return this.$t(\'home.hello\')',
  '    }',
  '  }',
  '}',
  '</script>',
  ''
].join('\n')

test('replace previews Vue 2 template text, attributes, expressions, and instance methods', () => {
  const root = tempProject()
  vue2Runtime(root)
  write(root, 'src/Home.vue', VUE2_SOURCE)
  writeCatalog(root, keyed(vueEntries('src/Home.vue', VUE2_SOURCE), {
    标题: 'home.title',
    欢迎: 'home.welcome',
    请输入: 'home.hint',
    单独字符串: 'home.only',
    前缀: 'home.prefix',
    数据: 'home.data',
    你好: 'home.hello'
  }))
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'vue2', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.skipped, [])
  assert.deepStrictEqual(report.previews, [{ path: 'src/Home.vue', content: VUE2_PREVIEW }])
  assert.deepStrictEqual(report.replacements.map(item => item.call).sort(), [
    "$t('home.hint')",
    "$t('home.only')",
    "$t('home.prefix')",
    "$t('home.title')",
    "$t('home.welcome')",
    "this.$t('home.data')",
    "this.$t('home.hello')"
  ])
  assertUnchanged(root, before)
})

test('replace skips Vue 2 positions that cannot call this.$t and recognizes calls that already exist', () => {
  const root = tempProject()
  vue2Runtime(root)
  const source = [
    '<template>',
    '  <p>{{ $t(\'欢迎\') }}</p>',
    '</template>',
    '<script>',
    'const top = \'顶层\'',
    'export default {',
    '  methods: {',
    '    arrow: () => \'箭头\',',
    '    greet() {',
    '      function inner() { return \'内部\' }',
    '      return this.$t(\'你好\')',
    '    }',
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
  write(root, 'src/Home.vue', source)
  writeCatalog(root, keyed(vueEntries('src/Home.vue', source), {
    欢迎: 'home.welcome',
    顶层: 'home.top',
    箭头: 'home.arrow',
    内部: 'home.inner',
    你好: 'home.hello'
  }))
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'vue2', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.replacements, [])
  assert.deepStrictEqual(report.previews, [])
  assert.deepStrictEqual(report.skipped.map(item => [item.source, item.reason]), [
    ['顶层', 'vue2 adapter requires a component instance method'],
    ['箭头', 'arrow function does not provide a Vue instance'],
    ['内部', 'vue2 adapter requires a component instance method']
  ])
  assert.deepStrictEqual(report.recognized.map(item => [item.source, item.call]), [
    ['欢迎', "$t('home.welcome')"],
    ['你好', "this.$t('home.hello')"]
  ])
  assertUnchanged(root, before)
})

test('replace does not nest a string that is already inside a template localization call', () => {
  const root = tempProject()
  vue2Runtime(root)
  const source = [
    '<template>',
    "  <p>{{ $t('欢迎' + '你好') }}</p>",
    "  <p>{{ $t(/* note */ '再见') }}</p>",
    '</template>',
    ''
  ].join('\n')
  write(root, 'src/Home.vue', source)
  writeCatalog(root, keyed(vueEntries('src/Home.vue', source), {
    欢迎: 'home.welcome',
    你好: 'home.hello',
    再见: 'home.bye'
  }))
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'vue2', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.replacements, [])
  assert.deepStrictEqual(report.previews, [])
  assert.deepStrictEqual(report.recognized.map(item => item.source), ['欢迎', '你好', '再见'])
  assertUnchanged(root, before)
})

test('replace ignores a commented VueI18n call and a non-function t export', () => {
  const commented = tempProject()
  write(commented, 'package.json', json({ dependencies: { 'vue-i18n': '8.28.2' } }))
  write(commented, 'src/main.js', '// new VueI18n({})\nconst note = "Vue.use(VueI18n)"\n')
  write(commented, 'src/Home.vue', '<template><p>欢迎</p></template>\n')
  writeCatalog(commented, keyed(vueEntries('src/Home.vue', '<template><p>欢迎</p></template>\n'), { 欢迎: 'home.welcome' }))
  const vue = run(['replace', '--adapter', 'vue2', '--json'], commented)
  assert.strictEqual(vue.status, 1)
  assert.match(vue.stderr, /vue-i18n 8/)

  const numberExport = tempProject()
  write(numberExport, 'src/i18n.js', 'export const t = 1\n')
  write(numberExport, 'src/app.js', 'const message = "你好"\n')
  writeCatalog(numberExport, keyed(scriptEntries('src/app.js', 'const message = "你好"\n'), { 你好: 'home.hello' }))
  const missing = run(['replace', '--adapter', 'js', '--json'], numberExport)
  assert.strictEqual(missing.status, 1)
  assert.match(missing.stderr, /exports a localization function named t/)

  const def = tempProject()
  const source = 'const message = "你好"\n'
  write(def, 'src/i18n.js', 'export default { t(key) { return key } }\n')
  write(def, 'src/app.js', source)
  writeCatalog(def, keyed(scriptEntries('src/app.js', source), { 你好: 'home.hello' }))
  const accepted = run(['replace', '--adapter', 'js', '--json'], def)
  assert.strictEqual(accepted.status, 0, accepted.stderr)
  assert.strictEqual(JSON.parse(accepted.stdout).skipped[0].reason, 'js adapter requires t to already be in scope')
})

test('replace fails when the Vue 2 runtime integration is missing', () => {
  const root = tempProject()
  write(root, 'package.json', json({ dependencies: { 'vue-i18n': '9.14.0' } }))
  write(root, 'src/Home.vue', '<template><p>欢迎</p></template>\n')
  writeCatalog(root, keyed(vueEntries('src/Home.vue', '<template><p>欢迎</p></template>\n'), { 欢迎: 'home.welcome' }))
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'vue2', '--json'], root)
  assert.strictEqual(result.status, 1)
  assert.match(result.stderr, /vue-i18n 8/)
  assert.match(result.stderr, /does not install dependencies or rewrite application bootstrap/)
  assertUnchanged(root, before)
})

function vue3Runtime(root) {
  write(root, 'package.json', json({ dependencies: { 'vue-i18n': '9.14.0' } }))
  write(root, 'src/main.js', 'import { createI18n } from \'vue-i18n\'\ncreateI18n({})\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
}

test('replace previews Vue 3 template text and a script setup binding', () => {
  const root = tempProject()
  vue3Runtime(root)
  const source = [
    '<template>',
    '  <p>欢迎</p>',
    '</template>',
    '<script setup>',
    "import { t } from './i18n'",
    "const title = '标题'",
    '</script>',
    ''
  ].join('\n')
  write(root, 'src/Home.vue', source)
  writeCatalog(root, keyed(vueEntries('src/Home.vue', source), { 欢迎: 'home.welcome', 标题: 'home.title' }))
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'vue3', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.skipped, [])
  assert.deepStrictEqual(report.previews, [{
    path: 'src/Home.vue',
    content: [
      '<template>',
      '  <p>{{ $t(\'home.welcome\') }}</p>',
      '</template>',
      '<script setup>',
      "import { t } from './i18n'",
      "const title = t('home.title')",
      '</script>',
      ''
    ].join('\n')
  }])
  assertUnchanged(root, before)
})

test('replace previews a Vue 3 options API method with this.$t', () => {
  const root = tempProject()
  vue3Runtime(root)
  const source = [
    '<template><p>欢迎</p></template>',
    '<script>',
    'export default {',
    '  methods: {',
    '    greet() {',
    '      return \'你好\'',
    '    }',
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
  write(root, 'src/Home.vue', source)
  writeCatalog(root, keyed(vueEntries('src/Home.vue', source), { 欢迎: 'home.welcome', 你好: 'home.hello' }))
  const result = run(['replace', '--adapter', 'vue3', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.previews[0].content, [
    '<template><p>{{ $t(\'home.welcome\') }}</p></template>',
    '<script>',
    'export default {',
    '  methods: {',
    '    greet() {',
    '      return this.$t(\'home.hello\')',
    '    }',
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n'))
})

test('replace fails when script setup has no t binding and when createI18n is missing', () => {
  const root = tempProject()
  vue3Runtime(root)
  const source = [
    '<template><p>欢迎</p></template>',
    '<script setup>',
    "const title = '标题'",
    '</script>',
    ''
  ].join('\n')
  write(root, 'src/Home.vue', source)
  writeCatalog(root, keyed(vueEntries('src/Home.vue', source), { 欢迎: 'home.welcome', 标题: 'home.title' }))
  const partial = run(['replace', '--adapter', 'vue3', '--json'], root)
  assert.strictEqual(partial.status, 0, partial.stderr)
  const partialReport = JSON.parse(partial.stdout)
  assert.strictEqual(partialReport.skipped[0].reason, 'vue3 adapter requires t to already be in scope')
  assert.match(partialReport.previews[0].content, /\{\{ \$t\('home\.welcome'\) \}\}/)

  const bare = tempProject()
  write(bare, 'package.json', json({ dependencies: { 'vue-i18n': '9.14.0' } }))
  write(bare, 'src/Home.vue', '<template><p>欢迎</p></template>\n')
  writeCatalog(bare, keyed(vueEntries('src/Home.vue', '<template><p>欢迎</p></template>\n'), { 欢迎: 'home.welcome' }))
  const before = snapshotFiles(bare)
  const missing = run(['replace', '--adapter', 'vue3', '--json'], bare)
  assert.strictEqual(missing.status, 1)
  assert.match(missing.stderr, /createI18n/)
  assert.match(missing.stderr, /does not install dependencies or rewrite application bootstrap/)
  assertUnchanged(bare, before)
})

test('replace --write commits the preview, keyed catalogs, and replacement metadata', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    'const message = "你好"',
    'export default message',
    ''
  ].join('\n')
  const writtenSource = [
    "import { t } from './i18n'",
    "const message = t('home.hello')",
    'export default message',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, keyed(scriptEntries('src/app.js', source), { 你好: 'home.hello' }))
  write(root, 'lang/catalog/en.json', json({ 'home.hello': 'Hello' }))
  write(root, 'lang/catalog/translation-state.json', json({
    version: 1,
    locales: { en: { 'home.hello': { sourceFingerprint: 'kept', review: 'current' } } }
  }))
  const beforeCatalog = fs.readFileSync(path.join(root, 'lang/catalog/zh.json'))
  const beforeMetadata = fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'))
  const beforeEnglish = fs.readFileSync(path.join(root, 'lang/catalog/en.json'))
  const beforeState = fs.readFileSync(path.join(root, 'lang/catalog/translation-state.json'))
  const preview = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  assert.strictEqual(JSON.parse(preview.stdout).dryRun, true)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), source)

  const result = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(result.stderr, '')
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'replace')
  assert.strictEqual(report.adapter, 'js')
  assert.strictEqual(report.dryRun, false)
  assert.strictEqual(report.written, true)
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.files, [
    'lang/catalog/zh.json',
    'lang/catalog/en.json',
    'lang/catalog/catalog.meta.json',
    'lang/catalog/replacements.json',
    'src/app.js'
  ])
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), writtenSource)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/zh.json')), beforeCatalog)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json')), beforeMetadata)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/en.json')), beforeEnglish)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/translation-state.json')), beforeState)
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/replacements.json'), 'utf8')), {
    version: 1,
    adapter: 'js',
    replacements: [{
      path: 'src/app.js',
      key: 'home.hello',
      kind: 'script-string',
      source: '你好',
      call: "t('home.hello')",
      start: { line: 2, column: 16 },
      end: { line: 2, column: 20 }
    }]
  })
  assert.deepStrictEqual(
    fs.readdirSync(path.join(root, 'lang/catalog')).filter(name => name.includes('.tmp-') || name.includes('.bak-') || name.startsWith('.commit-')),
    []
  )

  const recorded = fs.readFileSync(path.join(root, 'lang/catalog/replacements.json'))
  const again = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(again.status, 0, again.stderr)
  const second = JSON.parse(again.stdout)
  assert.strictEqual(second.written, false)
  assert.deepStrictEqual(second.files, [])
  assert.deepStrictEqual(second.replacements, [])
  assert.strictEqual(second.recognized.length, 1)
  assert.strictEqual(second.recognized[0].call, "t('home.hello')")
  assert.deepStrictEqual(second.skipped, [])
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), writtenSource)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/zh.json')), beforeCatalog)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/replacements.json')), recorded)
})

test('replace --strict --write leaves every file unchanged when a candidate is skipped', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    "const labels = { '标题': '你好' }",
    'export default labels',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, keyed(scriptEntries('src/app.js', source), { 标题: 'home.title', 你好: 'home.hello' }))
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'js', '--strict', '--write', '--json'], root)
  assert.strictEqual(result.status, 7)
  assert.match(result.stderr, /replacement: skipped candidates fail strict mode/)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.strictEqual(report.failure, 'replacement')
  assert.strictEqual(report.dryRun, false)
  assert.strictEqual(report.written, false)
  assert.deepStrictEqual(report.files, [])
  assertUnchanged(root, before)
})

test('a failed replacement restores source, catalog, and metadata files', () => {
  const root = tempProject()
  const first = [
    "import { t } from './i18n'",
    'const message = "甲文"',
    'export default message',
    ''
  ].join('\n')
  const second = [
    "import { t } from './i18n'",
    'const message = "乙文"',
    'export default message',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/a.js', first)
  write(root, 'src/b.js', second)
  writeCatalog(root, [
    ...keyed(scriptEntries('src/a.js', first), { 甲文: 'home.a' }),
    ...keyed(scriptEntries('src/b.js', second), { 乙文: 'home.b' })
  ])
  write(root, 'lang/catalog/en.json', json({ 'home.a': 'A' }))
  const catalog = path.join(root, 'lang/catalog')
  const hook = path.join(root, 'fail-replacement.js')
  fs.writeFileSync(hook, `const fs = require('fs')
const path = require('path')
const rename = fs.renameSync.bind(fs)
let sawCatalog = false
let sawSource = false
fs.renameSync = (from, to) => {
  const base = path.basename(String(to))
  const final = String(from).includes('.tmp-')
  if (final && base === 'b.js' && sawCatalog && sawSource) {
    const error = new Error('simulated storage failure')
    error.code = 'EIO'
    throw error
  }
  const result = rename(from, to)
  if (final && (base === 'zh.json' || base === 'catalog.meta.json' || base === 'replacements.json')) sawCatalog = true
  if (final && base === 'a.js') sawSource = true
  return result
}
`)
  const before = snapshotFiles(root)
  const result = spawnSync(process.execPath, ['-r', hook, bin, 'replace', '--adapter', 'js', '--write', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
  assert.strictEqual(result.status, 6, result.stderr)
  assert.match(result.stderr, /^storage: /)
  assert.match(result.stderr, /simulated storage failure/)
  assert.match(result.stderr, /restored after a write failure/)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'replace')
  assert.strictEqual(report.ok, false)
  assert.strictEqual(report.failure, 'storage')
  assertUnchanged(root, before)
  const leftovers = []
  const visit = directory => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name)
      if (fs.statSync(file).isDirectory()) visit(file)
      else if (name.includes('.tmp-') || name.includes('.bak-') || name.startsWith('.commit-')) leftovers.push(file)
    }
  }
  visit(root)
  assert.deepStrictEqual(leftovers, [])
  assert.strictEqual(fs.existsSync(path.join(catalog, 'replacements.json')), false)
})

test('an interrupted replacement is restored before the next write', () => {
  const root = tempProject()
  const first = [
    "import { t } from './i18n'",
    'const message = "甲文"',
    'export default message',
    ''
  ].join('\n')
  const second = [
    "import { t } from './i18n'",
    'const message = "乙文"',
    'export default message',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/a.js', first)
  write(root, 'src/b.js', second)
  writeCatalog(root, [
    ...keyed(scriptEntries('src/a.js', first), { 甲文: 'home.a' }),
    ...keyed(scriptEntries('src/b.js', second), { 乙文: 'home.b' })
  ])
  const hook = path.join(root, 'interrupt-replacement.js')
  fs.writeFileSync(hook, `const fs = require('fs')
const path = require('path')
const rename = fs.renameSync.bind(fs)
let sawCatalog = false
let sawSource = false
fs.renameSync = (from, to) => {
  const base = path.basename(String(to))
  const final = String(from).includes('.tmp-')
  if (final && base === 'b.js' && sawCatalog && sawSource) process.exit(99)
  const result = rename(from, to)
  if (final && (base === 'zh.json' || base === 'catalog.meta.json' || base === 'replacements.json')) sawCatalog = true
  if (final && base === 'a.js') sawSource = true
  return result
}
`)
  const interrupted = spawnSync(process.execPath, ['-r', hook, bin, 'replace', '--adapter', 'js', '--write', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
  assert.strictEqual(interrupted.status, 99, interrupted.stderr)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/a.js'), 'utf8'), first)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/b.js'), 'utf8'), second)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/replacements.json')), false)
  assert.deepStrictEqual(
    fs.readdirSync(path.join(root, 'lang/catalog')).filter(name => name.includes('.tmp-') || name.includes('.bak-') || name.startsWith('.commit-')),
    []
  )

  const result = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/a.js'), 'utf8'), [
    "import { t } from './i18n'",
    "const message = t('home.a')",
    'export default message',
    ''
  ].join('\n'))
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/b.js'), 'utf8'), [
    "import { t } from './i18n'",
    "const message = t('home.b')",
    'export default message',
    ''
  ].join('\n'))
  assert.deepStrictEqual(
    fs.readdirSync(path.join(root, 'lang/catalog')).filter(name => name.includes('.tmp-') || name.includes('.bak-') || name.startsWith('.commit-')),
    []
  )
})

test('replace rewrites identical text with each occurrence localization key', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    'const first = "你好"',
    'const second = "你好"',
    'export default [first, second]',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  const catalog = writeCatalog(root, scriptEntries('src/app.js', source))
  const located = Object.entries(catalog.entries).map(([key, entry]) => ({
    key,
    line: entry.locations[0].start.line
  })).sort((left, right) => left.line - right.line)
  assert.strictEqual(located.length, 2)
  assert.notStrictEqual(located[0].key, located[1].key)
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.skipped, [])
  assert.deepStrictEqual(
    report.replacements.map(item => ({ line: item.start.line, call: item.call })),
    located.map(item => ({ line: item.line, call: `t('${item.key}')` }))
  )
  assert.strictEqual(report.previews[0].content, [
    "import { t } from './i18n'",
    `const first = t('${located[0].key}')`,
    `const second = t('${located[1].key}')`,
    'export default [first, second]',
    ''
  ].join('\n'))
  assertUnchanged(root, before)
})

test('replace rewrites intentionally shared text with the same localization key', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    'const first = /* i18n-key: shared.hello */ "你好"',
    'const second = /* i18n-key: shared.hello */ "你好"',
    'export default [first, second]',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, scriptEntries('src/app.js', source))
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.skipped, [])
  assert.deepStrictEqual(report.replacements.map(item => item.call), ["t('shared.hello')", "t('shared.hello')"])
  assert.notStrictEqual(report.replacements[0].start.line, report.replacements[1].start.line)
  assert.strictEqual(report.previews[0].content, [
    "import { t } from './i18n'",
    "const first = /* i18n-key: shared.hello */ t('shared.hello')",
    "const second = /* i18n-key: shared.hello */ t('shared.hello')",
    'export default [first, second]',
    ''
  ].join('\n'))
})

test('replace reports ambiguous occurrence metadata and does not rewrite either claimant', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    'const message = "你好"',
    'const title = "欢迎"',
    'export default [message, title]',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  const entries = scriptEntries('src/app.js', source)
  const hello = entries.find(entry => entry.value === '你好')
  const welcome = entries.find(entry => entry.value === '欢迎')
  writeCatalog(root, [
    { ...hello, key: 'home.one' },
    { ...hello, key: 'home.two' },
    { ...welcome, key: 'home.welcome' }
  ])
  const before = snapshotFiles(root)
  const preview = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const report = JSON.parse(preview.stdout)
  assert.deepStrictEqual(report.replacements.map(item => item.call), ["t('home.welcome')"])
  assert.deepStrictEqual(
    report.skipped.map(item => ({ key: item.key, source: item.source, reason: item.reason })).sort((left, right) => left.key < right.key ? -1 : 1),
    [
      { key: 'home.one', source: '你好', reason: 'overlapping occurrence claims' },
      { key: 'home.two', source: '你好', reason: 'overlapping occurrence claims' }
    ]
  )
  assert.strictEqual(report.previews[0].content, [
    "import { t } from './i18n'",
    'const message = "你好"',
    "const title = t('home.welcome')",
    'export default [message, title]',
    ''
  ].join('\n'))
  assertUnchanged(root, before)

  const written = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  assert.strictEqual(JSON.parse(written.stdout).written, true)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), report.previews[0].content)

  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  fs.rmSync(path.join(root, 'lang/catalog/replacements.json'))
  const strict = run(['replace', '--adapter', 'js', '--strict', '--write', '--json'], root)
  assert.strictEqual(strict.status, 7)
  assert.strictEqual(JSON.parse(strict.stdout).written, false)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), source)
})

test('replace skips an unresolved occurrence and still rewrites its uniquely keyed sibling', () => {
  const root = tempProject()
  const ambiguousSource = [
    "import { t } from './i18n'",
    'const first = "你好"',
    'const second = "你好"',
    "const kept = t('欢迎')",
    'export default [first, second, kept]',
    ''
  ].join('\n')
  const clearSource = [
    "import { t } from './i18n'",
    'const title = "标题"',
    'export default title',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/ambiguous.js', ambiguousSource)
  write(root, 'src/clear.js', clearSource)
  const catalog = writeCatalog(root, [
    ...scriptEntries('src/ambiguous.js', ambiguousSource).map(entry => (
      entry.value === '欢迎' ? { ...entry, key: 'home.welcome' } : entry
    )),
    ...scriptEntries('src/clear.js', clearSource).map(entry => ({ ...entry, key: 'home.title' }))
  ])
  const hello = Object.entries(catalog.entries)
    .filter(([, entry]) => entry.source === '你好')
    .map(([key, entry]) => ({ key, location: entry.locations[0] }))
    .sort((left, right) => left.location.start.line - right.location.start.line || left.location.start.column - right.location.start.column)
  assert.strictEqual(hello.length, 2)
  write(root, 'lang/catalog/identity-ambiguities.json', json({
    version: 1,
    ambiguities: [{
      proposedKey: 'src.ambiguous.newkey01',
      source: '你好',
      semanticHost: 'src/ambiguous.js::script',
      childRole: 'script-string',
      localContext: '0',
      location: hello[0].location,
      candidates: hello.map(item => ({
        key: item.key,
        source: '你好',
        semanticHost: 'src/ambiguous.js::script',
        childRole: 'script-string',
        localContext: '0'
      }))
    }]
  }))
  const before = snapshotFiles(root)
  const preview = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const report = JSON.parse(preview.stdout)
  assert.deepStrictEqual(report.replacements.map(item => ({ path: item.path, call: item.call })), [
    { path: 'src/ambiguous.js', call: `t('${hello[1].key}')` },
    { path: 'src/clear.js', call: "t('home.title')" }
  ])
  assert.deepStrictEqual(report.skipped.map(item => ({ key: item.key, reason: item.reason })), [
    { key: hello[0].key, reason: 'occurrence identity is ambiguous' }
  ])
  assert.deepStrictEqual(report.recognized.map(item => item.call), ["t('home.welcome')"])
  assert.ok(report.previews.find(item => item.path === 'src/ambiguous.js').content.includes('const first = "你好"'))
  assert.ok(report.previews.find(item => item.path === 'src/ambiguous.js').content.includes(`const second = t('${hello[1].key}')`))
  assert.ok(report.previews.find(item => item.path === 'src/ambiguous.js').content.includes("const kept = t('欢迎')"))
  assertUnchanged(root, before)

  const written = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  assert.ok(fs.readFileSync(path.join(root, 'src/ambiguous.js'), 'utf8').includes('const first = "你好"'))
  assert.ok(fs.readFileSync(path.join(root, 'src/ambiguous.js'), 'utf8').includes(`const second = t('${hello[1].key}')`))
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/clear.js'), 'utf8'), [
    "import { t } from './i18n'",
    "const title = t('home.title')",
    'export default title',
    ''
  ].join('\n'))

  fs.writeFileSync(path.join(root, 'src/ambiguous.js'), ambiguousSource)
  fs.writeFileSync(path.join(root, 'src/clear.js'), clearSource)
  fs.rmSync(path.join(root, 'lang/catalog/replacements.json'))
  const strictBefore = snapshotFiles(root)
  const strict = run(['replace', '--adapter', 'js', '--strict', '--write', '--json'], root)
  assert.strictEqual(strict.status, 7)
  assert.strictEqual(JSON.parse(strict.stdout).written, false)
  assertUnchanged(root, strictBefore)
})

test('replace reports stale occurrence metadata and does not rewrite that text', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    'const first = "你好"',
    'const second = "欢迎"',
    'export default [first, second]',
    ''
  ].join('\n')
  const stale = [
    "import { t } from './i18n'",
    'const first = "你好"',
    'const second = "再会"',
    'export default [first, second]',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, keyed(scriptEntries('src/app.js', source), { 你好: 'home.hello', 欢迎: 'home.welcome' }))
  fs.writeFileSync(path.join(root, 'src/app.js'), stale)
  const preview = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const report = JSON.parse(preview.stdout)
  assert.deepStrictEqual(report.replacements.map(item => item.call), ["t('home.hello')"])
  assert.deepStrictEqual(report.skipped.map(item => ({ key: item.key, source: item.source, reason: item.reason })), [
    { key: 'home.welcome', source: '欢迎', reason: 'catalog location does not match the current source' }
  ])
  assert.strictEqual(report.previews[0].content, [
    "import { t } from './i18n'",
    "const first = t('home.hello')",
    'const second = "再会"',
    'export default [first, second]',
    ''
  ].join('\n'))

  const written = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), report.previews[0].content)

  fs.writeFileSync(path.join(root, 'src/app.js'), stale)
  fs.rmSync(path.join(root, 'lang/catalog/replacements.json'))
  const before = snapshotFiles(root)
  const strict = run(['replace', '--adapter', 'js', '--strict', '--write', '--json'], root)
  assert.strictEqual(strict.status, 7)
  assert.strictEqual(JSON.parse(strict.stdout).written, false)
  assertUnchanged(root, before)
})

test('replace reports an unsupported position without rewriting it', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    "const labels = { '你好': '欢迎' }",
    'const message = "你好"',
    'export default [labels, message]',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  const catalog = writeCatalog(root, scriptEntries('src/app.js', source))
  const byText = {}
  for (const [key, entry] of Object.entries(catalog.entries)) {
    const list = byText[entry.source] || []
    list.push({ key, line: entry.locations[0].start.line, column: entry.locations[0].start.column })
    byText[entry.source] = list
  }
  const helloKeys = byText['你好'].map(item => item.key)
  assert.strictEqual(new Set(helloKeys).size, 2)
  const before = snapshotFiles(root)
  const preview = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const report = JSON.parse(preview.stdout)
  assert.deepStrictEqual(report.skipped.map(item => ({ source: item.source, reason: item.reason })), [
    { source: '你好', reason: 'object key is not a supported semantic position' }
  ])
  assert.strictEqual(report.replacements.length, 2)
  assert.notStrictEqual(report.replacements[0].call, report.replacements[1].call)
  assert.ok(report.previews[0].content.includes("const labels = { '你好': t("))
  assert.ok(!report.previews[0].content.includes('const message = "你好"'))
  assertUnchanged(root, before)

  const strict = run(['replace', '--adapter', 'js', '--strict', '--write', '--json'], root)
  assert.strictEqual(strict.status, 7)
  assert.strictEqual(JSON.parse(strict.stdout).written, false)
  assertUnchanged(root, before)
})

test('replace keeps a legacy MD5 call and the hash dictionary', () => {
  const root = tempProject()
  const hash = crypto.createHash('md5').update('你好', 'utf8').digest('hex')
  const source = [
    "import { t } from './i18n'",
    'const fresh = "你好"',
    `const legacy = t('${hash}')`,
    'export default [fresh, legacy]',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  write(root, 'lang/zh_hash.json', json({ [hash]: '你好' }))
  write(root, 'lang/zh_hash.map.json', json({ version: 1, entries: [{ key: hash, value: '你好' }] }))
  const catalog = writeCatalog(root, keyed(scriptEntries('src/app.js', source), { 你好: 'home.hello' }))
  assert.strictEqual(Object.keys(catalog.messages).length, 1)
  const dictionary = fs.readFileSync(path.join(root, 'lang/zh_hash.json'))
  const sourceMap = fs.readFileSync(path.join(root, 'lang/zh_hash.map.json'))
  const result = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const written = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8')
  assert.strictEqual(written, [
    "import { t } from './i18n'",
    "const fresh = t('home.hello')",
    `const legacy = t('${hash}')`,
    'export default [fresh, legacy]',
    ''
  ].join('\n'))
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.json')), dictionary)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.map.json')), sourceMap)
  const report = JSON.parse(result.stdout)
  assert.ok(report.files.every(file => file !== 'lang/zh_hash.json' && file !== 'lang/zh_hash.map.json'))
})

test('replace refuses a malformed occurrence identity ambiguity report and writes nothing', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    'const message = "你好"',
    'export default message',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, keyed(scriptEntries('src/app.js', source), { 你好: 'home.hello' }))
  write(root, 'lang/catalog/identity-ambiguities.json', '{ "version": 2, "ambiguities": [] }\n')
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(result.status, 1)
  assert.match(result.stderr, /occurrence identity ambiguity report is not version 1/)
  assert.strictEqual(JSON.parse(result.stdout).ok, false)
  assertUnchanged(root, before)
})

test('replace reports an orphaned occurrence and does not rewrite it', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    'const first = "你好"',
    'const second = "欢迎"',
    'export default [first, second]',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, keyed(scriptEntries('src/app.js', source), { 你好: 'home.hello', 欢迎: 'home.welcome' }))
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), 'utf8'))
  metadata.entries['home.hello'].status = 'orphaned'
  fs.writeFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), json(metadata))
  const preview = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const report = JSON.parse(preview.stdout)
  assert.deepStrictEqual(report.replacements.map(item => item.call), ["t('home.welcome')"])
  assert.deepStrictEqual(report.skipped.map(item => ({ key: item.key, reason: item.reason })), [
    { key: 'home.hello', reason: 'orphaned occurrence is outside the current collection' }
  ])
  assert.ok(report.previews[0].content.includes('const first = "你好"'))
  assert.ok(report.previews[0].content.includes("const second = t('home.welcome')"))

  const written = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  assert.ok(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8').includes('const first = "你好"'))

  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  fs.rmSync(path.join(root, 'lang/catalog/replacements.json'))
  const before = snapshotFiles(root)
  const strict = run(['replace', '--adapter', 'js', '--strict', '--write', '--json'], root)
  assert.strictEqual(strict.status, 7)
  assertUnchanged(root, before)
})

test('replace prints an intelligible per-file preview', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    'const message = "你好"',
    'export default message',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  writeCatalog(root, keyed(scriptEntries('src/app.js', source), { 你好: 'home.hello' }))
  const result = run(['replace', '--adapter', 'js'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(result.stdout, [
    'Dry run (js). No source or catalog file was modified.',
    'Replacements: 1. Skipped: 0. Already localized: 0.',
    '',
    'src/app.js',
    '  replace 2:16 script-string "你好" with t(\'home.hello\')',
    '  ---',
    "import { t } from './i18n'",
    "const message = t('home.hello')",
    'export default message',
    ''
  ].join('\n'))
})
