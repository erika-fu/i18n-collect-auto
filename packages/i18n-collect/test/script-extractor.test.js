const assert = require('assert')
const test = require('node:test')
const { extractScript } = require('../myloader/extract-script')

function extract(source, projectPath = 'src/example.js', config) {
  return extractScript({ source, resource: { projectPath }, config })
}

test('collects an ordinary string without executing or concatenating expressions', () => {
  const source = 'const message = "你好"\nconst split = "你" + missing + "好"\n'
  const entries = extract(source)
  assert.deepStrictEqual(entries.map(entry => entry.value).sort(), ['你好', '你', '好'].sort())
  const whole = entries.find(entry => entry.value === '你好')
  assert.strictEqual(whole.locations.length, 1)
  assert.strictEqual(whole.locations[0].path, 'src/example.js')
  assert.strictEqual(whole.locations[0].kind, 'script-string')
  assert.deepStrictEqual(whole.locations[0].start, { line: 1, column: 16 })
  assert.deepStrictEqual(whole.locations[0].end, { line: 1, column: 20 })
  assert.strictEqual(source.slice(16, 20), '"你好"')
})

test('collects each static template segment and leaves interpolation unevaluated', () => {
  const source = 'const name = "名字"\nconst message = `你好${name}世界`\n'
  const entries = extract(source)
  assert.deepStrictEqual(entries.map(entry => entry.value).sort(), ['世界', '你好', '名字'].sort())
  const greeting = entries.find(entry => entry.value === '你好')
  const place = entries.find(entry => entry.value === '世界')
  assert.strictEqual(greeting.locations[0].kind, 'template-literal')
  assert.deepStrictEqual(greeting.locations[0].start, { line: 2, column: 17 })
  assert.deepStrictEqual(greeting.locations[0].end, { line: 2, column: 19 })
  assert.strictEqual(place.locations[0].kind, 'template-literal')
  assert.deepStrictEqual(place.locations[0].start, { line: 2, column: 26 })
  assert.deepStrictEqual(place.locations[0].end, { line: 2, column: 28 })
  assert.strictEqual(source.split('\n')[1].slice(17, 19), '你好')
  assert.strictEqual(source.split('\n')[1].slice(26, 28), '世界')
  assert.ok(!entries.some(entry => entry.value.includes('名字世界') || entry.value === '你好名字世界'))
})

test('collects a string that stands alone inside a template expression', () => {
  const source = 'const message = `前缀${"内嵌"}后缀`\n'
  const entries = extract(source)
  const nested = entries.find(entry => entry.value === '内嵌')
  const prefix = entries.find(entry => entry.value === '前缀')
  const suffix = entries.find(entry => entry.value === '后缀')
  assert.strictEqual(nested.locations[0].kind, 'script-string')
  assert.deepStrictEqual(nested.locations[0].start, { line: 1, column: 21 })
  assert.deepStrictEqual(nested.locations[0].end, { line: 1, column: 25 })
  assert.strictEqual(source.slice(21, 25), '"内嵌"')
  assert.strictEqual(prefix.locations[0].kind, 'template-literal')
  assert.deepStrictEqual(prefix.locations[0].start, { line: 1, column: 17 })
  assert.deepStrictEqual(prefix.locations[0].end, { line: 1, column: 19 })
  assert.strictEqual(suffix.locations[0].kind, 'template-literal')
  assert.deepStrictEqual(suffix.locations[0].start, { line: 1, column: 26 })
  assert.deepStrictEqual(suffix.locations[0].end, { line: 1, column: 28 })
})

test('ignores import and export module specifiers', () => {
  const source = [
    'import local from "./中文模块"',
    'import "./另一个模块"',
    'export * from "./导出全部"',
    'export { value } from "./导出命名"',
    'export const kept = "保留文案"',
    'export default "默认文案"',
    ''
  ].join('\n')
  assert.deepStrictEqual(extract(source).map(entry => entry.value).sort(), ['保留文案', '默认文案'].sort())
})

test('keeps the whole fragment when it contains any Han character', () => {
  const basic = extract('const label = "你好"\n')
  const extension = extract('const label = "\u{20000}"\n')
  const mixed = extract('const label = "你好，123 ABC"\n')
  assert.deepStrictEqual(basic.map(entry => entry.value), ['你好'])
  assert.deepStrictEqual(extension.map(entry => entry.value), ['\u{20000}'])
  assert.deepStrictEqual(mixed.map(entry => entry.value), ['你好，123 ABC'])
})

test('skips punctuation, whitespace, and English fragments', () => {
  const source = 'const a = "，。！"\nconst b = "   "\nconst c = "hello"\nconst d = `...${1}`\n'
  assert.deepStrictEqual(extract(source), [])
})

