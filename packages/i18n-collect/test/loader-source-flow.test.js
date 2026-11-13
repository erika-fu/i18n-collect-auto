const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const loader = require('../myloader')
const { COLLECT_METADATA } = require('../mycommon/session')
const { keyFor } = require('../mycommon/store')

test('loader collects from the active Webpack source, not from a pitch disk reread', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-source-'))
  const resourcePath = path.join(root, 'src', 'app.js')
  fs.mkdirSync(path.dirname(resourcePath), { recursive: true })
  fs.writeFileSync(resourcePath, 'module.exports = "磁盘文案"\n')
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')

  assert.strictEqual(typeof loader.pitch, 'undefined')

  const mod = { buildInfo: {} }
  const compiler = { root: null }
  compiler.root = compiler
  const compilation = { warnings: [] }
  let callbackSource = null

  loader.call(
    {
      resourcePath,
      resourceQuery: '',
      rootContext: root,
      _module: mod,
      _compiler: compiler,
      _compilation: compilation,
      getOptions() {
        return { root }
      },
      callback(_error, source) {
        callbackSource = source
      }
    },
    'module.exports = "管线文案"\n',
    null,
    null
  )

  assert.strictEqual(callbackSource, 'module.exports = "管线文案"\n')
  const snapshot = mod.buildInfo[COLLECT_METADATA].snapshot
  assert.ok(snapshot)
  assert.deepStrictEqual(
    snapshot.entries.map(entry => entry.value),
    ['管线文案']
  )
  assert.ok(!snapshot.entries.some(entry => entry.value === '磁盘文案'))
  assert.strictEqual(keyFor('管线文案'), keyFor(snapshot.entries[0].value))
})

function invokeLoader({ root, resourcePath, resourceQuery = '', source }) {
  const mod = { buildInfo: {} }
  const compiler = { root: null }
  compiler.root = compiler
  const compilation = { warnings: [] }
  let callbackSource = null
  loader.call(
    {
      resourcePath,
      resourceQuery,
      rootContext: root,
      _module: mod,
      _compiler: compiler,
      _compilation: compilation,
      getOptions() {
        return { root }
      },
      callback(_error, nextSource) {
        callbackSource = nextSource
      }
    },
    source,
    null,
    null
  )
  return { mod, callbackSource }
}

test('loader collects TypeScript through the same script pipeline without rewriting source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-ts-'))
  const resourcePath = path.join(root, 'src', 'app.ts')
  fs.mkdirSync(path.dirname(resourcePath), { recursive: true })
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')
  const source = 'const message: string = "类型管线"\n'
  const { mod, callbackSource } = invokeLoader({ root, resourcePath, source })
  assert.strictEqual(callbackSource, source)
  const snapshot = mod.buildInfo[COLLECT_METADATA].snapshot
  assert.strictEqual(snapshot.identity, 'src/app.ts::script')
  assert.deepStrictEqual(snapshot.entries.map(entry => entry.value), ['类型管线'])
})

test('loader keeps Vue script setup identity distinct and leaves application source unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-setup-'))
  const resourcePath = path.join(root, 'src', 'App.vue')
  fs.mkdirSync(path.dirname(resourcePath), { recursive: true })
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')
  const source = 'const title: string = "设置管线"\n'
  const { mod, callbackSource } = invokeLoader({
    root,
    resourcePath,
    resourceQuery: '?vue&type=script&lang=ts&setup=true',
    source
  })
  assert.strictEqual(callbackSource, source)
  const snapshot = mod.buildInfo[COLLECT_METADATA].snapshot
  assert.strictEqual(snapshot.identity, 'src/App.vue::script[lang=ts;setup=true]')
  assert.strictEqual(snapshot.owner.setup, true)
  assert.deepStrictEqual(snapshot.entries.map(entry => entry.value), ['设置管线'])
})

test('loader maps extracted Vue script locations back to the SFC file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-vue-script-loc-'))
  const resourcePath = path.join(root, 'src', 'App.vue')
  fs.mkdirSync(path.dirname(resourcePath), { recursive: true })
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')
  const fileSource = [
    '<template>',
    '  <p>{{ scriptCopy }}</p>',
    '</template>',
    '',
    '<script>',
    'export default {',
    '  data () {',
    '    return {',
    '      scriptCopy: \'脚本文案\'',
    '    }',
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
  fs.writeFileSync(resourcePath, fileSource)
  const extractedScript = [
    'export default {',
    '  data () {',
    '    return {',
    '      scriptCopy: \'脚本文案\'',
    '    }',
    '  }',
    '}',
    ''
  ].join('\n')
  const { mod, callbackSource } = invokeLoader({
    root,
    resourcePath,
    resourceQuery: '?vue&type=script&lang=js',
    source: extractedScript
  })
  assert.strictEqual(callbackSource, extractedScript)
  const snapshot = mod.buildInfo[COLLECT_METADATA].snapshot
  assert.strictEqual(snapshot.identity, 'src/App.vue::script[lang=js]')
  const entry = snapshot.entries.find(item => item.value === '脚本文案')
  assert.ok(entry)
  assert.strictEqual(entry.locations[0].start.line, 9)
  assert.strictEqual(entry.locations[0].end.line, 9)
})

