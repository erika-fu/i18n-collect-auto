const fs = require('fs')
const path = require('path')
const { clearCollectionOverrides, loadConfig, setCollectionOverrides } = require('../mycommon/config')
const {
  EXIT,
  classifyBuild,
  ensureCollectPublishPlugin,
  forbidNetwork,
  projectRelative,
  readWebpackConfig
} = require('./collect')

function commandError(kind, message) {
  const error = new Error(message)
  error.kind = kind
  return error
}

function overridesFrom(parsed) {
  const overrides = {}
  if (parsed.include) overrides.include = parsed.include
  if (parsed.exclude) overrides.exclude = parsed.exclude
  if (parsed.contextFilters) overrides.contextFilters = parsed.contextFilters
  return overrides
}

function catalogSnapshot(root, config) {
  const files = {
    dictionary: path.join(root, config.outputPath),
    sourceMap: path.join(root, config.sourceMapFilename),
    sourceCatalog: path.join(root, config.catalogDir, 'source-catalog.json'),
    analysisReport: path.join(root, config.catalogDir, 'analysis-report.json')
  }
  const read = file => (fs.existsSync(file) ? fs.readFileSync(file) : null)
  return {
    files,
    dictionary: read(files.dictionary),
    sourceMap: read(files.sourceMap),
    sourceCatalog: read(files.sourceCatalog),
    analysisReport: read(files.analysisReport)
  }
}

