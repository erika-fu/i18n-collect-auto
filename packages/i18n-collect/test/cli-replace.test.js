const assert = require('assert')
const { spawnSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { buildCatalog, catalogMetadata, REPRESENTATION_LOCALIZED_CALL } = require('../mycommon/catalog')
const { extractScript } = require('../myloader/extract-script')
const { extractHtml } = require('../myloader/extract-html')
const { extractVueScript } = require('../myloader/extract-vue-compat')
const { installVue2 } = require('./vue2-fixture')
const { installVue3 } = require('./vue3-fixture')
const { assertLangUnchanged, seedSourceCatalog, snapshotLangTree } = require('./build-test-helpers')
const { keyFor } = require('../mycommon/store')

const HELLO = keyFor('你好')
const WELCOME = keyFor('欢迎')
const JIA = keyFor('甲文')
const YI = keyFor('乙文')

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

function sourceTextEntries(entries) {
  return entries.filter(entry => entry.representation !== REPRESENTATION_LOCALIZED_CALL)
}

function keyed(entries, keys) {
  const sourceText = sourceTextEntries(entries).map(entry => {
    const key = keys[entry.value]
    if (!key) throw new Error(`missing key for ${JSON.stringify(entry.value)}`)
    return { value: entry.value, key, locations: entry.locations }
  })
  // Replace fixtures sometimes keep Chinese call arguments; rebuild those as source-text catalog rows.
  const fromCalls = entries
    .filter(entry => entry.representation === REPRESENTATION_LOCALIZED_CALL && keys[entry.key])
    .map(entry => ({
      value: entry.key,
      key: keys[entry.key],
      locations: entry.locations
    }))
  return [...sourceText, ...fromCalls]
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

function prepareCatalog(root, options) {
  return seedSourceCatalog(root, options)
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

test('replace requires a known adapter and a fresh source catalog', () => {
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
  assert.match(noCatalog.stderr, /missing source catalog/)
  assert.match(noCatalog.stderr, /source-catalog\.json/)
  const writeFlag = run(['replace', '--adapter', 'js', '--write'], root)
  assert.strictEqual(writeFlag.status, 1)
  assert.match(writeFlag.stderr, /missing source catalog/)
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
  prepareCatalog(root)
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
  assert.strictEqual(report.replacements[0].call, "t('7eca689f0d3389d9dea66ae112e5cfd7')")
  assert.strictEqual(report.replacements[0].kind, 'script-string')
  assert.strictEqual(report.replacements[0].source, '你好')
  assert.deepStrictEqual(report.previews, [{
    path: 'src/app.js',
    content: [
      "import { t } from './i18n'",
      `const message = t('${HELLO}')`,
      'export default message',
      ''
    ].join('\n')
  }])
  assertUnchanged(root, before)
  const again = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(again.stdout, result.stdout)
  assertUnchanged(root, before)
})

test('replace dry-run after --write reports no further replacements', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    'const message = "你好"',
    'export default message',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  prepareCatalog(root)
  const written = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(written.status, 0, written.stderr)
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.replacements, [])
  assert.deepStrictEqual(report.previews, [])
  assertUnchanged(root, before)
})

test('replace fails when the js adapter has no exported localization function', () => {
  const root = tempProject()
  const source = 'const message = "你好"\n'
  write(root, 'src/local.js', 'function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  prepareCatalog(root)
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 1)
  assert.match(result.stderr, /exports a localization function named t/)
  assert.match(result.stderr, /does not rewrite application bootstrap/)
  assertUnchanged(root, before)
})

test('replace accepts a CommonJS module that exports t', () => {
  const root = tempProject()
  const source = "const { t } = require('./i18n')\nmodule.exports = /* i18n-key: home.keep */ '保留'\nconst message = \"你好\"\n"
  write(root, 'src/i18n.js', 'module.exports = { t(key) { return key } }\n')
  write(root, 'src/app.js', source)
  prepareCatalog(root)
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(
    report.replacements.map(item => item.call).sort(),
    [`t('home.keep')`, `t('${HELLO}')`].sort()
  )
  assert.strictEqual(report.recognized.length, 0)
  assert.strictEqual(report.previews[0].content, `const { t } = require('./i18n')\nmodule.exports = /* i18n-key: home.keep */ t('home.keep')\nconst message = t('${HELLO}')\n`)
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
  prepareCatalog(root)
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.previews, [
    {
      path: 'src/copy.js',
      content: [
        "import { t } from './i18n'",
        "const plain = t('47781b8a72bcbb7ecb1f955399a7e718')",
        'const greeting = `你好${name}`',
        ''
      ].join('\n')
    },
    {
      path: 'src/label.ts',
      content: [
        "import { t } from './i18n'",
        "const label: string = t('14d342362f66aa86e2aa1c1e11aa1204')",
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
  prepareCatalog(root)
  const before = snapshotFiles(root)
  const loose = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(loose.status, 0, loose.stderr)
  const looseReport = JSON.parse(loose.stdout)
  assert.deepStrictEqual(looseReport.replacements.map(item => item.call), ["t('7eca689f0d3389d9dea66ae112e5cfd7')"])
  assert.deepStrictEqual(looseReport.skipped.map(item => item.reason), ['object key is not a supported semantic position'])
  assert.strictEqual(looseReport.previews[0].content, [
    "import { t } from './i18n'",
    "const labels = { '标题': t('7eca689f0d3389d9dea66ae112e5cfd7') }",
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
  prepareCatalog(root)
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
  prepareCatalog(root)
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
  installVue3(root)
  prepareCatalog(root)
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.replacements.map(item => item.call), [`t('${HELLO}')`])
  const skips = report.skipped.map(item => [item.path, item.reason])
  for (const expected of [
    ['src/Button.jsx', 'React JSX is outside replacement scope'],
    ['src/Panel.vue', 'Vue template text is not a js adapter position']
  ]) {
    assert.ok(skips.some(item => item[0] === expected[0] && item[1] === expected[1]), `missing skip ${expected}`)
  }
  assertUnchanged(root, before)
})

function vue2Runtime(root) {
  write(root, 'package.json', json({ dependencies: { 'vue-i18n': '8.28.2' } }))
  installVue2(root)
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
  '  <p :title="$t(\'32c65d8d7431e76029678ec7bb73a5ab\')">{{ $t(\'47781b8a72bcbb7ecb1f955399a7e718\') }}</p>',
  '  <input :placeholder="$t(\'02cc4f8f5a9aefbc03c778f7a5c989c7\')">',
  '  <p>{{ $t(\'71dc8fdff64477b84e26f61bd299e5fb\') }}</p>',
  '  <p>{{ `${$t(\'4c9bb42608b11278a5d9a2471b74eb40\')}${name}` }}</p>',
  '</template>',
  '<script>',
  'export default {',
  '  data() {',
  '    return { title: this.$t(\'0d83078816aa273f2941c9b55ec82bf3\') }',
  '  },',
  '  methods: {',
  '    greet() {',
  '      return this.$t(\'7eca689f0d3389d9dea66ae112e5cfd7\')',
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
  prepareCatalog(root)
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'vue2', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.skipped, [])
  assert.deepStrictEqual(report.previews, [{ path: 'src/Home.vue', content: VUE2_PREVIEW }])
  assert.deepStrictEqual(report.replacements.map(item => item.call).sort(), [
    "$t('02cc4f8f5a9aefbc03c778f7a5c989c7')",
    "$t('32c65d8d7431e76029678ec7bb73a5ab')",
    "$t('47781b8a72bcbb7ecb1f955399a7e718')",
    "$t('4c9bb42608b11278a5d9a2471b74eb40')",
    "$t('71dc8fdff64477b84e26f61bd299e5fb')",
    "this.$t('0d83078816aa273f2941c9b55ec82bf3')",
    "this.$t('7eca689f0d3389d9dea66ae112e5cfd7')"
  ].sort())
  assertUnchanged(root, before)
})

test('replace skips Vue 2 positions that cannot call this.$t', () => {
  const root = tempProject()
  vue2Runtime(root)
  const source = [
    '<template>',
    '  <p>欢迎</p>',
    '</template>',
    '<script>',
    'const top = \'顶层\'',
    'export default {',
    '  methods: {',
    '    arrow: () => \'箭头\',',
    '    greet() {',
    '      function inner() { return \'内部\' }',
    '      return \'你好\'',
    '    }',
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
  write(root, 'src/Home.vue', source)
  prepareCatalog(root)
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'vue2', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.skipped.map(item => [item.source, item.reason]), [
    ['顶层', 'vue2 adapter requires a component instance method'],
    ['箭头', 'arrow function does not provide a Vue instance'],
    ['内部', 'vue2 adapter requires a component instance method']
  ])
  assert.ok(report.replacements.some(item => item.source === '欢迎'))
  assert.ok(report.replacements.some(item => item.source === '你好'))
  assertUnchanged(root, before)
})

test('replace does not nest a string that is already inside a template localization call', () => {
  const root = tempProject()
  vue2Runtime(root)
  const BYE = keyFor('再见')
  const source = [
    '<template>',
    `  <p>{{ $t('${WELCOME}' + '${HELLO}') }}</p>`,
    `  <p>{{ $t(/* note */ '${BYE}') }}</p>`,
    '</template>',
    ''
  ].join('\n')
  const literal = [
    '<template>',
    '  <p>欢迎</p>',
    '  <p>你好</p>',
    '  <p>再见</p>',
    '</template>',
    ''
  ].join('\n')
  write(root, 'src/Home.vue', literal)
  prepareCatalog(root)
  write(root, 'src/Home.vue', source)
  prepareCatalog(root)
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'vue2', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.replacements, [])
  assert.deepStrictEqual(report.previews, [])
  assert.deepStrictEqual(report.replacements, [])
  assert.deepStrictEqual(report.previews, [])
  assertUnchanged(root, before)
})

test('replace ignores a commented VueI18n call and a non-function t export', () => {
  const commented = tempProject()
  write(commented, 'package.json', json({ dependencies: { 'vue-i18n': '8.28.2' } }))
  write(commented, 'src/main.js', '// new VueI18n({})\nconst note = "Vue.use(VueI18n)"\n')
  write(commented, 'src/Home.vue', '<template><p>欢迎</p></template>\n')
  installVue2(commented)
  prepareCatalog(commented)
  const vue = run(['replace', '--adapter', 'vue2', '--json'], commented)
  assert.strictEqual(vue.status, 1)
  assert.match(vue.stderr, /vue-i18n 8/)

  const numberExport = tempProject()
  write(numberExport, 'src/i18n.js', 'export const t = 1\n')
  write(numberExport, 'src/app.js', 'const message = "你好"\n')
  prepareCatalog(numberExport)
  const missing = run(['replace', '--adapter', 'js', '--json'], numberExport)
  assert.strictEqual(missing.status, 1)
  assert.match(missing.stderr, /exports a localization function named t/)

  const def = tempProject()
  const source = 'const message = "你好"\n'
  write(def, 'src/i18n.js', 'export default { t(key) { return key } }\n')
  write(def, 'src/app.js', source)
  prepareCatalog(def)
  const accepted = run(['replace', '--adapter', 'js', '--json'], def)
  assert.strictEqual(accepted.status, 0, accepted.stderr)
  assert.strictEqual(JSON.parse(accepted.stdout).skipped[0].reason, 'js adapter requires t to already be in scope')
})

test('replace fails when the Vue 2 runtime integration is missing', () => {
  const root = tempProject()
  write(root, 'package.json', json({ dependencies: { 'vue-i18n': '9.14.0' } }))
  write(root, 'src/Home.vue', '<template><p>欢迎</p></template>\n')
  installVue2(root)
  prepareCatalog(root)
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'vue2', '--json'], root)
  assert.strictEqual(result.status, 1)
  assert.match(result.stderr, /vue-i18n 8/)
  assert.match(result.stderr, /does not install dependencies or rewrite application bootstrap/)
  assertUnchanged(root, before)
})

