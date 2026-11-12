const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const webpack = require('webpack')
const { keyFor } = require('../mycommon/store')

const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')

function writeWatchProject(root, {
  entry = './src/app.js',
  files = {
    'src/app.js': 'module.exports = function label() {\n  return "你好"\n}\n'
  }
} = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: 'development',
  devtool: false,
  entry: ${JSON.stringify(entry)},
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist') },
  module: { rules: [{ test: /\\.[cm]?[jt]sx?$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin()],
  watchOptions: { aggregateTimeout: 50, poll: 100 }
}
`)
}

function dictionaryPath(root) {
  return path.join(root, 'lang/zh_hash.json')
}

function readDictionary(root) {
  const file = dictionaryPath(root)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function startWatch(root) {
  const configPath = require.resolve(path.join(root, 'webpack.config.js'))
  delete require.cache[configPath]
  const config = require(configPath)
  const compiler = webpack(config)
  const state = {
    rounds: 0,
    okRounds: 0,
    failedRounds: 0,
    lastOk: false,
    lastErrors: [],
    waiters: []
  }

  const notify = () => {
    const pending = state.waiters.splice(0)
    for (const waiter of pending) waiter()
  }

  const watching = compiler.watch({}, (error, stats) => {
    state.rounds += 1
    const messages = []
    if (error && error.message) messages.push(error.message)
    if (stats && typeof stats.toJson === 'function') {
      for (const item of stats.toJson({ errors: true }).errors || []) {
        if (item && item.message) messages.push(item.message)
      }
    }
    state.lastErrors = messages
    state.lastOk = messages.length === 0 && !(stats && stats.hasErrors())
    if (state.lastOk) state.okRounds += 1
    else state.failedRounds += 1
    notify()
  })

  function waitFor(predicate, { timeoutMs = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      const started = Date.now()
      const check = () => {
        if (predicate(state, readDictionary(root))) {
          resolve(state)
          return
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`watch predicate not met within ${timeoutMs}ms (rounds=${state.rounds}, ok=${state.okRounds}, failed=${state.failedRounds}, errors=${state.lastErrors.join('; ')})`))
          return
        }
        state.waiters.push(check)
      }
      check()
    })
  }

  return {
    state,
    waitFor,
    waitForOkRound(since = 0) {
      return waitFor(current => current.okRounds > since && current.lastOk)
    },
    waitForFailedRound(since = 0) {
      return waitFor(current => current.failedRounds > since && !current.lastOk)
    },
    close() {
      return new Promise((resolve, reject) => {
        watching.close(error => (error ? reject(error) : resolve()))
      })
    }
  }
}

test('watch edit replaces previous collected text for the same resource', { timeout: 90000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-watch-edit-'))
  writeWatchProject(root)
  const watch = startWatch(root)
  try {
    await watch.waitForOkRound(0)
    assert.deepStrictEqual(readDictionary(root), { [keyFor('你好')]: '你好' })

    const beforeOk = watch.state.okRounds
    fs.writeFileSync(
      path.join(root, 'src/app.js'),
      'module.exports = function label() {\n  return "世界"\n}\n'
    )
    await watch.waitForOkRound(beforeOk)
    assert.deepStrictEqual(readDictionary(root), { [keyFor('世界')]: '世界' })
    assert.ok(!Object.values(readDictionary(root)).includes('你好'))
  } finally {
    await watch.close()
  }
})

test('watch keeps cached resource snapshots while another module is edited', { timeout: 90000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-watch-cache-'))
  writeWatchProject(root, {
    files: {
      'src/app.js': 'require("./kept")\nmodule.exports = function label() {\n  return "入口文案"\n}\n',
      'src/kept.js': 'module.exports = function kept() {\n  return "缓存文案"\n}\n'
    }
  })
  const watch = startWatch(root)
  try {
    await watch.waitForOkRound(0)
    assert.deepStrictEqual(readDictionary(root), {
      [keyFor('入口文案')]: '入口文案',
      [keyFor('缓存文案')]: '缓存文案'
    })

    const beforeOk = watch.state.okRounds
    fs.writeFileSync(
      path.join(root, 'src/app.js'),
      'require("./kept")\nmodule.exports = function label() {\n  return "新入口"\n}\n'
    )
    await watch.waitForOkRound(beforeOk)
    assert.deepStrictEqual(readDictionary(root), {
      [keyFor('新入口')]: '新入口',
      [keyFor('缓存文案')]: '缓存文案'
    })
  } finally {
    await watch.close()
  }
})

test('watch addition publishes the new reachable resource snapshot', { timeout: 90000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-watch-add-'))
  writeWatchProject(root)
  const watch = startWatch(root)
  try {
    await watch.waitForOkRound(0)
    assert.deepStrictEqual(readDictionary(root), { [keyFor('你好')]: '你好' })

    const beforeOk = watch.state.okRounds
    fs.writeFileSync(
      path.join(root, 'src/extra.js'),
      'module.exports = function extra() {\n  return "新增文案"\n}\n'
    )
    fs.writeFileSync(
      path.join(root, 'src/app.js'),
      'require("./extra")\nmodule.exports = function label() {\n  return "你好"\n}\n'
    )
    await watch.waitForOkRound(beforeOk)
    assert.deepStrictEqual(readDictionary(root), {
      [keyFor('你好')]: '你好',
      [keyFor('新增文案')]: '新增文案'
    })
  } finally {
    await watch.close()
  }
})

test('watch removal and unreachability drop snapshots from the aggregate', { timeout: 90000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-watch-remove-'))
  writeWatchProject(root, {
    files: {
      'src/app.js': 'require("./kept")\nrequire("./drop")\nmodule.exports = "入口"\n',
      'src/kept.js': 'module.exports = "保留文案"\n',
      'src/drop.js': 'module.exports = "将删除"\n',
      'src/orphan.js': 'module.exports = "不可达文案"\n'
    }
  })
  const watch = startWatch(root)
  try {
    await watch.waitForOkRound(0)
    const initial = readDictionary(root)
    assert.strictEqual(initial[keyFor('入口')], '入口')
    assert.strictEqual(initial[keyFor('保留文案')], '保留文案')
    assert.strictEqual(initial[keyFor('将删除')], '将删除')
    assert.ok(!Object.values(initial).includes('不可达文案'))

    const beforeOk = watch.state.okRounds
    fs.writeFileSync(
      path.join(root, 'src/app.js'),
      'require("./kept")\nmodule.exports = "入口"\n'
    )
    fs.rmSync(path.join(root, 'src/drop.js'))
    await watch.waitForOkRound(beforeOk)
    const after = readDictionary(root)
    assert.deepStrictEqual(after, {
      [keyFor('入口')]: '入口',
      [keyFor('保留文案')]: '保留文案'
    })
    assert.ok(!Object.values(after).includes('将删除'))
    assert.ok(!Object.values(after).includes('不可达文案'))
  } finally {
    await watch.close()
  }
})

test('failed watch rounds preserve the previous complete snapshot and formal outputs', { timeout: 90000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-watch-fail-'))
  writeWatchProject(root)
  const watch = startWatch(root)
  try {
    await watch.waitForOkRound(0)
    const beforeDict = fs.readFileSync(dictionaryPath(root))
    const beforeMap = fs.readFileSync(path.join(root, 'lang/zh_hash.map.json'))
    const beforeCatalog = fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json'))
    const beforeAnalysis = fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json'))
    const beforeFailed = watch.state.failedRounds

    fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = "你好"\n%%%\n')
    await watch.waitForFailedRound(beforeFailed)
    assert.deepStrictEqual(fs.readFileSync(dictionaryPath(root)), beforeDict)
    assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.map.json')), beforeMap)
    assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json')), beforeCatalog)
    assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json')), beforeAnalysis)
    assert.deepStrictEqual(readDictionary(root), { [keyFor('你好')]: '你好' })

    const beforeOk = watch.state.okRounds
    fs.writeFileSync(
      path.join(root, 'src/app.js'),
      'module.exports = function label() {\n  return "恢复文案"\n}\n'
    )
    await watch.waitForOkRound(beforeOk)
    assert.deepStrictEqual(readDictionary(root), { [keyFor('恢复文案')]: '恢复文案' })
  } finally {
    await watch.close()
  }
})

test('failed formal output publication rolls back the committed resource snapshots', async () => {
  const { CollectionSession } = require('../mycommon/session')
  const {
    analysisReport,
    analyzeSnapshots,
    buildSourceCatalog
  } = require('../mycommon/project-analysis')
  const { publishCollectionOutputs } = require('../mycommon/formal-outputs')
  const { loadConfig } = require('../mycommon/config')

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-atomic-publish-'))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')
  const config = loadConfig({ root })
  const session = new CollectionSession()
  const helloSnapshots = [{
    identity: 'src/a.js::script',
    projectPath: 'src/a.js',
    entries: [{
      value: '你好',
      locations: [{
        path: 'src/a.js',
        kind: 'script-string',
        start: { line: 1, column: 0 },
        end: { line: 1, column: 4 }
      }]
    }]
  }]
  const first = { compiler: {} }
  session.begin(first)
  const firstAnalysis = analyzeSnapshots(helloSnapshots, config)
  await session.release(first, helloSnapshots, config.configHash, store => publishCollectionOutputs({
    root: config.root,
    config,
    catalog: buildSourceCatalog(firstAnalysis),
    report: analysisReport(firstAnalysis),
    dictionary: store.runtimeDictionary(),
    sourceMap: store.sourceMap(config.configHash)
  }))
  const beforeDict = fs.readFileSync(path.join(root, config.outputPath))
  const beforeMap = fs.readFileSync(path.join(root, config.sourceMapFilename))
  const beforeCatalog = fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json'))
  const beforeAnalysis = fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json'))

  const failed = { compiler: {} }
  session.begin(failed)
  const realRename = fs.renameSync.bind(fs)
  let forced = false
  fs.renameSync = (from, to) => {
    if (!forced && String(to).replace(/\\/g, '/').endsWith('source-catalog.json')) {
      forced = true
      throw new Error('forced formal publish failure')
    }
    return realRename(from, to)
  }
  const worldSnapshots = [{
    identity: 'src/a.js::script',
    projectPath: 'src/a.js',
    entries: [{
      value: '世界',
      locations: [{
        path: 'src/a.js',
        kind: 'script-string',
        start: { line: 1, column: 0 },
        end: { line: 1, column: 4 }
      }]
    }]
  }]
  const nextAnalysis = analyzeSnapshots(worldSnapshots, config)
  try {
    await assert.rejects(
      () => session.release(failed, worldSnapshots, 'next-hash', store => publishCollectionOutputs({
        root: config.root,
        config,
        catalog: buildSourceCatalog(nextAnalysis),
        report: analysisReport(nextAnalysis),
        dictionary: store.runtimeDictionary(),
        sourceMap: store.sourceMap('next-hash')
      })),
      /forced formal publish failure/
    )
  } finally {
    fs.renameSync = realRename
  }

  assert.deepStrictEqual(fs.readFileSync(path.join(root, config.outputPath)), beforeDict)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, config.sourceMapFilename)), beforeMap)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json')), beforeCatalog)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/analysis-report.json')), beforeAnalysis)
  assert.deepStrictEqual(Object.values(session.committed.runtimeDictionary()), ['你好'])
  assert.strictEqual(session.committedConfigHash, config.configHash)
})
