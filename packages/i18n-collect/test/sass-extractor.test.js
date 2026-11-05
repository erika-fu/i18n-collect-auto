const assert = require('assert')
const test = require('node:test')
const { extractCss } = require('../myloader/extract-css')

function extract(source, resource = {}) {
  return extractCss({
    source,
    resource: {
      projectPath: 'src/theme.sass',
      block: 'style',
      styleIndex: 0,
      lang: 'sass',
      identity: 'src/theme.sass::style[index=0;lang=sass]',
      ...resource
    },
    config: { styleExtensions: ['.css', '.scss', '.sass'] }
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

test('collects direct strings in nested Sass and ignores computed output', () => {
  const source = [
    '$suffix: "变量"',
    '=generated',
    '  content: "混入"',
    '.badge',
    '  &::before',
    '    content: "直接" #{$suffix} #{"插值字面量"} \'单引号\' "保留"',
    ''
  ].join('\n')

  const result = extract(source)

  assert.deepStrictEqual(values(result), ['直接', '单引号', '保留'])
  assert.ok(result.entries.every(entry => entry.locations[0].kind === 'css-generated-content'))
  assert.deepStrictEqual(result.warnings, [])
})

test('does not mistake a nested content selector for a declaration', () => {
  const source = [
    'content:lang("选择器")',
    '  color: red',
    '.badge',
    '  content: "文案"',
    ''
  ].join('\n')

  assert.deepStrictEqual(values(extract(source)), ['文案'])
})

test('preserves CSS escapes, CRLF, astral UTF-16 columns, and original Vue ranges', () => {
  const source = [
    '<template><p>忽略</p></template>',
    '<style lang="sass">',
    '.badge',
    '  &::before',
    '    content: "😀" "\\5FC5\\586B"',
    '</style>',
    ''
  ].join('\r\n')

  const result = extract(source, {
    projectPath: 'src/App.vue',
    identity: 'src/App.vue::style[index=0;lang=sass]'
  })

  assert.deepStrictEqual(values(result), ['必填'])
  const location = result.entries[0].locations[0]
  assert.strictEqual(location.path, 'src/App.vue')
  assert.strictEqual(location.kind, 'css-generated-content')
  assert.deepStrictEqual(location.start, { line: 5, column: 19 })
  assert.deepStrictEqual(location.end, { line: 5, column: 29 })
  assert.strictEqual(sliceAt(source, location), '\\5FC5\\586B')
})

test('preserves declaration and value-local directives for Sass strings', () => {
  const source = [
    '.badge',
    '  /* i18n-key: badge.required */',
    '  content: "必填" /* no-i18n-auto */ "排除" "保留"',
    ''
  ].join('\n')

  const result = extract(source)

  assert.deepStrictEqual(result.entries.map(entry => [entry.value, entry.key]), [
    ['必填', 'badge.required'],
    ['保留', undefined]
  ])
})

test('collects multiline values and associates Sass line-comment directives', () => {
  const source = [
    '.badge',
    '  // i18n-key: badge.required',
    '  content: (',
    '    "必填"',
    '    // no-i18n-auto',
    '    "排除"',
    '    "保留"',
    '  )',
    ''
  ].join('\n')

  const result = extract(source)

  assert.deepStrictEqual(result.entries.map(entry => [entry.value, entry.key]), [
    ['必填', 'badge.required'],
    ['保留', undefined]
  ])
})

test('does not collect variables, mixin output, function output, imports, or interpolated strings', () => {
  const source = [
    '@use "labels"',
    '@import "legacy"',
    '$label: "变量"',
    '@function label()',
    '  @return "函数"',
    '=generated',
    '  content: "混入"',
    '.badge',
    '  +generated',
    '  content: $label label() "直接" "插值#{1}"',
    ''
  ].join('\n')

  assert.deepStrictEqual(values(extract(source)), ['直接'])
})

test('fails invalid standalone and Vue Sass at the original source location', () => {
  assert.throws(
    () => extract('.badge\n  content: "未闭合\n'),
    error => /Unclosed string/.test(error.message) &&
      error.loc.line === 2 &&
      error.loc.column === 11
  )
  assert.throws(
    () => extract('.badge\n   color: red\n  content: "缩进错误"\n'),
    error => /Inconsistent indentation/.test(error.message) &&
      error.loc.line === 3 &&
      error.loc.column === 2
  )

  const vue = [
    '<template><p>文案</p></template>',
    '<style lang="sass">',
    '.badge',
    '  content: "未闭合',
    '</style>',
    ''
  ].join('\n')
  assert.throws(
    () => extract(vue, {
      projectPath: 'src/App.vue',
      identity: 'src/App.vue::style[index=0;lang=sass]'
    }),
    error => /Unclosed string/.test(error.message) &&
      error.loc.line === 4 &&
      error.loc.column === 11
  )
})
