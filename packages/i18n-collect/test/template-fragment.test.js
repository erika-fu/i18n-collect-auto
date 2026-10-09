const assert = require('assert')
const test = require('node:test')
const { extractTemplateExpressions, extractVueScript } = require('../myloader/extract-vue-compat')

const APP = `<template>
  <div>{{ \`这是\${a}的名字呀\` }}</div>
</template>
<script>
export default { data () { return { b:"我不好" } } }
</script>
`

function textAt(source, location) {
  const lines = source.split('\n')
  return lines[location.start.line - 1].slice(location.start.column, location.end.column)
}

test('collects static Chinese fragments around a template interpolation', () => {
  const resource = { projectPath: 'src/App.vue' }
  const fragments = extractTemplateExpressions({ source: APP, resource })
  const script = extractVueScript({ source: APP, resource })
  assert.deepStrictEqual(fragments.map(entry => entry.value).sort(), ['的名字呀', '这是'])
  for (const entry of fragments) {
    assert.strictEqual(entry.locations[0].kind, 'template-expression')
    assert.strictEqual(textAt(APP, entry.locations[0]), entry.value)
  }
  assert.strictEqual(script[0].locations[0].kind, 'script-string')
  assert.strictEqual(script[0].value, '我不好')
  assert.strictEqual(textAt(APP, script[0].locations[0]), '"我不好"')
})

test('does not execute interpolation expressions or collect HTML text', () => {
  const source = '<template><p>静态段落</p><p>{{ empty + \'拼接后的中文\' }}</p></template>\n'
  const entries = extractTemplateExpressions({ source, resource: { projectPath: 'src/Page.vue' } })
  assert.deepStrictEqual(entries.map(entry => entry.value), ['拼接后的中文'])
  assert.strictEqual(entries[0].locations[0].kind, 'template-expression')
})
