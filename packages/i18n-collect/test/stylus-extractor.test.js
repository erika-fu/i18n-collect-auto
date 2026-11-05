const assert = require('assert')
const test = require('node:test')
const { extractCss } = require('../myloader/extract-css')

function extract(source, lang = 'styl', resource = {}) {
  return extractCss({
    source,
    resource: {
      projectPath: `src/theme.${lang}`,
      block: 'style',
      styleIndex: 0,
      lang,
      identity: `src/theme.${lang}::style[index=0;lang=${lang}]`,
      ...resource
    },
    config: { styleExtensions: ['.css', '.styl', '.stylus'] }
  })
}

function values(result) {
  return result.entries.map(entry => entry.value)
}

function indexAt(source, position) {
  let line = 1
  let column = 0
  for (let index = 0; index <= source.length; index += 1) {
    if (line === position.line && column === position.column) return index
    const char = source[index]
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      line += 1
      column = 0
    } else {
      column += 1
    }
  }
  throw new Error(`Missing ${position.line}:${position.column}`)
}

function sliceAt(source, location) {
  return source.slice(indexAt(source, location.start), indexAt(source, location.end))
}

for (const lang of ['styl', 'stylus']) {
  test(`collects directly authored strings from indented ${lang} content declarations`, () => {
    const source = [
      '@import "labels"',
      'label = "变量"',
      'generated()',
      '  content "混入"',
      'lookup()',
      '  return "函数"',
      '.badge',
      '  &::before',
      '    content: label {label} lookup("参数") "直接" \'单引号\' "插值 {label}" "保留"',
      ''
    ].join('\n')

    const result = extract(source, lang)

    assert.deepStrictEqual(values(result), ['直接', '单引号', '保留'])
    assert.ok(result.entries.every(entry => entry.locations[0].kind === 'css-generated-content'))
    assert.deepStrictEqual(result.warnings, [])
  })
}

test('preserves CSS escapes, CRLF, UTF-16 columns, directives, and original Vue ranges', () => {
  const source = [
    '<template><p>忽略</p></template>',
    '<style lang="stylus">',
    '.badge',
    '  &::before',
    '    /* i18n-key: badge.required */',
    '    content "😀" "\\5FC5\\586B" /* no-i18n-auto */ "排除" "保留"',
    '</style>',
    ''
  ].join('\r\n')

  const result = extract(source, 'stylus', {
    projectPath: 'src/App.vue',
    identity: 'src/App.vue::style[index=0;lang=stylus]'
  })

  assert.deepStrictEqual(result.entries.map(entry => [entry.value, entry.key]), [
    ['必填', 'badge.required'],
    ['保留', undefined]
  ])
  const location = result.entries[0].locations[0]
  assert.strictEqual(location.path, 'src/App.vue')
  assert.deepStrictEqual(location.start, { line: 6, column: 18 })
  assert.deepStrictEqual(location.end, { line: 6, column: 28 })
  assert.strictEqual(sliceAt(source, location), '\\5FC5\\586B')
})

test('does not mistake a nested Stylus content selector for a declaration', () => {
  const source = [
    'content:lang("选择器")',
    '  color red',
    '.badge',
    '  content "文案"',
    ''
  ].join('\n')

  assert.deepStrictEqual(values(extract(source)), ['文案'])
})

test('collects directly authored strings from braced Stylus syntax', () => {
  const source = [
    'generated() { content: "混入"; }',
    '.badge {',
    '  content: lookup("参数") "直接";',
    '}',
    ''
  ].join('\n')

  assert.deepStrictEqual(values(extract(source, 'stylus')), ['直接'])
})

test('fails invalid standalone and Vue Stylus at the original source location', () => {
  assert.throws(
    () => extract('.badge\n  content "未闭合\n'),
    error => /Unclosed string/.test(error.message) &&
      error.loc.line === 2 &&
      error.loc.column === 10
  )
  assert.throws(
    () => extract('.badge\n   color red\n  content "缩进错误"\n'),
    error => /Inconsistent indentation/.test(error.message) &&
      error.loc.line === 3 &&
      error.loc.column === 2
  )

  const vue = [
    '<template><p>文案</p></template>',
    '<style lang="styl">',
    '.badge',
    '  content "未闭合',
    '</style>',
    ''
  ].join('\n')
  assert.throws(
    () => extract(vue, 'styl', {
      projectPath: 'src/App.vue',
      identity: 'src/App.vue::style[index=0;lang=styl]'
    }),
    error => /Unclosed string/.test(error.message) &&
      error.loc.line === 4 &&
      error.loc.column === 10
  )
})
