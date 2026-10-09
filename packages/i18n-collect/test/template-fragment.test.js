const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const MyI18nPlugin = require('../myplugin')

const APP = `<template>
  <div>{{ \`这是\${a}的名字呀\` }}</div>
</template>
<script>
export default { data () { return { b:"我不好" } } }
</script>
`

function textAt(source, location) {
  const lines = source.split('\n')
  if (location.start.line === location.end.line) {
    return lines[location.start.line - 1].slice(location.start.column, location.end.column)
  }
  return [
    lines[location.start.line - 1].slice(location.start.column),
    ...lines.slice(location.start.line, location.end.line - 1),
    lines[location.end.line - 1].slice(0, location.end.column)
  ].join('\n')
}

function collectApp(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-template-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src/App.vue'), source)
  const plugin = new MyI18nPlugin()
  let done
  plugin.apply({
    context: root,
    hooks: { done: { tapPromise(_name, fn) { done = fn } } }
  })
  return done().then(() => ({
    source,
    dictionary: JSON.parse(fs.readFileSync(path.join(root, 'lang/zh_hash.json'), 'utf8')),
    map: JSON.parse(fs.readFileSync(path.join(root, 'lang/zh_hash.map.json'), 'utf8'))
  }))
}

test('collects static Chinese fragments around a template interpolation', async () => {
  const { source, dictionary, map } = await collectApp(APP)
  assert.deepStrictEqual(Object.values(dictionary).sort(), ['我不好', '的名字呀', '这是'])
  const fragments = map.entries.filter(entry => entry.value !== '我不好')
  assert.deepStrictEqual(fragments.map(entry => entry.value).sort(), ['的名字呀', '这是'])
  for (const entry of fragments) {
    assert.strictEqual(entry.locations.length, 1)
    assert.strictEqual(entry.locations[0].kind, 'template-expression')
    assert.strictEqual(textAt(source, entry.locations[0]), entry.value)
  }
})
