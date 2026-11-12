const assert = require('assert')
const path = require('path')
const { spawnSync } = require('child_process')
const test = require('node:test')
const {
  assembleLiveSet,
  getSession,
  moduleMetadata,
  retainStaticHtmlSnapshots,
  selectActiveHtmlTemplates
} = require('../mycommon/session')

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

function snapshotEntry(value, projectPath, kind = 'script-string') {
  return {
    value,
    locations: [{
      path: projectPath,
      kind,
      start: { line: 1, column: 0 },
      end: { line: 1, column: value.length }
    }]
  }
}

test('vue blocks and resource-query identities replace independently', () => {
  const root = compiler()
  const session = getSession(root)
  const script = {
    identity: 'src/App.vue::script[lang=js]',
    projectPath: 'src/App.vue',
    entries: [snapshotEntry('脚本文案', 'src/App.vue')]
  }
  const template = {
    identity: 'src/App.vue::template[lang=html]',
    projectPath: 'src/App.vue',
    entries: [snapshotEntry('模板文案', 'src/App.vue', 'html-text')]
  }
  const styleZero = {
    identity: 'src/App.vue::style[index=0;lang=css]',
    projectPath: 'src/App.vue',
    entries: []
  }
  const styleOne = {
    identity: 'src/App.vue::style[index=1;lang=scss]',
    projectPath: 'src/App.vue',
    entries: []
  }
  const htmlDocument = {
    identity: 'src/copy.html::html',
    projectPath: 'src/copy.html',
    entries: [snapshotEntry('页面文案', 'src/copy.html', 'html-text')]
  }
  const htmlAsTemplate = {
    identity: 'src/copy.html::template[lang=html]',
    projectPath: 'src/copy.html',
    entries: [snapshotEntry('查询模板', 'src/copy.html', 'html-text')]
  }
  const first = compilation(root)
  session.begin(first)
  for (const snapshot of [script, template, styleZero, styleOne, htmlDocument, htmlAsTemplate]) {
    session.submit(first, { buildInfo: {} }, snapshot)
  }
  session.commit(first, session.candidateSnapshots(first), 'hash-1')
  assert.deepStrictEqual(
    session.committedSnapshots().map(snapshot => snapshot.identity).sort(),
    [
      'src/App.vue::script[lang=js]',
      'src/App.vue::style[index=0;lang=css]',
      'src/App.vue::style[index=1;lang=scss]',
      'src/App.vue::template[lang=html]',
      'src/copy.html::html',
      'src/copy.html::template[lang=html]'
    ]
  )
  assert.deepStrictEqual(new Set(Object.values(session.committed.runtimeDictionary())), new Set([
    '脚本文案',
    '模板文案',
    '页面文案',
    '查询模板'
  ]))

  const next = compilation(root)
  session.begin(next)
  const updatedTemplate = {
    ...template,
    entries: [snapshotEntry('新模板', 'src/App.vue', 'html-text')]
  }
  const updatedHtmlDocument = {
    ...htmlDocument,
    entries: [snapshotEntry('新页面', 'src/copy.html', 'html-text')]
  }
  for (const snapshot of [script, updatedTemplate, styleZero, styleOne, updatedHtmlDocument, htmlAsTemplate]) {
    session.submit(next, { buildInfo: {} }, snapshot)
  }
  session.commit(next, session.candidateSnapshots(next), 'hash-2')
  assert.deepStrictEqual(
    session.committedSnapshots().map(snapshot => snapshot.identity).sort(),
    [
      'src/App.vue::script[lang=js]',
      'src/App.vue::style[index=0;lang=css]',
      'src/App.vue::style[index=1;lang=scss]',
      'src/App.vue::template[lang=html]',
      'src/copy.html::html',
      'src/copy.html::template[lang=html]'
    ]
  )
  assert.deepStrictEqual(new Set(Object.values(session.committed.runtimeDictionary())), new Set([
    '脚本文案',
    '新模板',
    '新页面',
    '查询模板'
  ]))
  assert.ok(!Object.values(session.committed.runtimeDictionary()).includes('模板文案'))
  assert.ok(!Object.values(session.committed.runtimeDictionary()).includes('页面文案'))
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

test('assembleLiveSet keeps distinct identities that share a project path', () => {
  const script = helloSnapshot('src/App.vue::script[lang=js]')
  script.projectPath = 'src/App.vue'
  const template = helloSnapshot('src/App.vue::template[lang=html]')
  template.projectPath = 'src/App.vue'
  template.entries = [snapshotEntry('模板文案', 'src/App.vue', 'html-text')]
  const live = assembleLiveSet([
    cachedModule(script),
    cachedModule(template)
  ], { root: ROOT, fileConfigHash: FILE_HASH })
  assert.deepStrictEqual(live.snapshots.map(snapshot => snapshot.identity).sort(), [
    'src/App.vue::script[lang=js]',
    'src/App.vue::template[lang=html]'
  ])
  assert.deepStrictEqual(
    live.snapshots.map(snapshot => snapshot.entries[0].value).sort(),
    ['你好', '模板文案']
  )
})

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

function htmlSnapshot(projectPath, value) {
  return {
    identity: `${projectPath}::html`,
    projectPath,
    entries: [{
      value,
      locations: [{
        path: projectPath,
        kind: 'static-html-text',
        start: { line: 1, column: 0 },
        end: { line: 1, column: value.length }
      }]
    }]
  }
}

test('keeps a static HTML snapshot when a cached child submits nothing new', () => {
  const retained = retainStaticHtmlSnapshots({
    live: [helloSnapshot()],
    submitted: [],
    committed: [htmlSnapshot('public/index.html', '页面文案')],
    activeTemplates: ['public/index.html']
  })
  assert.deepStrictEqual(retained.map(snapshot => snapshot.identity).sort(), [
    'public/index.html::html',
    'src/a.js::script'
  ])
  assert.strictEqual(retained.find(snapshot => snapshot.identity.endsWith('::html')).entries[0].value, '页面文案')
})

test('a new static HTML snapshot replaces the committed snapshot with the same identity', () => {
  const retained = retainStaticHtmlSnapshots({
    live: [],
    submitted: [htmlSnapshot('public/index.html', '新文案')],
    committed: [htmlSnapshot('public/index.html', '旧文案')],
    activeTemplates: ['public/index.html']
  })
  assert.deepStrictEqual(retained.map(snapshot => snapshot.entries[0].value), ['新文案'])
})

test('an empty static HTML submission clears the previous copy', () => {
  const retained = retainStaticHtmlSnapshots({
    live: [],
    submitted: [{ identity: 'public/index.html::html', projectPath: 'public/index.html', entries: [] }],
    committed: [htmlSnapshot('public/index.html', '页面文案')],
    activeTemplates: ['public/index.html']
  })
  assert.strictEqual(retained.length, 1)
  assert.deepStrictEqual(retained[0].entries, [])
})

test('drops a static HTML snapshot that is deleted, replaced, or no longer configured', () => {
  const retained = retainStaticHtmlSnapshots({
    live: [helloSnapshot()],
    submitted: [htmlSnapshot('public/gone.html', '将删除')],
    committed: [htmlSnapshot('public/index.html', '页面文案'), htmlSnapshot('public/about.html', '关于')],
    activeTemplates: ['public/about.html']
  })
  assert.deepStrictEqual(retained.map(snapshot => snapshot.identity).sort(), [
    'public/about.html::html',
    'src/a.js::script'
  ])
})

test('keeps standalone HTML already present in the main module graph', () => {
  const current = htmlSnapshot('src/page.html', '页面')
  const retained = retainStaticHtmlSnapshots({
    live: [current],
    submitted: [],
    committed: [htmlSnapshot('src/page.html', '旧页面')],
    activeTemplates: []
  })
  assert.deepStrictEqual(retained.map(snapshot => snapshot.entries[0].value), ['页面'])
})

test('selects HTML templates that stay configured, depended on, and present', () => {
  const root = path.resolve('/project')
  const index = path.join(root, 'public/index.html')
  const gone = path.join(root, 'public/gone.html')
  const idle = path.join(root, 'public/other.html')
  const active = selectActiveHtmlTemplates({
    root,
    templates: [index, gone, idle],
    dependencies: [index, gone],
    missing: [gone],
    present: file => path.resolve(file) !== path.resolve(gone)
  })
  assert.deepStrictEqual(active, ['public/index.html'])
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
