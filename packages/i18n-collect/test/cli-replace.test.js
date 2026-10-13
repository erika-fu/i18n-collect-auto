const assert = require('assert')
const { spawnSync } = require('child_process')
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
  assert.match(writeFlag.stderr, /unknown option "--write"/)
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
