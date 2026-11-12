const assert = require('assert')
const test = require('node:test')
const { compile } = require('@vue/compiler-dom')
const vtc = require('vue-template-compiler')
const { extractVueRender } = require('../myloader/extract-vue-render')

const ALLOWLIST = ['title', 'placeholder', 'alt', 'aria-label', 'value']

function resource(overrides = {}) {
  return {
    projectPath: 'src/App.vue',
    query: '?vue&type=template',
    lang: 'js',
    block: 'template',
    ...overrides
  }
}

function values(result) {
  return result.entries.map(entry => entry.value)
}

function compileVue3(template) {
  return compile(template, { mode: 'module' }).code
}

function compileVue2(template) {
  const result = vtc.compile(template)
  const staticFns = (result.staticRenderFns || []).map((fn, index) => (
    `var staticRenderFns_${index} = function () {${fn}}`
  ))
  return [
    `var render = function () {${result.render}}`,
    ...staticFns,
    'render._withStripped = true'
  ].join('\n')
}

test('collects Vue 3 text children and allowlisted props from render-function JavaScript', () => {
  const source = compileVue3([
    '<div title="标题">',
    '你好',
    '<input placeholder="请输入" aria-label="名称" data-test="内部标识" @click="go" :class="cls">',
    '</div>'
  ].join(''))
  const result = extractVueRender({
    source,
    resource: resource(),
    config: { vueVersion: 3, attributeAllowlist: ALLOWLIST }
  })
  assert.deepStrictEqual(values(result).sort(), ['你好', '名称', '标题', '请输入'].sort())
  assert.ok(result.entries.every(entry => entry.locations[0].kind === 'script-string'))
  assert.ok(result.entries.every(entry => entry.locations[0].path === 'src/App.vue'))
  assert.deepStrictEqual(result.diagnostics, [])
})

test('collects Vue 2 text children and allowlisted attrs from render-function JavaScript', () => {
  const source = compileVue2([
    '<div title="标题">',
    '你好',
    '<input placeholder="请输入" aria-label="名称" data-test="内部标识" @click="go" :class="cls" value="默认值">',
    '</div>'
  ].join(''))
  const result = extractVueRender({
    source,
    resource: resource(),
    config: { vueVersion: 2, attributeAllowlist: ALLOWLIST }
  })
  assert.deepStrictEqual(values(result).sort(), ['你好', '名称', '标题', '默认值', '请输入'].sort())
  assert.deepStrictEqual(result.diagnostics, [])
})

test('ignores spreads, dynamic props, and unknown helper shapes without collecting them', () => {
  const source = [
    'import { createElementVNode as _createElementVNode, createTextVNode as _createTextVNode } from "vue"',
    'export function render(_ctx) {',
    '  const merged = { title: "合并标题" }',
    '  return _createElementVNode("div", { ...merged, placeholder: _ctx.ph }, [',
    '    _createTextVNode(_ctx.dynamic),',
    '    _createElementVNode("span", null, "安全文本"),',
    '    unknownHelper("危险文案")',
    '  ])',
    '}'
  ].join('\n')
  const result = extractVueRender({
    source,
    resource: resource(),
    config: { vueVersion: 3, attributeAllowlist: ALLOWLIST }
  })
  assert.deepStrictEqual(values(result), ['安全文本'])
})

test('reports unsupported static/SSR helpers as diagnostics and skips them', () => {
  const source = [
    'import { createStaticVNode as _createStaticVNode, createTextVNode as _createTextVNode } from "vue"',
    'export function render() {',
    '  return [_createStaticVNode("<p>静态优化文案</p>", 1), _createTextVNode("可见文案")]',
    '}'
  ].join('\n')
  const result = extractVueRender({
    source,
    resource: resource(),
    config: { vueVersion: 3, attributeAllowlist: ALLOWLIST }
  })
  assert.deepStrictEqual(values(result), ['可见文案'])
  assert.ok(result.diagnostics.some(item => /createStaticVNode/.test(item.message)))
})

test('fails closed with a diagnostic when vueVersion is unset and helpers are ambiguous', () => {
  const result = extractVueRender({
    source: 'export function render() { return "你好" }',
    resource: resource(),
    config: { attributeAllowlist: ALLOWLIST }
  })
  assert.deepStrictEqual(result.entries, [])
  assert.ok(result.diagnostics.some(item => /vueVersion/.test(item.message)))
})

test('Vue 2 and Vue 3 compiler integration keeps the same safe findings', () => {
  const template = [
    '<div title="页面标题">',
    '欢迎',
    '<img alt="标志" src="x.png">',
    '<input placeholder="请输入" data-test="内部" value="默认">',
    '</div>'
  ].join('')
  const vue3Source = compileVue3(template)
  const vue3 = extractVueRender({
    source: vue3Source,
    resource: resource(),
    config: { vueVersion: 3, attributeAllowlist: ALLOWLIST }
  })
  const vue2 = extractVueRender({
    source: compileVue2(template),
    resource: resource(),
    config: { vueVersion: 2, attributeAllowlist: ALLOWLIST }
  })
  const expected = ['欢迎', '页面标题', '标志', '请输入', '默认'].sort()
  assert.deepStrictEqual(values(vue3).sort(), expected)
  assert.deepStrictEqual(values(vue2).sort(), expected)
})
