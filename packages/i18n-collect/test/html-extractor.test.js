const assert = require('assert')
const crypto = require('crypto')
const test = require('node:test')
const { extractHtml } = require('../myloader/extract-html')

const ALLOWLIST = ['title', 'placeholder', 'alt', 'aria-label', 'value']

function extract(source, resource = {}, config = { attributeAllowlist: ALLOWLIST }) {
  return extractHtml({
    source,
    resource: {
      projectPath: 'src/fragment.html',
      query: '?vue&type=template',
      lang: 'html',
      block: 'template',
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

test('collects each Vue text node on its own and keeps formatting rules distinct from trim', () => {
  const source = [
    '<section>',
    '  <p>',
    '    你好',
    '    世界',
    '  </p>',
    '  <p> 保存 </p>',
    '  <p>你好 <em>世界</em> 啊</p>',
    '</section>'
  ].join('\n')
  const result = extract(source)
  assert.deepStrictEqual(values(result), ['你好\n    世界', ' 保存 ', '你好 ', '世界', ' 啊'])
  assert.deepStrictEqual(result.entries.map(entry => entry.locations[0].kind), [
    'html-text',
    'html-text',
    'html-text',
    'html-text',
    'html-text'
  ])
  const block = result.entries[0].locations[0]
  assert.strictEqual(sliceAt(source, block), '你好\n    世界')
  assert.notStrictEqual(result.entries[1].value, '保存')
  assert.ok(!values(result).some(value => value.includes('你好世界') || value.includes('你好 世界')))
})

test('uses the decoded entity value and the original spelling for the source range', () => {
  const source = '<p>保存&nbsp;成功</p><p>&#20320;&#22909;</p>'
  const result = extract(source)
  assert.deepStrictEqual(values(result), ['保存\u00A0成功', '你好'])
  assert.strictEqual(sliceAt(source, result.entries[0].locations[0]), '保存&nbsp;成功')
  assert.strictEqual(sliceAt(source, result.entries[1].locations[0]), '&#20320;&#22909;')
  assert.strictEqual(
    crypto.createHash('md5').update(result.entries[0].value, 'utf8').digest('hex'),
    '60925162d3384e09dd8b2d0056615b2d'
  )
  assert.notStrictEqual(
    crypto.createHash('md5').update('保存&nbsp;成功', 'utf8').digest('hex'),
    '60925162d3384e09dd8b2d0056615b2d'
  )
})

test('collects allowlisted static attributes and skips the rest', () => {
  const source = [
    '<input',
    '  title = "保存&nbsp;成功"',
    "  placeholder='请输入'",
    '  value=提交',
    '  alt="示例"',
    '  aria-label="关闭"',
    '  class="不收集"',
    '  data-id="不收集"',
    '  @click="不收集"',
    '  v-if="不收集"',
    '  disabled',
    '>'
  ].join('\n')
  const result = extract(source)
  assert.deepStrictEqual(values(result), ['保存\u00A0成功', '请输入', '提交', '示例', '关闭'])
  assert.ok(result.entries.every(entry => entry.locations[0].kind === 'html-attribute'))
  assert.strictEqual(sliceAt(source, result.entries[0].locations[0]), '保存&nbsp;成功')
  assert.strictEqual(sliceAt(source, result.entries[1].locations[0]), '请输入')
  assert.strictEqual(sliceAt(source, result.entries[2].locations[0]), '提交')
  assert.deepStrictEqual(extract(source, {}, { attributeAllowlist: ['title'] }).entries.map(entry => entry.value), ['保存\u00A0成功'])
})

test('collects static binding fragments without executing the expression', () => {
  const source = [
    '<input',
    '  :placeholder="\'请\' + missing + \'输入\'"',
    '  :title.sync="`前缀${name}后缀`"',
    '  v-bind:alt.prop="\'图片\'"',
    '  :value.camel="\'字段\'"',
    '  :class="\'不收集\'"',
    '  :data-id.sync="\'不收集\'"',
    '>'
  ].join(' ')
  const result = extract(source)
  assert.deepStrictEqual(values(result), ['请', '输入', '前缀', '后缀', '图片', '字段'])
  assert.ok(result.entries.every(entry => entry.locations[0].kind === 'html-attribute'))
  assert.ok(!values(result).includes('请输入'))
  assert.strictEqual(sliceAt(source, result.entries[0].locations[0]), '请')
  assert.strictEqual(sliceAt(source, result.entries[2].locations[0]), '前缀')
  assert.strictEqual(sliceAt(source, result.entries[3].locations[0]), '后缀')
})

test('keeps interpolation as template-expression and accepts braces inside the expression', () => {
  const source = [
    '<p>静态段落</p>',
    '<p>你好 {{ empty + \'拼接后的中文\' }}</p>',
    '<p>{{ ({ label: \'包含}}的中文\' }) }}</p>',
    '<p>{{ `模板}}片段` }}</p>',
    '<p>{{ `纯静态插值` }}</p>',
    '<p>{{ \'单独字符串\' }}</p>'
  ].join('')
  const result = extract(source)
  assert.deepStrictEqual(values(result), [
    '静态段落',
    '你好 ',
    '拼接后的中文',
    '包含}}的中文',
    '模板}}片段',
    '纯静态插值',
    '单独字符串'
  ])
  assert.deepStrictEqual(result.entries.map(entry => entry.locations[0].kind), [
    'html-text',
    'html-text',
    'template-expression',
    'template-expression',
    'template-expression',
    'template-expression',
    'template-expression'
  ])
  assert.strictEqual(sliceAt(source, result.entries[2].locations[0]), "'拼接后的中文'")
  assert.strictEqual(sliceAt(source, result.entries[4].locations[0]), '模板}}片段')
  assert.strictEqual(sliceAt(source, result.entries[6].locations[0]), "'单独字符串'")
  assert.ok(!values(result).some(value => value.includes('{{')))
})

test('maps Vue template ranges through CRLF, astral characters, and indentation', () => {
  const source = '<template>\r\n  <p>\r\n    😀好\r\n  </p>\r\n</template>\r\n'
  const result = extract(source, {
    projectPath: 'src/App.vue',
    query: '?vue&type=template&id=abc&scoped=true',
    lang: 'html'
  })
  assert.deepStrictEqual(values(result), ['😀好'])
  const location = result.entries[0].locations[0]
  assert.strictEqual(location.path, 'src/App.vue')
  assert.strictEqual(location.kind, 'html-text')
  assert.deepStrictEqual(location.start, { line: 3, column: 4 })
  assert.deepStrictEqual(location.end, { line: 3, column: 7 })
  assert.strictEqual(sliceAt(source, location), '😀好')
})

test('does not choose the first template tag when several blocks or an external source exist', () => {
  const vue = [
    '<template lang="pug">',
    'p 不收集',
    '</template>',
    '<template src="./copy.html">',
    '  <p>诱饵文案</p>',
    '</template>',
    '<template>',
    '  <p>正文案</p>',
    '</template>'
  ].join('\n')
  const selected = extract(vue, {
    projectPath: 'src/App.vue',
    query: '?vue&type=template&lang=html',
    lang: 'html'
  })
  assert.deepStrictEqual(values(selected), ['正文案'])
  assert.strictEqual(selected.entries[0].locations[0].path, 'src/App.vue')
  assert.strictEqual(sliceAt(vue, selected.entries[0].locations[0]), '正文案')

  assert.throws(
    () => extract('<template><p>第一段</p></template>\n<template><p>第二段</p></template>\n', {
      projectPath: 'src/App.vue',
      query: '?vue&type=template',
      lang: 'html'
    }),
    /ambiguous/
  )

  const external = extract('<p>外部文案</p>\n<template><p>块内文案</p></template>', {
    projectPath: 'src/copy.html',
    query: '?vue&type=template&id=abc',
    lang: 'html'
  })
  assert.deepStrictEqual(values(external), ['外部文案', '块内文案'])
  assert.ok(external.entries.every(entry => entry.locations[0].path === 'src/copy.html'))
})

function extractStandalone(source, config) {
  return extract(source, {
    projectPath: 'public/index.html',
    query: '',
    lang: null,
    block: 'html'
  }, config)
}

test('collects standalone HTML text and allowlisted attributes without executing EJS', () => {
  const source = [
    '<!DOCTYPE html>',
    '<html>',
    '<head><title><%= htmlWebpackPlugin.options.title %></title></head>',
    '<body>',
    '  <p title="保存&nbsp;成功<%= name %>">',
    '    页面文案',
    '  </p>',
    '  <img alt="示意图" class="不收集">',
    '  <input :placeholder="\'请输入\'" title="字段">',
    '  <p>欢迎 <%= user %> 回来</p>',
    "  <p><%= '隐藏中文' %></p>",
    '</body>',
    '</html>'
  ].join('\n')
  const result = extractStandalone(source)
  assert.deepStrictEqual(values(result), ['保存\u00A0成功', '页面文案', '示意图', '字段', '欢迎 ', ' 回来'])
  assert.deepStrictEqual(result.entries.map(entry => entry.locations[0].kind), [
    'static-html-attribute',
    'static-html-text',
    'static-html-attribute',
    'static-html-attribute',
    'static-html-text',
    'static-html-text'
  ])
  assert.strictEqual(sliceAt(source, result.entries[0].locations[0]), '保存&nbsp;成功')
  assert.strictEqual(sliceAt(source, result.entries[1].locations[0]), '页面文案')
  assert.strictEqual(sliceAt(source, result.entries[4].locations[0]), '欢迎 ')
  assert.ok(!values(result).some(value => value.includes('<%') || value.includes('隐藏中文') || value.includes('请输入')))
  assert.ok(result.entries.every(entry => entry.locations[0].path === 'public/index.html'))
})

test('fails a standalone document when an invalid tag is not an EJS delimiter', () => {
  assert.throws(() => extractStandalone('<p><1文案</p>'), /invalid-first-character-of-tag-name/)
})

test('keeps collecting a standalone document when trailing markup whitespace is not a location', () => {
  const source = '<!DOCTYPE html>\r\n<html>\r\n<body>\r\n  <p>页面文案</p>\r\n</body>\r\n</html>\r\n'
  const result = extractStandalone(source)
  assert.deepStrictEqual(values(result), ['页面文案'])
  assert.strictEqual(result.entries[0].locations[0].kind, 'static-html-text')
  assert.strictEqual(sliceAt(source, result.entries[0].locations[0]), '页面文案')
})

test('ignores Vue self-closing tags and fails when a diagnostic makes the tree untrustworthy', () => {
  const compatible = extract('<my-button /><p>按钮文案</p>')
  assert.deepStrictEqual(values(compatible), ['按钮文案'])
  assert.deepStrictEqual(compatible.warnings.map(warning => warning.code), [
    'non-void-html-element-start-tag-with-trailing-solidus'
  ])

  assert.throws(() => extract('<p title="甲" title="乙">文案</p>'), /duplicate-attribute/)
  assert.throws(() => extract('<p>{{ \'你好\' + }}</p>'), error => {
    assert.strictEqual(error.loc.line, 1)
    assert.strictEqual(error.loc.column, 13)
    assert.match(error.message, /Unexpected token/)
    return true
  })
})