test('counts an astral character before a JavaScript fragment as two UTF-16 columns', () => {
  const source = 'const s = "😀" + "好"\n'
  const entry = extract(source).find(item => item.value === '好')
  assert.deepStrictEqual(entry.locations[0].start, { line: 1, column: 17 })
  assert.deepStrictEqual(entry.locations[0].end, { line: 1, column: 20 })
  assert.strictEqual(source.slice(17, 20), '"好"')
})

test('keeps JavaScript columns on the next line after CRLF', () => {
  const source = 'const message = "你好"\r\nconst b = "世界"\r\n'
  const entry = extract(source).find(item => item.value === '世界')
  assert.deepStrictEqual(entry.locations[0].start, { line: 2, column: 10 })
  assert.deepStrictEqual(entry.locations[0].end, { line: 2, column: 14 })
})

test('an exclusion directive immediately before a string excludes that string only', () => {
  const source = [
    'const excluded = /* no-i18n-auto */ "排除"',
    'const kept = "保留"',
    ''
  ].join('\n')
  const entries = extract(source)
  assert.deepStrictEqual(entries.map(entry => entry.value), ['保留'])
  const kept = entries[0]
  assert.strictEqual(kept.locations[0].kind, 'script-string')
  assert.strictEqual(kept.locations[0].path, 'src/example.js')
  assert.deepStrictEqual(kept.locations[0].start, { line: 2, column: 13 })
  assert.deepStrictEqual(kept.locations[0].end, { line: 2, column: 17 })
  assert.strictEqual(source.split('\n')[1].slice(13, 17), '"保留"')
})

test('an exclusion directive before a template literal excludes only its next collected fragment', () => {
  const source = [
    'const message = /* no-i18n-auto */ `排除${name}保留`',
    'const nested = `前${/* no-i18n-auto */ "内嵌"}后`',
    'const later = /* no-i18n-auto */ `hello${name}世界再${name}见`',
    'const adjacent = "相邻"',
    ''
  ].join('\n')
  assert.deepStrictEqual(extract(source).map(entry => entry.value), ['保留', '前', '后', '见', '相邻'])
})

test('a line comment excludes the literal it immediately precedes', () => {
  const source = [
    'const excluded =',
    '  // no-i18n-auto',
    '  "排除"',
    'const kept = "保留"',
    ''
  ].join('\n')
  assert.deepStrictEqual(extract(source).map(entry => entry.value), ['保留'])
})

test('ordinary comments are not collected and do not exclude nearby copy', () => {
  const source = [
    '// 这是注释',
    'const first = "仍收集"',
    '/* 另一条注释 */',
    'const second = "另一条"',
    ''
  ].join('\n')
  const entries = extract(source)
  assert.deepStrictEqual(entries.map(entry => entry.value), ['仍收集', '另一条'])
  assert.ok(entries.every(entry => !entry.value.includes('注释')))
})

test('malformed comments and a directive separated by code do not exclude', () => {
  const source = [
    '// no-i18n-auto',
    'const separated = "仍收集"',
    'const extra = /* no-i18n-auto extra */ "带多余文字"',
    'const typo = /* no-i18n-aut */ "拼写不对"',
    'const upper = /* NO-I18N-AUTO */ "大小写不对"',
    ''
  ].join('\n')
  assert.deepStrictEqual(extract(source).map(entry => entry.value), ['仍收集', '带多余文字', '拼写不对', '大小写不对'])
})

test('keeps logging, test, and analytics copy unless that context filter is selected', () => {
  const source = [
    'const label = "界面文案"',
    'console.log("日志文案")',
    'console.info(`日志前缀${name}日志后缀`)',
    'logger.warn({ message: "警告文案" })',
    'console.log(format("仍是界面"))',
    'it("用例标题", () => { const sample = "断言文案" })',
    'expect(node).toBe("期望文案")',
    'const outside = "测试文件里的界面"',
    'gtag("event", "埋点文案")',
    'analytics.track({ name: "分析文案" })',
    'dataLayer.push({ event: "数据层文案" })',
    ''
  ].join('\n')
  const all = [
    '界面文案',
    '日志文案',
    '日志前缀',
    '日志后缀',
    '警告文案',
    '仍是界面',
    '用例标题',
    '断言文案',
    '期望文案',
    '测试文件里的界面',
    '埋点文案',
    '分析文案',
    '数据层文案'
  ]
  assert.deepStrictEqual(extract(source).map(entry => entry.value).sort(), all.sort())
  assert.deepStrictEqual(
    extract(source, 'src/example.js', { contextFilters: ['logging'] }).map(entry => entry.value).sort(),
    ['界面文案', '仍是界面', '用例标题', '断言文案', '期望文案', '测试文件里的界面', '埋点文案', '分析文案', '数据层文案'].sort()
  )
})