function vue3Runtime(root) {
  write(root, 'package.json', json({ dependencies: { 'vue-i18n': '9.14.0' } }))
  installVue3(root)
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
  prepareCatalog(root)
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'vue3', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.skipped, [])
  assert.deepStrictEqual(report.previews, [{
    path: 'src/Home.vue',
    content: [
      '<template>',
      '  <p>{{ $t(\'47781b8a72bcbb7ecb1f955399a7e718\') }}</p>',
      '</template>',
      '<script setup>',
      "import { t } from './i18n'",
      "const title = t('32c65d8d7431e76029678ec7bb73a5ab')",
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
  prepareCatalog(root)
  const result = run(['replace', '--adapter', 'vue3', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.previews[0].content, [
    '<template><p>{{ $t(\'47781b8a72bcbb7ecb1f955399a7e718\') }}</p></template>',
    '<script>',
    'export default {',
    '  methods: {',
    '    greet() {',
    '      return this.$t(\'7eca689f0d3389d9dea66ae112e5cfd7\')',
    '    }',
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n'))
})

test('replace revalidates analysis when the committed source catalog is stale', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    'const message = "你好"',
    'export default message',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  prepareCatalog(root)
  fs.writeFileSync(path.join(root, 'src/app.js'), [
    "import { t } from './i18n'",
    'const message = "欢迎"',
    'export default message',
    ''
  ].join('\n'))
  const preview = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(preview.status, 2, preview.stderr)
  assert.match(preview.stderr, /source catalog|no longer matches|scan/i)
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
  prepareCatalog(root)
  const partial = run(['replace', '--adapter', 'vue3', '--json'], root)
  assert.strictEqual(partial.status, 0, partial.stderr)
  const partialReport = JSON.parse(partial.stdout)
  assert.strictEqual(partialReport.skipped[0].reason, 'vue3 adapter requires t to already be in scope')
  assert.match(partialReport.previews[0].content, new RegExp(`\\{\\{ \\$t\\('${WELCOME}'\\) \\}\\}`))

  const bare = tempProject()
  write(bare, 'package.json', json({ dependencies: { 'vue-i18n': '9.14.0' } }))
  write(bare, 'src/Home.vue', '<template><p>欢迎</p></template>\n')
  installVue3(bare)
  prepareCatalog(bare)
  const before = snapshotFiles(bare)
  const missing = run(['replace', '--adapter', 'vue3', '--json'], bare)
  assert.strictEqual(missing.status, 1)
  assert.match(missing.stderr, /createI18n/)
  assert.match(missing.stderr, /does not install dependencies or rewrite application bootstrap/)
  assertUnchanged(bare, before)
})

test('replace --write commits source only and stays idempotent', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    'const message = "你好"',
    'export default message',
    ''
  ].join('\n')
  const writtenSource = [
    "import { t } from './i18n'",
    `const message = t('${HELLO}')`,
    'export default message',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  prepareCatalog(root)
  write(root, 'lang/catalog/en.json', json({ [HELLO]: 'Hello' }))
  write(root, 'lang/catalog/translation-state.json', json({
    version: 1,
    locales: { en: { [HELLO]: { sourceFingerprint: 'kept', review: 'current' } } }
  }))
  const langBefore = snapshotLangTree(root)
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
  assert.deepStrictEqual(report.files, ['src/app.js'])
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), writtenSource)
  assertLangUnchanged(langBefore, root)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/replacements.json')), false)
  assert.deepStrictEqual(
    fs.readdirSync(path.join(root, 'lang/catalog')).filter(name => name.includes('.tmp-') || name.includes('.bak-') || name.startsWith('.commit-')),
    []
  )

  const again = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(again.status, 0, again.stderr)
  const second = JSON.parse(again.stdout)
  assert.strictEqual(second.written, false)
  assert.deepStrictEqual(second.files, [])
  assert.deepStrictEqual(second.replacements, [])
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), writtenSource)
  assertLangUnchanged(langBefore, root)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog/replacements.json')), false)
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
  prepareCatalog(root)
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

test('a failed replacement restores source files only', () => {
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
  prepareCatalog(root)
  write(root, 'lang/catalog/en.json', json({ '2d001bc1f90728b70d8695df6ca6ca63': 'A' }))
  const catalog = path.join(root, 'lang/catalog')
  const hook = path.join(root, 'fail-replacement.js')
  fs.writeFileSync(hook, `const fs = require('fs')
const path = require('path')
const rename = fs.renameSync.bind(fs)
let sawFirstSource = false
fs.renameSync = (from, to) => {
  const base = path.basename(String(to))
  const final = String(from).includes('.tmp-')
  if (final && base === 'b.js' && sawFirstSource) {
    const error = new Error('simulated storage failure')
    error.code = 'EIO'
    throw error
  }
  const result = rename(from, to)
  if (final && base === 'a.js') sawFirstSource = true
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
  prepareCatalog(root)
  const hook = path.join(root, 'interrupt-replacement.js')
  fs.writeFileSync(hook, `const fs = require('fs')
const path = require('path')
const rename = fs.renameSync.bind(fs)
let sawFirstSource = false
fs.renameSync = (from, to) => {
  const base = path.basename(String(to))
  const final = String(from).includes('.tmp-')
  if (final && base === 'b.js' && sawFirstSource) process.exit(99)
  const result = rename(from, to)
  if (final && base === 'a.js') sawFirstSource = true
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
    `const message = t('${JIA}')`,
    'export default message',
    ''
  ].join('\n'))
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/b.js'), 'utf8'), [
    "import { t } from './i18n'",
    `const message = t('${YI}')`,
    'export default message',
    ''
  ].join('\n'))
  assert.deepStrictEqual(
    fs.readdirSync(path.join(root, 'lang/catalog')).filter(name => name.includes('.tmp-') || name.includes('.bak-') || name.startsWith('.commit-')),
    []
  )
})

