const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { identityFiles } = require('../mycommon/config')
const { readExplicitMessages } = require('../mycommon/catalog')

test('readExplicitMessages returns an empty list when the manifest is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-explicit-missing-'))
  assert.deepStrictEqual(readExplicitMessages(path.join(root, 'explicit-messages.json')), [])
})

test('readExplicitMessages loads versioned explicit source messages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-explicit-load-'))
  const file = path.join(root, 'explicit-messages.json')
  fs.writeFileSync(file, `${JSON.stringify({
    version: 1,
    messages: [
      { key: 'items.deleted', source: '已删除 {count} 项' },
      { key: 'home.title', source: '首页' }
    ]
  })}\n`)
  assert.deepStrictEqual(readExplicitMessages(file), [
    { key: 'items.deleted', source: '已删除 {count} 项' },
    { key: 'home.title', source: '首页' }
  ])
})

test('readExplicitMessages rejects unsupported versions, bad shapes, and duplicate keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-explicit-bad-'))
  const file = path.join(root, 'explicit-messages.json')
  fs.writeFileSync(file, '{"version":99,"messages":[]}\n')
  assert.throws(() => readExplicitMessages(file), /version 99 is unsupported/)
  fs.writeFileSync(file, '{"version":1}\n')
  assert.throws(() => readExplicitMessages(file), /must include a messages array/)
  fs.writeFileSync(file, `${JSON.stringify({
    version: 1,
    messages: [
      { key: 'items.deleted', source: '已删除 {count} 项' },
      { key: 'items.deleted', source: '又删了 {count} 项' }
    ]
  })}\n`)
  assert.throws(() => readExplicitMessages(file), /duplicate explicit message/)
  fs.writeFileSync(file, `${JSON.stringify({
    version: 1,
    messages: [{ key: '', source: '首页' }]
  })}\n`)
  assert.throws(() => readExplicitMessages(file), /non-empty localization key/)
  fs.writeFileSync(file, `${JSON.stringify({
    version: 1,
    messages: [{ key: 'home.title', source: '' }]
  })}\n`)
  assert.throws(() => readExplicitMessages(file), /non-empty source/)
})

test('identityFiles exposes the explicit message manifest beside catalog metadata', () => {
  assert.strictEqual(
    identityFiles({ catalogDir: 'lang/catalog' }).explicitMessages,
    'lang/catalog/explicit-messages.json'
  )
})