test('selects test and analytics context filters independently', () => {
  const source = [
    'const label = "界面文案"',
    'console.log("日志文案")',
    'it.only("用例标题", () => { const sample = "断言文案" })',
    'const outside = "测试文件里的界面"',
    'track("埋点文案")',
    'analytics.page("分析文案")',
    'dataLayer.push({ event: "数据层文案" })',
    'report({ event: "仍是界面" })',
    ''
  ].join('\n')
  assert.deepStrictEqual(
    extract(source, 'src/example.js', { contextFilters: ['tests'] }).map(entry => entry.value).sort(),
    ['界面文案', '日志文案', '测试文件里的界面', '埋点文案', '分析文案', '数据层文案', '仍是界面'].sort()
  )
  assert.deepStrictEqual(
    extract(source, 'src/example.js', { contextFilters: ['analytics'] }).map(entry => entry.value).sort(),
    ['界面文案', '日志文案', '用例标题', '断言文案', '测试文件里的界面', '仍是界面'].sort()
  )
})

test('leaves optional calls collected and omits todo test titles when tests are selected', () => {
  const source = [
    'console.log?.("可选日志")',
    'describe.todo("待写套件")',
    'it.todo("待写用例")',
    'const label = "界面文案"',
    ''
  ].join('\n')
  assert.deepStrictEqual(
    extract(source, 'src/example.js', { contextFilters: ['logging', 'tests'] }).map(entry => entry.value).sort(),
    ['可选日志', '界面文案'].sort()
  )
})

test('collects JavaScript literals from a JSX-containing module', () => {
  const source = [
    "const title = 'React 标题'",
    'const message = `你有${count}条任务`',
    'export const App = () => <main><h1>{title}</h1><p>{message}</p></main>',
    ''
  ].join('\n')
  const entries = extract(source, 'src/App.jsx')
  assert.deepStrictEqual(entries.map(entry => entry.value).sort(), ['React 标题', '你有', '条任务'].sort())
  const title = entries.find(entry => entry.value === 'React 标题')
  const prefix = entries.find(entry => entry.value === '你有')
  assert.strictEqual(title.locations[0].kind, 'script-string')
  assert.strictEqual(prefix.locations[0].kind, 'template-literal')
  assert.strictEqual(title.locations[0].path, 'src/App.jsx')
  assert.strictEqual(source.slice(title.locations[0].start.column, title.locations[0].end.column), "'React 标题'")
})

function keysByValue(entries) {
  return Object.fromEntries(entries.map(entry => [entry.value, entry.key]))
}

test('an adjacent i18n-key directive gives the next collected fragment an explicit key', () => {
  const source = [
    'const title = /* i18n-key: home.title */ "首页"',
    'const plain = "普通"',
    'const greet = /* i18n-key: home.greet */ `你好${name}世界`',
    '// i18n-key: home.ignored',
    'const away = "隔开"',
    ''
  ].join('\n')
  assert.deepStrictEqual(keysByValue(extract(source)), {
    首页: 'home.title',
    普通: undefined,
    你好: 'home.greet',
    世界: undefined,
    隔开: undefined
  })
})

test('stacked directives combine exclusion and key, and agreeing duplicate keys are one key', () => {
  const source = [
    'const a = /* i18n-key: same.key */ /* i18n-key: same.key */ "同键"',
    'const b = /* no-i18n-auto */ /* i18n-key: gone.key */ "排除"',
    ''
  ].join('\n')
  assert.deepStrictEqual(keysByValue(extract(source)), { 同键: 'same.key' })
})

test('a malformed or conflicting i18n-key directive fails at its source position', () => {
  assert.throws(
    () => extract('const a = 1\nconst t = /* i18n-key home.title */ "首页"\n'),
    error => /malformed i18n-key directive/.test(error.message) && error.loc.line === 2 && error.loc.column === 10
  )
  assert.throws(
    () => extract('const t = /* i18n-key: 1bad */ "首页"\n'),
    /malformed i18n-key directive/
  )
  assert.throws(
    () => extract('const t = /* i18n-key: a.one */ /* i18n-key: a.two */ "首页"\n'),
    error => /conflicting i18n-key directives "a.one" and "a.two"/.test(error.message) && error.loc.line === 1
  )
  assert.doesNotThrow(() => extract('// i18n-keys are documented elsewhere\nconst t = "首页"\n'))
})