test('loader collects Vue render-function template JavaScript through the render policy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-render-'))
  const resourcePath = path.join(root, 'src', 'App.vue')
  fs.mkdirSync(path.dirname(resourcePath), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { vueVersion: 3, attributeAllowlist: ["title", "placeholder", "alt", "aria-label", "value"] }\n'
  )
  const source = [
    'import { createElementVNode as _createElementVNode, createTextVNode as _createTextVNode } from "vue"',
    'export function render(_ctx) {',
    '  return _createElementVNode("div", { title: "标题", "data-test": "内部" }, [',
    '    _createTextVNode("你好"),',
    '    _createElementVNode("input", { placeholder: "请输入", onClick: _ctx.go }, null)',
    '  ])',
    '}',
    ''
  ].join('\n')
  const { mod, callbackSource } = invokeLoader({
    root,
    resourcePath,
    resourceQuery: '?vue&type=template&lang=js',
    source
  })
  assert.strictEqual(callbackSource, source)
  const snapshot = mod.buildInfo[COLLECT_METADATA].snapshot
  assert.strictEqual(snapshot.identity, 'src/App.vue::template[lang=js]')
  assert.deepStrictEqual(
    snapshot.entries.map(entry => entry.value).sort(),
    ['你好', '标题', '请输入'].sort()
  )
})

test('loader replaces Vue render-function JavaScript in the same collection pass', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-render-replace-'))
  const resourcePath = path.join(root, 'src', 'App.vue')
  fs.mkdirSync(path.dirname(resourcePath), { recursive: true })
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), `module.exports = {
  vueVersion: 3,
  buildReplacement: {
    enabled: true,
    adapter: 'vue3',
    runtimeModule: 'src/i18n.js',
    runtimeExport: 't'
  }
}\n`)
  const source = [
    'export function render(_ctx) {',
    '  return _createTextVNode("你好")',
    '}',
    ''
  ].join('\n')
  const mod = { buildInfo: {} }
  const compiler = { root: null }
  compiler.root = compiler
  const compilation = { warnings: [], __i18nCollectReplaceDuringCollection: true }
  let callbackSource = null
  loader.call({
    resourcePath,
    resourceQuery: '?vue&type=template&lang=js',
    rootContext: root,
    _module: mod,
    _compiler: compiler,
    _compilation: compilation,
    getOptions() { return { root } },
    callback(_error, nextSource) { callbackSource = nextSource }
  }, source, null, null)

  assert.match(callbackSource, new RegExp(`_ctx\\.\\$t\\('${keyFor('你好')}'\\)`))
  assert.deepStrictEqual(mod.buildInfo[COLLECT_METADATA].snapshot.entries.map(entry => entry.value), ['你好'])
})

test('loader collects Vue 2 render-function template JavaScript through the Vue 2 policy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-render-v2-'))
  const resourcePath = path.join(root, 'src', 'App.vue')
  fs.mkdirSync(path.dirname(resourcePath), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'i18n-collect.config.js'),
    'module.exports = { vueVersion: 2, attributeAllowlist: ["title", "placeholder", "alt", "aria-label", "value"] }\n'
  )
  const source = [
    'var render = function () {',
    '  with(this){return _c(\'div\',{attrs:{"title":"标题","data-test":"内部"}},[_v("你好"),_c(\'input\',{attrs:{"placeholder":"请输入"},on:{"click":go}})])}',
    '}',
    ''
  ].join('\n')
  const { mod, callbackSource } = invokeLoader({
    root,
    resourcePath,
    resourceQuery: '?vue&type=template&lang=js',
    source
  })
  assert.strictEqual(callbackSource, source)
  const snapshot = mod.buildInfo[COLLECT_METADATA].snapshot
  assert.deepStrictEqual(
    snapshot.entries.map(entry => entry.value).sort(),
    ['你好', '标题', '请输入'].sort()
  )
})
