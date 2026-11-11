const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const Watchpack = require('watchpack')
const { catalogFiles, loadConfig } = require('../mycommon/config')
const { SOURCE_CATALOG_FILE } = require('../mycommon/source-catalog-freshness')
const { EXIT } = require('./collect')

const AGGREGATE_MS = 50
const IGNORED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist'
])

function readFileBuffer(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return Buffer.alloc(0)
  return fs.readFileSync(file)
}

function walkFiles(directory, out = []) {
  if (!fs.existsSync(directory)) return out
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name)
    const stat = fs.statSync(file)
    if (stat.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(name) || name.startsWith('.i18n-build-staging-')) continue
      walkFiles(file, out)
    } else if (stat.isFile()) {
      out.push(file)
    }
  }
  return out
}

function catalogFingerprint(root, config) {
  const sourceCatalog = path.join(root, config.catalogDir, SOURCE_CATALOG_FILE)
  const files = catalogFiles(config)
  return crypto.createHash('sha1')
    .update(readFileBuffer(sourceCatalog))
    .update('\0')
    .update(readFileBuffer(path.join(root, files.messages)))
    .update('\0')
    .update(readFileBuffer(path.join(root, files.metadata)))
    .digest('hex')
}

function cycleInputSignature(root, parsed, config) {
  const files = catalogFiles(config)
  const runtimeModule = config.buildReplacement && config.buildReplacement.runtimeModule
  const inputs = [
    path.join(root, config.catalogDir, SOURCE_CATALOG_FILE),
    path.join(root, files.metadata),
    path.join(root, files.messages),
    path.join(root, 'i18n-collect.config.js'),
    path.resolve(root, parsed.webpackConfig || 'webpack.config.js'),
    runtimeModule ? path.resolve(root, runtimeModule) : null,
    ...walkFiles(path.join(root, 'src'))
  ].filter(Boolean)
  const hash = crypto.createHash('sha1')
  for (const file of inputs.sort()) {
    hash.update(file)
    hash.update('\0')
    hash.update(readFileBuffer(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function readPublishedBundle(root, bundleRelative) {
  const file = path.join(root, bundleRelative)
  if (!fs.existsSync(file)) return null
  return fs.readFileSync(file, 'utf8')
}

function shouldIgnoreWatchPath(root, filePath) {
  const relative = path.relative(root, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return true
  const parts = relative.split(path.sep)
  if (parts.some(part => (
    IGNORED_DIR_NAMES.has(part)
    || part.startsWith('.i18n-build-staging-')
    || part.includes('.i18n-build-bak-')
  ))) {
    return true
  }
  if (parts.some(part => part.startsWith('.commit-') && part.endsWith('.json'))) return true
  return false
}

function listExisting(files) {
  return files.filter(file => fs.existsSync(file))
}

function createWatchBuildSession({
  root,
  parsed,
  runReplacementCompilation,
  requireBuildReplacement,
  prepareReadOnlyBuild,
  failure,
  jsonText,
  humanReport,
  collectionSummary
}) {
  const json = Boolean(parsed.json)
  const publishes = []
  const idleWaiters = new Set()
  const publishWaiters = new Set()
  const statusWaiters = new Set()
  const suppressedWrites = new Set()
  let closed = false
  let cycleRunning = false
  let pending = true
  let aggregateTimer = null
  let lastCycleSignature = null
  let lastExitCode = EXIT.ok
  let lastStdout = ''
  let lastStderr = ''
  let watchpack = null
  let replacementCompiler = null
  let closeResolve = null
  const closedPromise = new Promise(resolve => {
    closeResolve = resolve
  })
  const signalHandlers = []

  function notifyIdle() {
    if (cycleRunning || pending || closed) return
    for (const waiter of [...idleWaiters]) {
      idleWaiters.delete(waiter)
      waiter()
    }
  }

  function notifyStatus() {
    for (const waiter of [...statusWaiters]) {
      if (waiter.check()) {
        statusWaiters.delete(waiter)
        waiter.resolve()
      }
    }
  }

  function notifyPublish() {
    for (const waiter of [...publishWaiters]) {
      if (publishes.length > waiter.since) {
        publishWaiters.delete(waiter)
        waiter.resolve(publishes[publishes.length - 1])
      }
    }
    notifyStatus()
  }

  function scheduleCycle() {
    if (closed) return
    pending = true
    clearTimeout(aggregateTimer)
    aggregateTimer = setTimeout(() => {
      aggregateTimer = null
      if (!cycleRunning) runCycle()
    }, AGGREGATE_MS)
  }

  function trackCompiler(compiler) {
    replacementCompiler = compiler
  }

  function clearCompiler(compiler) {
    if (replacementCompiler === compiler) replacementCompiler = null
  }

  function rememberSelfWrites(config, bundleRelative) {
    const files = catalogFiles(config)
    const paths = [
      path.join(root, config.catalogDir, SOURCE_CATALOG_FILE),
      path.join(root, files.metadata),
      path.join(root, files.messages),
      path.join(root, config.outputPath),
      path.join(root, config.sourceMapFilename),
      bundleRelative ? path.join(root, bundleRelative) : null,
      path.join(root, 'dist')
    ].filter(Boolean)
    for (const file of paths) suppressedWrites.add(path.resolve(file))
  }

  async function runReplacementPhase(config, prepared) {
    return runReplacementCompilation(root, parsed, config, {
      prepared,
      onCompiler(compiler) {
        trackCompiler(compiler)
      },
      onCompilerClosed(compiler) {
        clearCompiler(compiler)
      }
    })
  }

  async function runCycle() {
    if (closed || cycleRunning) return
    cycleRunning = true
    pending = false
    try {
      let config
      try {
        config = requireBuildReplacement(root)
      } catch (error) {
        const failed = failure(error, json)
        lastExitCode = failed.code
        lastStdout = failed.stdout
        lastStderr = failed.stderr
        notifyStatus()
        return
      }

      const beforeSignature = cycleInputSignature(root, parsed, config)
      if (lastCycleSignature && beforeSignature === lastCycleSignature) {
        lastExitCode = EXIT.ok
        notifyStatus()
        return
      }

      let prepared
      try {
        prepared = prepareReadOnlyBuild(root, config)
      } catch (error) {
        const failed = failure(error, json)
        lastExitCode = failed.code
        lastStdout = failed.stdout
        lastStderr = failed.stderr
        lastCycleSignature = beforeSignature
        notifyStatus()
        return
      }
      if (closed) return

      rememberSelfWrites(config, null)

      let replacement
      try {
        replacement = await runReplacementPhase(config, prepared)
      } catch (error) {
        const failed = failure(error, json)
        lastExitCode = failed.code
        lastStdout = failed.stdout
        lastStderr = failed.stderr
        lastCycleSignature = beforeSignature
        rememberSelfWrites(config, null)
        notifyStatus()
        return
      }
      if (closed) return

      const bundleRelative = replacement.bundle
      const bundle = readPublishedBundle(root, bundleRelative)
      if (bundle == null) {
        const failed = failure(Object.assign(new Error('replacement compilation finished without a formal bundle'), {
          kind: 'build',
          stage: 'replacement'
        }), json)
        lastExitCode = failed.code
        lastStdout = failed.stdout
        lastStderr = failed.stderr
        lastCycleSignature = beforeSignature
        rememberSelfWrites(config, null)
        notifyStatus()
        return
      }

      const fingerprint = catalogFingerprint(root, config)
      lastCycleSignature = beforeSignature
      rememberSelfWrites(config, bundleRelative)
      publishes.push({
        catalogFingerprint: Buffer.from(fingerprint),
        sourceCatalog: readFileBuffer(path.join(root, config.catalogDir, SOURCE_CATALOG_FILE)),
        bundle,
        bundlePath: bundleRelative,
        adapter: replacement.adapter
      })
      notifyPublish()

      const collection = collectionSummary(prepared)
      const report = {
        adapter: replacement.adapter,
        bundle: bundleRelative,
        collection,
        command: 'build',
        ok: true,
        runtimeExport: replacement.runtimeExport,
        runtimeModule: replacement.runtimeModule,
        watch: true
      }
      lastExitCode = EXIT.ok
      lastStdout = json ? jsonText(report) : humanReport(report)
      lastStderr = ''
      notifyStatus()
    } finally {
      cycleRunning = false
      if (closed) {
        finishClose()
        return
      }
      if (pending) scheduleCycle()
      else notifyIdle()
    }
  }

  function onWatchEvent(filePath) {
    if (closed || !filePath) return
    const resolved = path.resolve(filePath)
    if (suppressedWrites.has(resolved)) {
      suppressedWrites.delete(resolved)
      return
    }
    if (shouldIgnoreWatchPath(root, filePath)) return
    pending = true
    if (cycleRunning) return
    scheduleCycle()
  }

  function startWatchers(config) {
    const files = catalogFiles(config)
    const runtimeModule = config.buildReplacement && config.buildReplacement.runtimeModule
    const watchFiles = listExisting([
      path.join(root, 'i18n-collect.config.js'),
      path.resolve(root, parsed.webpackConfig || 'webpack.config.js'),
      runtimeModule ? path.resolve(root, runtimeModule) : null,
      path.join(root, config.catalogDir, SOURCE_CATALOG_FILE),
      path.join(root, files.metadata),
      path.join(root, files.messages)
    ])
    const watchDirs = listExisting([
      path.join(root, 'src'),
      path.join(root, config.catalogDir)
    ])
    watchpack = new Watchpack({ aggregateTimeout: AGGREGATE_MS })
    watchpack.watch({
      files: watchFiles,
      directories: watchDirs,
      missing: [],
      startTime: Date.now()
    })
    watchpack.on('change', onWatchEvent)
    watchpack.on('remove', onWatchEvent)
  }

  function attachSignals() {
    const onSignal = () => {
      close().catch(() => {})
    }
    for (const name of ['SIGINT', 'SIGTERM']) {
      process.on(name, onSignal)
      signalHandlers.push([name, onSignal])
    }
  }

  function detachSignals() {
    for (const [name, handler] of signalHandlers) {
      process.removeListener(name, handler)
    }
    signalHandlers.length = 0
  }

  function closeCompiler(compiler) {
    if (!compiler || typeof compiler.close !== 'function') return
    try {
      compiler.close(() => {})
    } catch (error) {
      // Best-effort shutdown while a cycle may already be tearing down.
    }
  }

  function finishClose() {
    detachSignals()
    if (aggregateTimer) {
      clearTimeout(aggregateTimer)
      aggregateTimer = null
    }
    if (watchpack) {
      watchpack.close()
      watchpack = null
    }
    closeCompiler(replacementCompiler)
    replacementCompiler = null
    suppressedWrites.clear()
    notifyIdle()
    if (closeResolve) {
      const resolve = closeResolve
      closeResolve = null
      resolve(lastExitCode)
    }
  }

  async function close() {
    if (closed) return closedPromise
    closed = true
    pending = false
    if (aggregateTimer) {
      clearTimeout(aggregateTimer)
      aggregateTimer = null
    }
    if (!cycleRunning) finishClose()
    return closedPromise
  }

  function waitForIdle(options = {}) {
    const timeoutMs = typeof options === 'number' ? options : (options.timeoutMs || 60000)
    const settleMs = typeof options === 'object' && options ? (options.settleMs || 0) : 0
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        idleWaiters.delete(onIdle)
        reject(new Error(`watch did not become idle within ${timeoutMs}ms`))
      }, timeoutMs)
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }
      const onIdle = () => finish()
      const arm = () => {
        if (!cycleRunning && !pending && !closed) {
          finish()
          return
        }
        idleWaiters.add(onIdle)
        notifyIdle()
      }
      if (settleMs > 0) setTimeout(arm, settleMs)
      else arm()
    })
  }

  function waitForPublish(since, timeoutMs = 60000) {
    if (publishes.length > since) {
      return Promise.resolve(publishes[publishes.length - 1])
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        since,
        resolve: value => {
          clearTimeout(timer)
          resolve(value)
        }
      }
      const timer = setTimeout(() => {
        publishWaiters.delete(waiter)
        reject(new Error(`watch did not publish after index ${since} within ${timeoutMs}ms`))
      }, timeoutMs)
      publishWaiters.add(waiter)
    })
  }

  function waitForStatus(predicate, timeoutMs = 60000) {
    if (predicate({
      lastExitCode,
      publishes,
      pending,
      cycleRunning
    })) {
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        check: () => predicate({
          lastExitCode,
          publishes,
          pending,
          cycleRunning
        }),
        resolve: () => {
          clearTimeout(timer)
          resolve()
        }
      }
      const timer = setTimeout(() => {
        statusWaiters.delete(waiter)
        reject(new Error(`watch status predicate was not met within ${timeoutMs}ms`))
      }, timeoutMs)
      statusWaiters.add(waiter)
    })
  }

  async function start() {
    attachSignals()
    const config = requireBuildReplacement(root)
    startWatchers(config)
    await runCycle()
    return {
      code: lastExitCode,
      stdout: lastStdout,
      stderr: lastStderr,
      watch: {
        close,
        waitForIdle,
        waitForPublish,
        waitForStatus,
        get publishes() {
          return publishes
        },
        get lastExitCode() {
          return lastExitCode
        },
        get lastStdout() {
          return lastStdout
        },
        get lastStderr() {
          return lastStderr
        }
      },
      waitUntilClosed: () => closedPromise
    }
  }

  return { start, close, waitForIdle }
}

module.exports = {
  createWatchBuildSession,
  shouldIgnoreWatchPath,
  cycleInputSignature
}
