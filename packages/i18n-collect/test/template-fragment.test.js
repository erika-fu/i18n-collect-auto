const assert = require('assert')
const test = require('node:test')
const { extractHtml } = require('../myloader/extract-html')
const { extractVueScript } = require('../myloader/extract-vue-compat')

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

function templateResource(projectPath) {
  return { projectPath, query: '?vue&type=template', lang: 'html', block: 'template' }
}

test('collects static Chinese fragments around a template interpolation', () => {
  const resource = templateResource('src/App.vue')
  const fragments = extractHtml({ source: APP, resource, config: { attributeAllowlist: [] } }).entries
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

test('collects HTML text and interpolation strings as separate kinds', () => {
  const source = '<template><p>静态段落</p><p>{{ empty + \'拼接后的中文\' }}</p></template>\n'
  const entries = extractHtml({
    source,
    resource: templateResource('src/Page.vue'),
    config: { attributeAllowlist: [] }
  }).entries
  assert.deepStrictEqual(entries.map(entry => entry.value), ['静态段落', '拼接后的中文'])
  assert.deepStrictEqual(entries.map(entry => entry.locations[0].kind), ['html-text', 'template-expression'])
})
