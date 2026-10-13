const assert = require('assert')
const crypto = require('crypto')
const test = require('node:test')
const { extractCss } = require('../myloader/extract-css')

function extract(source, resource = {}, config = { styleExtensions: ['.css'] }) {
  return extractCss({
    source,
    resource: {
      projectPath: 'src/base.css',
      block: 'style',
      styleIndex: 0,
      lang: 'css',
      identity: 'src/base.css::style[index=0;lang=css]',
      ...resource
    },
    config
  })
}

function sliceAt(source, location) {
  return source.slice(indexAt(source, location.start), indexAt(source, location.end))
}

function indexAt(source, position) {
  let line = 1
  let column = 0
  for (let index = 0; index <= source.length; index++) {
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

function values(result) {
  return result.entries.map(entry => entry.value)
}

test('collects each static content string and ignores the rest of the stylesheet', () => {
  const source = [
    '.a::before { content: "\\5FC5\\586B"; }',
    '.b::after  { content: "\\7B2C" counter(item) "\\9879"; }',
    '.c         { content: var(--label, "\\9ED8\\8BA4\\6807\\7B7E"); }',
    '.d         { content: attr(data-label); }',
    '.e         { --label: "\\5185\\90E8\\6587\\6848"; }',
    '.f         { color: red; /* \\4E2D\\6587\\6CE8\\91CA */ }'
  ].join('\n')
  const result = extract(source)
  assert.deepStrictEqual(values(result), ['必填', '第', '项', '默认标签'])
  assert.ok(result.entries.every(entry => entry.locations[0].kind === 'css-generated-content'))
  assert.strictEqual(sliceAt(source, result.entries[0].locations[0]), '\\5FC5\\586B')
  assert.strictEqual(sliceAt(source, result.entries[1].locations[0]), '\\7B2C')
  assert.strictEqual(sliceAt(source, result.entries[2].locations[0]), '\\9879')
  assert.strictEqual(sliceAt(source, result.entries[3].locations[0]), '\\9ED8\\8BA4\\6807\\7B7E')
  assert.notStrictEqual(
    crypto.createHash('md5').update('\\5FC5\\586B', 'utf8').digest('hex'),
    crypto.createHash('md5').update(result.entries[0].value, 'utf8').digest('hex')
  )
  assert.deepStrictEqual(result.warnings, [])
})

test('keeps every static string around functions and drops empty, blank, and non-Han values', () => {
  const source = [
    '.a { content: "前" attr(data-label) "后"; }',
    '.b { content: "第" counter(item) "项"; }',
    '.c { Content: var(--label, "默认标签"); }',
    '.d { content: ""; }',
    '.e { content: "   "; }',
    '.f { content: "abc"; }',
    '.g { content: none; }',
    '.h { content: normal; }',
    '.i { content: None; }',
    '.j { content: "（新）"; }',
    '.k { --label: "内部文案"; color: red; }',
    '.l { content: /* "注释文案" */ "正文"; }'
  ].join('\n')
  const result = extract(source)
  assert.deepStrictEqual(values(result), ['前', '后', '第', '项', '默认标签', '（新）', '正文'])
  assert.ok(result.entries.every(entry => entry.locations[0].kind === 'css-generated-content'))
  assert.strictEqual(sliceAt(source, result.entries[5].locations[0]), '（新）')
})

test('decodes CSS escapes for the value and keeps the original spelling in the range', () => {
  const source = [
    '.a::before { content: "\\FF08\\65B0\\FF09"; }',
    '.b::after { content: "第一\\',
    '行"; }',
    ".c { content: '说\\'你好\\''; }"
  ].join('\n')
  const result = extract(source)
  assert.deepStrictEqual(values(result), ['（新）', '第一行', "说'你好'"])
  assert.strictEqual(sliceAt(source, result.entries[0].locations[0]), '\\FF08\\65B0\\FF09')
  assert.strictEqual(sliceAt(source, result.entries[1].locations[0]), '第一\\\n行')
  assert.strictEqual(sliceAt(source, result.entries[2].locations[0]), "说\\'你好\\'")
  assert.strictEqual(result.entries[1].locations[0].start.line, 2)
  assert.strictEqual(result.entries[1].locations[0].end.line, 3)
  assert.strictEqual(
    crypto.createHash('md5').update('（新）', 'utf8').digest('hex'),
    crypto.createHash('md5').update(result.entries[0].value, 'utf8').digest('hex')
  )
})

test('maps CRLF and astral characters to UTF-16 columns', () => {
  const source = '.a::before { content: "😀" "必填"; }\r\n'
  const result = extract(source)
  assert.deepStrictEqual(values(result), ['必填'])
  const text = result.entries[0].locations[0]
  assert.strictEqual(sliceAt(source, text), '必填')
  assert.strictEqual(text.start.line, 1)
  assert.strictEqual(text.end.line, 1)
  assert.strictEqual(text.start.column, 28)
  assert.strictEqual(text.end.column, 30)
  assert.ok(source.slice(0, text.start.column).endsWith('😀" "'))
})

test('finds a root style block after void elements in the template', () => {
  const source = [
    '<template>',
    '  <img alt="图">',
    '  <input>',
    '  <br>',
    '</template>',
    '<style>',
    '.a { content: "必填"; }',
    '</style>'
  ].join('\n')
  const result = extract(source, {
    projectPath: 'src/App.vue',
    styleIndex: 0,
    lang: 'css',
    identity: 'src/App.vue::style[index=0;lang=css]'
  })
  assert.deepStrictEqual(values(result), ['必填'])
  assert.strictEqual(sliceAt(source, result.entries[0].locations[0]), '必填')
})

test('warns for an unsupported style even when the block points at another file', () => {
  const source = '<style lang="scss" src="./theme.scss">\n.a { content: "必填"; }\n</style>\n'
  const result = extract(source, {
    projectPath: 'src/App.vue',
    styleIndex: 0,
    lang: 'scss',
    identity: 'src/App.vue::style[index=0;lang=scss]'
  })
  assert.deepStrictEqual(result.entries, [])
  assert.strictEqual(result.warnings[0].code, 'unsupported-style-preprocessor')
  assert.match(result.warnings[0].message, /scss/)
})

test('uses original Vue style coordinates for each style index', () => {
  const source = [
    '<template>',
    '  <p>忽略</p>',
    '  <style>.hidden { content: "模板里"; }</style>',
    '</template>',
    '<script>',
    'export default { note: "<style>.x{content:\\"脚本里\\"}</style>" }',
    '</script>',
    '<!-- <style>.x { content: "注释里"; }</style> -->',
    '<style>',
    '.a::before { content: "必填"; }',
    '</style>',
    '<style lang="css">',
    '.b { content: "第二"; }',
    '</style>',
    '<style src="./extra.css" lang="css">',
    '.c { content: "外部"; }',
    '</style>'
  ].join('\n')
  const first = extract(source, {
    projectPath: 'src/App.vue',
    styleIndex: 0,
    lang: 'css',
    identity: 'src/App.vue::style[index=0;lang=css]'
  })
  const second = extract(source, {
    projectPath: 'src/App.vue',
    styleIndex: 1,
    lang: 'css',
    identity: 'src/App.vue::style[index=1;lang=css]'
  })
  const external = extract(source, {
    projectPath: 'src/App.vue',
    styleIndex: 2,
    lang: 'css',
    identity: 'src/App.vue::style[index=2;lang=css]'
  })
  assert.deepStrictEqual(values(first), ['必填'])
  assert.deepStrictEqual(values(second), ['第二'])
  assert.deepStrictEqual(external.entries, [])
  assert.deepStrictEqual(external.warnings, [])
  assert.strictEqual(sliceAt(source, first.entries[0].locations[0]), '必填')
  assert.strictEqual(first.entries[0].locations[0].start.line, 10)
  assert.strictEqual(sliceAt(source, second.entries[0].locations[0]), '第二')
  assert.strictEqual(second.entries[0].locations[0].path, 'src/App.vue')
  assert.notStrictEqual(
    first.entries[0].locations[0].start.line,
    second.entries[0].locations[0].start.line
  )
})

test('warns once in the result for an unsupported style language and does not parse it', () => {
  const source = [
    '<style lang="scss">',
    '$color: red;',
    '.a { content: "必填"; }',
    '</style>'
  ].join('\n')
  for (const lang of ['scss', 'sass', 'less', 'stylus']) {
    const result = extract(source, {
      projectPath: 'src/App.vue',
      styleIndex: 0,
      lang,
      identity: `src/App.vue::style[index=0;lang=${lang}]`
    })
    assert.deepStrictEqual(result.entries, [])
    assert.deepStrictEqual(result.warnings.map(warning => warning.code), ['unsupported-style-preprocessor'])
    assert.strictEqual(result.warnings[0].identity, `src/App.vue::style[index=0;lang=${lang}]`)
    assert.match(result.warnings[0].message, new RegExp(lang))
  }
  const standalone = extract('.a { content: "必填"; }\n', {
    projectPath: 'src/theme.scss',
    lang: 'scss',
    identity: 'src/theme.scss::style[index=0;lang=scss]'
  }, { styleExtensions: ['.css', '.scss'] })
  assert.deepStrictEqual(standalone.entries, [])
  assert.strictEqual(standalone.warnings[0].code, 'unsupported-style-preprocessor')
})

test('an exclusion directive before a content declaration excludes only its next string', () => {
  const source = [
    '.a {',
    '  /* no-i18n-auto */',
    '  content: "排除" "保留";',
    '  content: "下一条";',
    '}',
    '.b { content: "相邻"; }',
    ''
  ].join('\n')
  const result = extract(source)
  assert.deepStrictEqual(values(result), ['保留', '下一条', '相邻'])
  assert.ok(result.entries.every(entry => entry.locations[0].kind === 'css-generated-content'))
})

test('an exclusion directive inside a content value excludes the string it precedes', () => {
  const source = [
    '.a { content: /* no-i18n-auto */ "排除" "保留"; }',
    '.b { content: "甲" /* no-i18n-auto */ "乙" "丙"; }',
    '/* no-i18n-auto */',
    '.c { content: "规则旁不排除"; }',
    '.d { content: "仍收集"; /* 中文注释 */ }',
    '.e { /* no-i18n-auto extra */ content: "多余文字"; }',
    '.f { /* NO-I18N-AUTO */ content: "大小写不对"; }',
    '.h {',
    '  /* no-i18n-auto */',
    '  content: /* no-i18n-auto */ "叠甲" "叠乙";',
    '}',
    ''
  ].join('\n')
  const result = extract(source)
  assert.deepStrictEqual(values(result), ['保留', '甲', '丙', '规则旁不排除', '仍收集', '多余文字', '大小写不对', '叠乙'])
})

test('a Vue style block exclusion keeps the following content string', () => {
  const source = [
    '<template><p>模板</p></template>',
    '<style>',
    '.a {',
    '  /* no-i18n-auto */',
    '  content: "排除";',
    '}',
    '.b { content: "保留"; }',
    '</style>'
  ].join('\n')
  const result = extract(source, {
    projectPath: 'src/App.vue',
    styleIndex: 0,
    lang: 'css',
    identity: 'src/App.vue::style[index=0;lang=css]'
  })
  assert.deepStrictEqual(values(result), ['保留'])
  assert.strictEqual(sliceAt(source, result.entries[0].locations[0]), '保留')
})

test('fails a standard CSS syntax error at the original position', () => {
  assert.throws(
    () => extract('.a { content: "必填 }\n'),
    error => {
      assert.strictEqual(error.loc.line, 1)
      assert.strictEqual(error.loc.column, 14)
      assert.match(error.message, /Unclosed string/)
      return true
    }
  )
  const vue = '<template><p>文案</p></template>\n<style>\n.a { content: "必填 }\n</style>\n'
  assert.throws(
    () => extract(vue, {
      projectPath: 'src/App.vue',
      styleIndex: 0,
      lang: 'css',
      identity: 'src/App.vue::style[index=0;lang=css]'
    }),
    error => {
      assert.strictEqual(error.loc.line, 3)
      assert.strictEqual(error.loc.column, 14)
      assert.match(error.message, /Unclosed string/)
      return true
    }
  )
})
