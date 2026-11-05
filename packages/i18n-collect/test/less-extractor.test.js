const assert = require('assert')
const test = require('node:test')
const { extractCss } = require('../myloader/extract-css')

function extract(source, resource = {}) {
  return extractCss({
    source,
    resource: {
      projectPath: 'src/theme.less',
      block: 'style',
      styleIndex: 0,
      lang: 'less',
      identity: 'src/theme.less::style[index=0;lang=less]',
      ...resource
    },
    config: { styleExtensions: ['.css', '.less'] }
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

test('collects direct strings in nested Less and ignores interpolation', () => {
  const source = [
    '@suffix: "变量";',
    '.badge {',
    '  &::before {',
    '    content: "直接" @{suffix} "@{suffix}" \'单引号\' "保留";',
    '  }',
    '}',
    ''
  ].join('\n')

  const result = extract(source)

  assert.deepStrictEqual(values(result), ['直接', '单引号', '保留'])
  assert.ok(result.entries.every(entry => entry.locations[0].kind === 'css-generated-content'))
  assert.deepStrictEqual(result.warnings, [])
})

test('preserves CSS escapes, CRLF, astral UTF-16 columns, and original Vue ranges', () => {
  const source = [
    '<template><p>忽略</p></template>',
    '<style lang="less">',
    '.badge {',
    '  &::before { content: "😀" "\\5FC5\\586B"; }',
    '}',
    '</style>',
    ''
  ].join('\r\n')

  const result = extract(source, {
    projectPath: 'src/App.vue',
    identity: 'src/App.vue::style[index=0;lang=less]'
  })

  assert.deepStrictEqual(values(result), ['必填'])
  const location = result.entries[0].locations[0]
  assert.strictEqual(location.path, 'src/App.vue')
  assert.strictEqual(location.kind, 'css-generated-content')
  assert.deepStrictEqual(location.start, { line: 4, column: 29 })
  assert.deepStrictEqual(location.end, { line: 4, column: 39 })
  assert.strictEqual(sliceAt(source, location), '\\5FC5\\586B')
})

test('preserves declaration and value-local directives for Less strings', () => {
  const source = [
    '.badge {',
    '  // i18n-key: badge.required',
    '  content: "必填" /* no-i18n-auto */ "排除" "保留";',
    '}',
    ''
  ].join('\n')

  const result = extract(source)

  assert.deepStrictEqual(result.entries.map(entry => [entry.value, entry.key]), [
    ['必填', 'badge.required'],
    ['保留', undefined]
  ])
})

test('does not collect variables, mixins, functions, imports, or computed strings', () => {
  const source = [
    '@import "labels.less";',
    '@label: "变量";',
    '.generated(@value: replace("默认值", "默", "认")) { content: "混入"; }',
    '.badge {',
    '  .generated(@label);',
    '  content: @label replace("函数", "函", "数") `"计算"` "直接" "@{label}";',
    '}',
    ''
  ].join('\n')

  assert.deepStrictEqual(values(extract(source)), ['直接'])
})

test('fails invalid standalone and Vue Less at the original source location', () => {
  assert.throws(
    () => extract('.badge {\n  content: "未闭合\n}\n'),
    error => /Unclosed string/.test(error.message) &&
      error.loc.line === 2 &&
      error.loc.column === 11
  )

  const vue = [
    '<template><p>文案</p></template>',
    '<style lang="less">',
    '.badge { content: "未闭合; }',
    '</style>',
    ''
  ].join('\n')
  assert.throws(
    () => extract(vue, {
      projectPath: 'src/App.vue',
      identity: 'src/App.vue::style[index=0;lang=less]'
    }),
    error => /Unclosed string/.test(error.message) &&
      error.loc.line === 3 &&
      error.loc.column === 18
  )
})
