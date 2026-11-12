const assert = require('assert')
const test = require('node:test')
const { extractVueScript, extractVueScriptBlocks } = require('../myloader/extract-vue-compat')

function extract(source, projectPath = 'src/App.vue') {
  return extractVueScript({
    source,
    resource: {
      projectPath,
      block: 'script'
    },
    config: {}
  })
}

function textAt(source, location) {
  const lines = source.split(/\r?\n/)
  return lines[location.start.line - 1].slice(location.start.column, location.end.column)
}

test('collects Chinese copy from a script setup block through the shared script pipeline', () => {
  const source = [
    '<template><p>模板</p></template>',
    '<script setup>',
    'const title = "设置标题"',
    '</script>',
    ''
  ].join('\n')
  const entries = extract(source)
  assert.deepStrictEqual(entries.map(entry => entry.value), ['设置标题'])
  assert.strictEqual(entries[0].locations[0].kind, 'script-string')
  assert.strictEqual(textAt(source, entries[0].locations[0]), '"设置标题"')
})

test('collects Chinese copy from both Options API and script setup blocks', () => {
  const source = [
    '<script>',
    'export default { data() { return { label: "选项文案" } } }',
    '</script>',
    '<script setup>',
    'const title = "设置文案"',
    '</script>',
    ''
  ].join('\n')
  const entries = extract(source)
  assert.deepStrictEqual(entries.map(entry => entry.value).sort(), ['设置文案', '选项文案'])
  for (const entry of entries) {
    assert.strictEqual(entry.locations[0].kind, 'script-string')
    assert.strictEqual(textAt(source, entry.locations[0]), `"${entry.value}"`)
  }
})

test('collects TypeScript script setup through the same AST pipeline', () => {
  const source = [
    '<script setup lang="ts">',
    'const title: string = "类型文案"',
    'const greeting = `你好${name}`',
    '</script>',
    ''
  ].join('\n')
  const entries = extract(source)
  assert.deepStrictEqual(entries.map(entry => entry.value).sort(), ['你好', '类型文案'])
  const typed = entries.find(entry => entry.value === '类型文案')
  assert.strictEqual(typed.locations[0].kind, 'script-string')
  assert.strictEqual(textAt(source, typed.locations[0]), '"类型文案"')
  const segment = entries.find(entry => entry.value === '你好')
  assert.strictEqual(segment.locations[0].kind, 'template-literal')
})

test('preserves i18n-key directives inside script setup', () => {
  const source = [
    '<script setup>',
    'const title = /* i18n-key: home.title */ "首页"',
    '</script>',
    ''
  ].join('\n')
  const entries = extract(source)
  assert.strictEqual(entries.length, 1)
  assert.strictEqual(entries[0].value, '首页')
  assert.strictEqual(entries[0].key, 'home.title')
})

test('extractVueScriptBlocks assigns distinct identities per Options and setup block', () => {
  const source = [
    '<script>',
    'export default { data() { return { label: "选项文案" } } }',
    '</script>',
    '<script setup lang="ts">',
    'const title: string = "设置文案"',
    '</script>',
    ''
  ].join('\n')
  const blocks = extractVueScriptBlocks({
    source,
    resource: { projectPath: 'src/Dual.vue', block: 'script' },
    config: {}
  })
  assert.deepStrictEqual(
    blocks.map(item => item.resource.identity).sort(),
    [
      'src/Dual.vue::script[lang=js]',
      'src/Dual.vue::script[lang=ts;setup=true]'
    ]
  )
  const values = blocks.flatMap(item => item.entries.map(entry => entry.value)).sort()
  assert.deepStrictEqual(values, ['设置文案', '选项文案'])
})