function createWatchCollectSession({
  root,
  parsed,
  failure,
  jsonText,
  humanReport,
  reportFrom
}) {
  const json = Boolean(parsed.json)
  const publishes = []
  const idleWaiters = new Set()
  const publishWaiters = new Set()
  const roundWaiters = new Set()
  let closed = false
  let watching = null
  let restoreNetwork = null
  let lastExitCode = EXIT.ok
  let lastStdout = ''
  let lastStderr = ''
  let closeResolve = null
  const closedPromise = new Promise(resolve => {
    closeResolve = resolve
  })
  const state = {
    rounds: 0,
    okRounds: 0,
    failedRounds: 0,
    lastOk: false,
    lastErrors: []
  }

  function notifyIdle() {
    if (closed) return
    for (const waiter of [...idleWaiters]) {
      idleWaiters.delete(waiter)
      waiter()
    }
  }

  function notifyRounds() {
    for (const waiter of [...roundWaiters]) {
      if (waiter.check(state)) {
        roundWaiters.delete(waiter)
        waiter.resolve(state)
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
  }

  function recordOutcome(code, stdout, stderr) {
    lastExitCode = code
    lastStdout = stdout
    lastStderr = stderr
  }

  async function start() {
    const previous = process.cwd()
    process.chdir(root)
    clearCollectionOverrides()
    try {
      restoreNetwork = forbidNetwork()
      const overrides = overridesFrom(parsed)
      if (Object.keys(overrides).length > 0) {
        setCollectionOverrides(overrides)
        try {
          loadConfig({ root })
        } catch (error) {
          throw commandError(
            'configuration',
            error.message.replace(/^Invalid i18n-collect\.config\.js:/, 'Invalid collect options:')
          )
        }
      }
      loadConfig({ root })
      const configFile = path.resolve(root, parsed.webpackConfig || 'webpack.config.js')
      if (!fs.existsSync(configFile)) {
        throw commandError('configuration', `missing webpack configuration: ${projectRelative(root, configFile)}`)
      }
      const webpackConfig = await readWebpackConfig(configFile)
      if (!webpackConfig || typeof webpackConfig !== 'object' || Array.isArray(webpackConfig)) {
        throw commandError('configuration', 'collect accepts one webpack configuration object')
      }
      ensureCollectPublishPlugin(webpackConfig)
      webpackConfig.cache = false
      webpackConfig.infrastructureLogging = { ...(webpackConfig.infrastructureLogging || {}), level: 'error' }

      const webpack = require('webpack')
      let compiler
      try {
        compiler = webpack(webpackConfig)
      } catch (error) {
        throw commandError('build', error && error.message ? error.message : String(error))
      }

      watching = compiler.watch({}, (error, stats) => {
        if (closed) return
        state.rounds += 1
        const failed = classifyBuild(error, stats)
        const hasErrors = Boolean(failed) || Boolean(stats && stats.hasErrors())
        state.lastErrors = failed ? [failed.message] : []
        state.lastOk = !hasErrors
        if (hasErrors) {
          state.failedRounds += 1
          const outcome = failure(failed || commandError('build', 'webpack reported a build failure'), json)
          recordOutcome(outcome.code, outcome.stdout, outcome.stderr)
          notifyRounds()
          notifyIdle()
          return
        }
        state.okRounds += 1
        try {
          const config = loadConfig({ root })
          const dictionaryFile = path.join(root, config.outputPath)
          if (!fs.existsSync(dictionaryFile)) {
            throw commandError('collection', 'collection finished without a dictionary')
          }
          const report = reportFrom(config, dictionaryFile)
          const snapshot = catalogSnapshot(root, config)
          publishes.push({
            ...snapshot,
            report
          })
          const stdout = json ? jsonText(report) : humanReport(report)
          recordOutcome(EXIT.ok, stdout, '')
          notifyPublish()
        } catch (publishError) {
          state.lastOk = false
          state.okRounds = Math.max(0, state.okRounds - 1)
          state.failedRounds += 1
          const outcome = failure(publishError, json)
          recordOutcome(outcome.code, outcome.stdout, outcome.stderr)
        }
        notifyRounds()
        notifyIdle()
      })

      return {
        code: EXIT.ok,
        stdout: '',
        stderr: '',
        watch: {
          get code() { return lastExitCode },
          get stdout() { return lastStdout },
          get stderr() { return lastStderr },
          get publishes() { return publishes },
          get state() { return state },
          waitForIdle() {
            return new Promise(resolve => {
              if (closed) {
                resolve()
                return
              }
              if (state.rounds > 0) {
                resolve()
                return
              }
              idleWaiters.add(resolve)
            })
          },
          waitForOkRound(since = 0) {
            return new Promise((resolve, reject) => {
              const check = current => current.okRounds > since && current.lastOk
              if (check(state)) {
                resolve(state)
                return
              }
              const started = Date.now()
              const waiter = {
                check: current => {
                  if (Date.now() - started > 60000) {
                    roundWaiters.delete(waiter)
                    reject(new Error(`collect watch ok round not observed (rounds=${current.rounds})`))
                    return false
                  }
                  return check(current)
                },
                resolve
              }
              roundWaiters.add(waiter)
            })
          },
          waitForFailedRound(since = 0) {
            return new Promise((resolve, reject) => {
              const check = current => current.failedRounds > since && !current.lastOk
              if (check(state)) {
                resolve(state)
                return
              }
              const started = Date.now()
              const waiter = {
                check: current => {
                  if (Date.now() - started > 60000) {
                    roundWaiters.delete(waiter)
                    reject(new Error(`collect watch failed round not observed (rounds=${current.rounds})`))
                    return false
                  }
                  return check(current)
                },
                resolve
              }
              roundWaiters.add(waiter)
            })
          },
          waitForPublish(since = 0) {
            return new Promise(resolve => {
              if (publishes.length > since) {
                resolve(publishes[publishes.length - 1])
                return
              }
              publishWaiters.add({ since, resolve })
            })
          },
          close() {
            if (closed) return closedPromise
            closed = true
            clearCollectionOverrides()
            if (restoreNetwork) restoreNetwork()
            process.chdir(previous)
            if (!watching) {
              closeResolve()
              return closedPromise
            }
            watching.close(error => {
              watching = null
              if (error) {
                recordOutcome(EXIT.build, '', `build: ${error.message}\n`)
              }
              closeResolve()
            })
            return closedPromise
          }
        }
      }
    } catch (error) {
      if (restoreNetwork) restoreNetwork()
      clearCollectionOverrides()
      process.chdir(previous)
      const failed = failure(error, json)
      return {
        ...failed,
        watch: {
          code: failed.code,
          stdout: failed.stdout,
          stderr: failed.stderr,
          publishes: [],
          state,
          waitForIdle: async () => {},
          waitForOkRound: async () => state,
          waitForFailedRound: async () => state,
          waitForPublish: async () => null,
          close: async () => {}
        }
      }
    }
  }

  return { start }
}

module.exports = {
  createWatchCollectSession
}
