const assert = require('assert')
const test = require('node:test')
const { keyFor } = require('../mycommon/store')
const {
  analyzeFormalCollection
} = require('../mycommon/formal-collection-analysis')

test('formal collection analysis returns coherent products from project files', () => {
  const result = analyzeFormalCollection({
    files: [{ path: 'src/app.js', source: "export const title = '你好'\n" }]
  })
  const key = keyFor('你好')

  assert.strictEqual(result.analysis.runtimeMessages.length, 1)
  assert.deepStrictEqual(result.sourceCatalog, {
    version: 1,
    messages: { [key]: '你好' }
  })
  assert.deepStrictEqual(result.report.runtimeMessages, result.analysis.runtimeMessages)
  assert.deepStrictEqual(result.report.coverage, result.analysis.coverage)
})

test('formal collection analysis returns coherent products from resource snapshots', () => {
  const result = analyzeFormalCollection({
    snapshots: [{
      identity: 'src/app.js::script',
      projectPath: 'src/app.js',
      entries: [{
        value: '你好',
        locations: [{
          path: 'src/app.js',
          kind: 'script-string',
          start: { line: 1, column: 14 },
          end: { line: 1, column: 18 }
        }]
      }]
    }]
  })
  const key = keyFor('你好')

  assert.deepStrictEqual(result.sourceCatalog.messages, { [key]: '你好' })
  assert.deepStrictEqual(result.report.runtimeMessages, result.analysis.runtimeMessages)
  assert.deepStrictEqual(result.report.coverage, result.analysis.coverage)
})

test('formal collection analysis accepts exactly one source adapter', () => {
  assert.throws(
    () => analyzeFormalCollection({ files: [], snapshots: [] }),
    /exactly one/
  )
  assert.throws(
    () => analyzeFormalCollection({}),
    /exactly one/
  )
})
