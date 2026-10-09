const assert = require('assert')
const { spawnSync } = require('child_process')
const test = require('node:test')
const { assembleLiveSet, getSession, moduleMetadata } = require('../mycommon/session')

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

function worldSnapshot(identity = 'src/b.js::script') {
  return {
    identity,
    projectPath: 'src/b.js',
    entries: [{
      value: '世界',
      locations: [{
        path: 'src/b.js',
        kind: 'script-string',
        start: { line: 1, column: 0 },
        end: { line: 1, column: 4 }
      }]
    }]
  }
}

test('keeps overlapping compilations on separate candidate rounds', () => {
  const root = compiler()
  const session = getSession(root)
  const parent = compilation(root)
  const childCompiler = { root, parentCompilation: parent }
  const child = { compiler: childCompiler }
  const other = compilation(root)
  session.begin(parent)
  session.submit(child, { buildInfo: {} }, helloSnapshot('src/App.vue::template[lang=html]'))
  session.begin(child)
  session.begin(other)
  session.submit(other, { buildInfo: {} }, worldSnapshot())
  assert.deepStrictEqual(
    session.candidateSnapshots(parent).map(snapshot => snapshot.identity),
    ['src/App.vue::template[lang=html]']
  )
  assert.deepStrictEqual(
    session.candidateSnapshots(other).map(snapshot => snapshot.identity),
    ['src/b.js::script']
  )
  session.commit(parent, session.candidateSnapshots(parent), 'hash-parent')
  assert.deepStrictEqual(Object.values(session.committed.runtimeDictionary()), ['你好'])
  assert.strictEqual(session.committedConfigHash, 'hash-parent')
  assert.deepStrictEqual(session.candidateSnapshots(parent), [])
  assert.deepStrictEqual(
    session.candidateSnapshots(other).map(snapshot => snapshot.identity),
    ['src/b.js::script']
  )
  session.commit(other, session.candidateSnapshots(other), 'hash-other')
  assert.deepStrictEqual(Object.values(session.committed.runtimeDictionary()), ['世界'])
  assert.strictEqual(session.committedConfigHash, 'hash-other')
})

test('a failed publish leaves the committed snapshots and config hash unchanged', async () => {
  const root = compiler()
  const session = getSession(root)
  const first = compilation(root)
  session.begin(first)
  await session.release(first, [helloSnapshot()], 'hash-1', async () => {})
  const failed = compilation(root)
  session.begin(failed)
  let published
  await assert.rejects(
    () => session.release(failed, [worldSnapshot()], 'hash-2', async store => {
      published = Object.values(store.runtimeDictionary())
      throw new Error('disk full')
    }),
    /disk full/
  )
  assert.deepStrictEqual(published, ['世界'])
  assert.deepStrictEqual(Object.values(session.committed.runtimeDictionary()), ['你好'])
  assert.strictEqual(session.committedConfigHash, 'hash-1')
  assert.deepStrictEqual(session.committedSnapshots().map(snapshot => snapshot.identity), ['src/a.js::script'])
})

test('an abandoned round does not publish a replacement live set', async () => {
  const root = compiler()
  const session = getSession(root)
  const first = compilation(root)
  session.begin(first)
  await session.release(first, [helloSnapshot()], 'hash-1', async () => {})
  const failed = compilation(root)
  session.begin(failed)
  session.abandon(failed)
  let writes = 0
  await session.release(failed, [worldSnapshot()], 'hash-2', async () => {
    writes += 1
  })
  assert.strictEqual(writes, 0)
  assert.deepStrictEqual(Object.values(session.committed.runtimeDictionary()), ['你好'])
  assert.strictEqual(session.committedConfigHash, 'hash-1')
})

test('replacing a candidate snapshot drops the previous copy for that identity', () => {
  const root = compiler()
  const session = getSession(root)
  const current = compilation(root)
  session.begin(current)
  session.submit(current, { buildInfo: {} }, helloSnapshot())
  session.submit(current, { buildInfo: {} }, { identity: 'src/a.js::script', entries: [] })
  session.commit(current, session.candidateSnapshots(current), 'hash')
  assert.deepStrictEqual(session.committed.runtimeDictionary(), {})
  assert.deepStrictEqual(session.committedSnapshots()[0].entries, [])
})

const ROOT = '/project'
const FILE_HASH = 'file-hash'

function cachedModule(snapshot, overrides = {}) {
  return {
    buildInfo: {
      i18nCollect: moduleMetadata({
        root: ROOT,
        fileConfigHash: FILE_HASH,
        included: true,
        snapshot,
        ...overrides
      })
    }
  }
}

test('cached module metadata restores a snapshot without a loader invocation', () => {
  const live = assembleLiveSet([
    cachedModule(helloSnapshot()),
    cachedModule(worldSnapshot())
  ], { root: ROOT, fileConfigHash: FILE_HASH })
  assert.strictEqual(live.integrated, true)
  assert.deepStrictEqual(live.diagnostics, [])
  assert.deepStrictEqual(live.snapshots.map(snapshot => snapshot.identity), [
    'src/a.js::script',
    'src/b.js::script'
  ])
  const kept = assembleLiveSet([cachedModule(helloSnapshot())], { root: ROOT, fileConfigHash: FILE_HASH })
  assert.deepStrictEqual(kept.snapshots.map(snapshot => snapshot.identity), ['src/a.js::script'])
})

test('invalid metadata is diagnosed and stays out of the live set', () => {
  const valid = cachedModule(helloSnapshot())
  const wrongSchema = { buildInfo: { i18nCollect: { schemaVersion: 99, snapshot: helloSnapshot() } } }
  const wrongRoot = cachedModule(worldSnapshot(), { root: '/other' })
  const wrongConfig = cachedModule(worldSnapshot('src/c.js::script'), { fileConfigHash: 'stale' })
  const live = assembleLiveSet([valid, wrongSchema, wrongRoot, wrongConfig, { buildInfo: {} }], {
    root: ROOT,
    fileConfigHash: FILE_HASH
  })
  assert.deepStrictEqual(live.snapshots.map(snapshot => snapshot.identity), ['src/a.js::script'])
  assert.strictEqual(live.integrated, true)
  assert.strictEqual(live.diagnostics.length, 3)
  assert.match(live.diagnostics.join('\n'), /schema/)
  assert.match(live.diagnostics.join('\n'), /root compiler/)
  assert.match(live.diagnostics.join('\n'), /configuration/)
})

test('reclaims the session when its root compiler is collected', () => {
  const result = spawnSync(process.execPath, ['--expose-gc', '-e', `
    const { getSession } = require(${JSON.stringify(require.resolve('../mycommon/session'))})
    function make() {
      let root = {}
      root.root = root
      return new WeakRef(getSession(root))
    }
    const ref = make()
    setTimeout(() => {
      global.gc({ type: 'major', execution: 'sync' })
      global.gc({ type: 'major', execution: 'sync' })
      if (ref.deref()) process.exit(1)
    }, 50)
  `], { encoding: 'utf8' })
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
})
