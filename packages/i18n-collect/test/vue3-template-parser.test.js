const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { extractHtml } = require('../myloader/extract-html')
const vue2Adapter = require('../myloader/template-parser-vue2')
const vue3Adapter = require('../myloader/template-parser-vue3')
const { installVue2 } = require('./vue2-fixture')
const { installVue3 } = require('./vue3-fixture')

const ALLOWLIST = ['title', 'placeholder', 'alt', 'aria-label', 'value']

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-vue3-template-'))
  installVue3(root)
  return {
    root,
    resource: {
      absolutePath: path.join(root, 'src', 'App.vue'),
      projectPath: 'src/App.vue',
      query: '?vue&type=template&id=vue3',
      lang: 'html',
      block: 'template'
    }
  }
}

function vue2Fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-vue2-equivalent-'))
  installVue2(root)
  return {
    root,
    resource: {
      absolutePath: path.join(root, 'src', 'App.vue'),
      projectPath: 'src/App.vue',
      query: '?vue&type=template&id=vue2',
      lang: 'html',
      block: 'template'
    }
  }
}

function extract(source, prepared = fixture(), config = {}) {
  return extractHtml({
    source,
    resource: prepared.resource,
    config: { attributeAllowlist: ALLOWLIST, ...config }
  })
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

test('normalizes Vue 3 compiler nodes into parser-neutral regions', () => {
  const source = [
    '<template>',
    '  <!-- note -->',
    '  <section title="保存&nbsp;成功">',
    '    <template v-if="ready"><h1>😄标题</h1></template>',
    '    <p :aria-label="`前缀${name}后缀`">{{ $t(\'items.count\', { count }) }}</p>',
    '  </section>',
    '</template>'
  ].join('\r\n')
  const prepared = fixture()
  const compilerSfc = require(path.join(prepared.root, 'node_modules/@vue/compiler-sfc'))
  const compilerDom = require(path.join(prepared.root, 'node_modules/@vue/compiler-dom'))

  const parsed = vue3Adapter.parse({
    source,
    resource: prepared.resource,
    compilerSfc,
    compilerDom
  })

  assert.ok(parsed.constructs.length > 0)
  assert.deepStrictEqual(parsed.comments.map(comment => comment.text.trim()), ['note'])
  assert.deepStrictEqual(
    parsed.regions.map(region => ({
      type: region.type,
      name: region.name,
      value: region.value,
      source: source.slice(region.start, region.end)
    })),
    [
      { type: 'attribute', name: 'title', value: '保存\u00a0成功', source: '保存&nbsp;成功' },
      { type: 'attribute', name: 'v-if', value: 'ready', source: 'ready' },
      { type: 'text', name: undefined, value: '😄标题', source: '😄标题' },
      { type: 'attribute', name: ':aria-label', value: '`前缀${name}后缀`', source: '`前缀${name}后缀`' },
      { type: 'expression', name: undefined, value: " $t('items.count', { count }) ", source: " $t('items.count', { count }) " }
    ]
  )
  assert.ok(parsed.regions.every(region => !('node' in region) && !('loc' in region)))
})

test('collects Vue 3 source text and expressions at original SFC ranges', () => {
  const source = [
    '<template>',
    '  <!-- i18n-key: page.title -->',
    '  <section title="保存&nbsp;成功">',
    '    <template v-if="ready"><h1>😄标题</h1></template>',
    '    <!-- no-i18n-auto -->',
    '    <p>排除文案</p>',
    '    <p :aria-label="`前缀${name}后缀`">{{ $t(\'items.count\', { count }) }}</p>',
    '  </section>',
    '</template>',
    '<script setup>const generated = "不收集脚本"</script>'
  ].join('\r\n')

  const result = extract(source)

  assert.deepStrictEqual(
    result.entries.map(entry => ({
      value: entry.value,
      key: entry.key,
      representation: entry.representation,
      paramsKind: entry.paramsKind,
      paramNames: entry.paramNames,
      kind: entry.locations[0].kind,
      source: sliceAt(source, entry.locations[0])
    })),
    [
      {
        value: '保存\u00a0成功',
        key: 'page.title',
        representation: undefined,
        paramsKind: undefined,
        paramNames: undefined,
        kind: 'html-attribute',
        source: '保存&nbsp;成功'
      },
      {
        value: '😄标题',
        key: undefined,
        representation: undefined,
        paramsKind: undefined,
        paramNames: undefined,
        kind: 'html-text',
        source: '😄标题'
      },
      {
        value: '前缀',
        key: undefined,
        representation: undefined,
        paramsKind: undefined,
        paramNames: undefined,
        kind: 'html-attribute',
        source: '前缀'
      },
      {
        value: '后缀',
        key: undefined,
        representation: undefined,
        paramsKind: undefined,
        paramNames: undefined,
        kind: 'html-attribute',
        source: '后缀'
      },
      {
        value: '',
        key: 'items.count',
        representation: 'localized-call',
        paramsKind: 'static',
        paramNames: ['count'],
        kind: 'template-expression',
        source: "'items.count'"
      }
    ]
  )
  assert.deepStrictEqual(result.entries[1].locations[0].start, { line: 4, column: 31 })
  assert.deepStrictEqual(result.entries[1].locations[0].end, { line: 4, column: 35 })
})

test('keeps Vue 2 and Vue 3 normalized regions and collection entries equivalent', () => {
  const source = [
    '<template>',
    '  <!-- i18n-key: page.heading -->',
    '  <section title="保存&nbsp;成功">',
    '    <p>你好</p>',
    '    <input :placeholder="\'请\' + missing + \'输入\'">',
    '    <p>{{ `前缀${name}后缀` }}</p>',
    '    <p>{{ t(\'plain.key\') }}</p>',
    '    <p>{{ $t(\'dollar.key\', { count }) }}</p>',
    '    <p>{{ this.$t(\'instance.key\', params) }}</p>',
    '  </section>',
    '</template>'
  ].join('\n')
  const vue2 = vue2Fixture()
  const vue3 = fixture()
  const templateCompiler = require(path.join(vue2.root, 'node_modules/vue-template-compiler'))
  const compilerSfc = require(path.join(vue3.root, 'node_modules/@vue/compiler-sfc'))
  const compilerDom = require(path.join(vue3.root, 'node_modules/@vue/compiler-dom'))
  const normalized = parsed => ({
    constructs: parsed.constructs.map(construct => ({
      start: construct.start,
      end: construct.end
    })),
    comments: parsed.comments,
    regions: parsed.regions.map(region => ({
      type: region.type,
      value: region.value,
      start: region.start,
      end: region.end,
      owners: region.owners,
      name: region.name,
      expressionKind: region.expressionKind
    })),
    warnings: parsed.warnings
  })

  const vue2Ir = vue2Adapter.parse({ source, resource: vue2.resource, templateCompiler })
  const vue3Ir = vue3Adapter.parse({ source, resource: vue3.resource, compilerSfc, compilerDom })
  assert.deepStrictEqual(normalized(vue3Ir), normalized(vue2Ir))

  const semanticEntries = result => result.entries.map(entry => ({
    value: entry.value,
    key: entry.key,
    representation: entry.representation,
    paramsKind: entry.paramsKind,
    paramNames: entry.paramNames,
    kind: entry.locations[0].kind,
    start: entry.locations[0].start,
    end: entry.locations[0].end
  }))
  assert.deepStrictEqual(semanticEntries(extract(source, vue3)), semanticEntries(extract(source, vue2)))
})

test('reports Vue 3 expression and compiler diagnostics at original SFC positions', () => {
  assert.throws(
    () => extract('<template>\r\n  <p>{{ \'你好\' + }}</p>\r\n</template>'),
    error => {
      assert.match(error.message, /Unexpected token/)
      assert.strictEqual(error.loc.line, 2)
      assert.strictEqual(error.loc.column, 8)
      return true
    }
  )
  assert.throws(
    () => extract('<template>\r\n  <p title="甲" title="乙">文案</p>\r\n</template>'),
    error => {
      assert.match(error.message, /duplicate-attribute/)
      assert.strictEqual(error.loc.line, 2)
      return true
    }
  )
  assert.throws(
    () => extract('<template><p>第一</p></template>\n<template><p>第二</p></template>'),
    error => {
      assert.match(error.message, /only one <template>/)
      assert.strictEqual(error.loc.line, 2)
      return true
    }
  )
})

test('handles missing, non-HTML, and external Vue 3 template resources', () => {
  assert.throws(
    () => extract('<script setup>const title = "脚本"</script>'),
    error => /could not be located/.test(error.message) && error.loc.line === 1 && error.loc.column === 0
  )

  const nonHtml = fixture()
  nonHtml.resource.lang = 'pug'
  nonHtml.resource.query = '?vue&type=template&lang=pug'
  const skipped = extract('<template lang="pug">\np 不收集\n</template>', nonHtml)
  assert.deepStrictEqual(skipped, { entries: [], warnings: [] })

  const external = fixture()
  external.resource.projectPath = 'src/copy.html'
  external.resource.absolutePath = path.join(external.root, 'src', 'copy.html')
  const result = extract('<p title="外部标题">外部文案</p>', external)
  assert.deepStrictEqual(result.entries.map(entry => entry.value), ['外部标题', '外部文案'])
  assert.ok(result.entries.every(entry => entry.locations[0].path === 'src/copy.html'))
})

test('applies Vue 3 HTML and expression directives to only the next fragment', () => {
  const source = [
    '<template>',
    '  <!-- no-i18n-auto -->',
    '  <p title="排除标题">保留正文</p>',
    '  <p :title="/* no-i18n-auto */ \'排除绑定\' + \'保留绑定\'">动态旁白</p>',
    '  <p>{{ /* i18n-key: page.slot */ \'插值键控\' }}{{ \'相邻插值\' }}</p>',
    '</template>'
  ].join('\n')
  const result = extract(source)
  assert.deepStrictEqual(
    result.entries.map(entry => ({ value: entry.value, key: entry.key })),
    [
      { value: '保留正文', key: undefined },
      { value: '保留绑定', key: undefined },
      { value: '动态旁白', key: undefined },
      { value: '插值键控', key: 'page.slot' },
      { value: '相邻插值', key: undefined }
    ]
  )
})

test('keeps the self-closing warning when an attribute contains a greater-than sign', () => {
  const result = extract('<template><my-button title="大于 > 文案" /><p>正文</p></template>')
  assert.deepStrictEqual(result.entries.map(entry => entry.value), ['大于 > 文案', '正文'])
  assert.deepStrictEqual(result.warnings, [
    { code: 'non-void-html-element-start-tag-with-trailing-solidus' }
  ])
})
