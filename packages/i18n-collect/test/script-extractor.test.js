const assert = require('assert')
const test = require('node:test')
const { extractScript } = require('../myloader/extract-script')

function extract(source, projectPath = 'src/example.js') {
  return extractScript({ source, resource: { projectPath } })
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
