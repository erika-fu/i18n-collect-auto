const assert = require('assert')
const test = require('node:test')
const { getSession } = require('../mycommon/session')

function compiler() {
  const root = {}
  root.root = root
  return root
}

function compilation(root) {
  return { compiler: root }
}

function helloSnapshot(identity = 'src/a.js::script') {
  return {
    identity,
    entries: [{
      value: '你好',
      locations: [{
        path: 'src/a.js',
        kind: 'script-string',
        start: { line: 1, column: 0 },
        end: { line: 1, column: 4 }
      }]
    }]
  }
}

test('commits a replacement snapshot and keeps an abandoned round unpublished', () => {
  const root = compiler()
  const session = getSession(root)
  const first = compilation(root)
  session.begin(first)
  session.commit(first, [helloSnapshot()])
  assert.strictEqual(session.committed.runtimeDictionary()['7eca689f0d3389d9dea66ae112e5cfd7'], '你好')

  const cleared = compilation(root)
  session.begin(cleared)
  session.commit(cleared, [{ identity: 'src/a.js::script', entries: [] }])
  assert.deepStrictEqual(session.committed.runtimeDictionary(), {})

  session.commit(compilation(root), [helloSnapshot()])
  const failed = compilation(root)
  session.begin(failed)
  session.abandon(failed)
  session.commit(failed, [{ identity: 'src/a.js::script', entries: [] }])
  assert.strictEqual(session.committed.runtimeDictionary()['7eca689f0d3389d9dea66ae112e5cfd7'], '你好')
})

test('isolates root compilers and normalizes child compilations to the root', () => {
  const root = compiler()
  const other = compiler()
  assert.notStrictEqual(getSession(root), getSession(other))

  const parent = compilation(root)
  const childCompiler = { root, parentCompilation: parent }
  const child = { compiler: childCompiler }
  const session = getSession(childCompiler)
  assert.strictEqual(session, getSession(root))
  session.begin(parent)
  session.noteInvocation(child)
  session.submit(child, { buildInfo: {} }, helloSnapshot('src/App.vue::template[lang=html]'))
  assert.strictEqual(session.invocationCount(parent), 2)
  assert.strictEqual(session.invocationCount(child), 2)
  assert.strictEqual(getSession(other).invocationCount(compilation(other)), 0)
})