test('replace rewrites identical text with one shared automatic key', () => {
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
  prepareCatalog(root)
  const before = snapshotFiles(root)
  const result = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.skipped, [])
  assert.deepStrictEqual(report.replacements.map(item => item.call), [`t('${HELLO}')`, `t('${HELLO}')`])
  assert.strictEqual(report.replacements[0].key, HELLO)
  assert.strictEqual(report.replacements[1].key, HELLO)
  assert.strictEqual(report.previews[0].content, [
    "import { t } from './i18n'",
    `const first = t('${HELLO}')`,
    `const second = t('${HELLO}')`,
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
  prepareCatalog(root)
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

test('replace refuses --write when source no longer matches the committed catalog', () => {
  const root = tempProject()
  const source = [
    "import { t } from './i18n'",
    'const message = "你好"',
    'export default message',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', source)
  prepareCatalog(root)
  const preview = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  fs.writeFileSync(path.join(root, 'src/app.js'), [
    "import { t } from './i18n'",
    'const message = "欢迎"',
    'export default message',
    ''
  ].join('\n'))
  const writeAttempt = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(writeAttempt.status, 2, writeAttempt.stderr)
  assert.match(writeAttempt.stderr, /source catalog|no longer matches|scan/i)
})

test('replace reports an unsupported object key without rewriting it', () => {
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
  prepareCatalog(root)
  const before = snapshotFiles(root)
  const preview = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const report = JSON.parse(preview.stdout)
  assert.deepStrictEqual(report.skipped.map(item => ({ source: item.source, reason: item.reason })), [
    { source: '你好', reason: 'object key is not a supported semantic position' }
  ])
  assert.strictEqual(report.replacements.length, 2)
  assert.deepStrictEqual(
    report.replacements.map(item => item.call).sort(),
    [`t('${HELLO}')`, `t('${WELCOME}')`].sort()
  )
  assert.ok(report.previews[0].content.includes(`const labels = { '你好': t('${WELCOME}')`))
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
  const literal = [
    "import { t } from './i18n'",
    'const fresh = "你好"',
    `const legacy = t('${hash}')`,
    'export default [fresh, legacy]',
    ''
  ].join('\n')
  const migrated = [
    "import { t } from './i18n'",
    `const fresh = t('${HELLO}')`,
    `const legacy = t('${hash}')`,
    'export default [fresh, legacy]',
    ''
  ].join('\n')
  write(root, 'src/i18n.js', 'export function t(key) { return key }\n')
  write(root, 'src/app.js', literal)
  write(root, 'lang/zh_hash.json', json({ [hash]: '你好' }))
  write(root, 'lang/zh_hash.map.json', json({ version: 1, entries: [{ key: hash, value: '你好' }] }))
  prepareCatalog(root)
  write(root, 'src/app.js', migrated)
  prepareCatalog(root)
  const dictionary = fs.readFileSync(path.join(root, 'lang/zh_hash.json'))
  const sourceMap = fs.readFileSync(path.join(root, 'lang/zh_hash.map.json'))
  const result = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), migrated)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.json')), dictionary)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.map.json')), sourceMap)
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report.files, [])
  assert.strictEqual(report.written, false)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/replacements.json')))
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
  prepareCatalog(root)
  const result = run(['replace', '--adapter', 'js'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(result.stdout, [
    'Dry run (js). No source, catalog, audit, or metadata file was modified.',
    'Replacements: 1. Skipped: 0. Already localized: 0.',
    '',
    'src/app.js',
    '  replace 2:16 script-string "你好" with t(\'7eca689f0d3389d9dea66ae112e5cfd7\')',
    '  ---',
    "import { t } from './i18n'",
    `const message = t('${HELLO}')`,
    'export default message',
    ''
  ].join('\n'))
})
