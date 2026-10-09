const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const webpack = require('webpack')
const MyI18nPlugin = require('../myplugin')

function configFor(root) {
  return {
    context: root,
    mode: 'development',
    entry: path.join(root, 'src/app.js'),
    output: { path: path.join(root, 'dist'), filename: 'bundle.js' },
    plugins: [new MyI18nPlugin()],
    infrastructureLogging: { level: 'error' },
    watchOptions: { aggregateTimeout: 20 },
    module: {
      rules: [{ test: /\.js$/, loader: require.resolve('../myloader') }]
    }
  }
}

function runOnce(config) {
  return new Promise((resolve, reject) => {
    const compiler = webpack(config)
    compiler.run((error, stats) => {
      compiler.close(closeError => {
        if (error) reject(error)
        else if (closeError) reject(closeError)
        else if (stats.hasErrors()) reject(new Error(stats.toJson().errors.map(item => item.message).join('\n')))
        else resolve()
      })
    })
  })
}

function watchUntilQuiet(config) {
  return new Promise((resolve, reject) => {
    const compiler = webpack(config)
    let compilations = 0
    let timer
    let settled = false
    const watching = compiler.watch({ aggregateTimeout: 20 }, (error, stats) => {
      if (settled) return
      if (error) return finish(error)
      if (stats.hasErrors()) return finish(new Error(stats.toJson().errors.map(item => item.message).join('\n')))
      compilations += 1
      if (compilations >= 4) return finish()
      clearTimeout(timer)
      timer = setTimeout(() => finish(), 2500)
    })

    function finish(error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      watching.close(closeError => {
        if (error) reject(error)
        else if (closeError) reject(closeError)
        else resolve(compilations)
      })
    }
  })
}

test('watch stays idle when the collection result is unchanged', { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-watch-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.mkdirSync(path.join(root, 'lang'))
  fs.writeFileSync(path.join(root, 'src/app.js'), 'require("../lang/zh_hash.json")\nmodule.exports = "你好"\n')
  fs.writeFileSync(path.join(root, 'lang/zh_hash.json'), '{}\n')
  fs.writeFileSync(path.join(root, 'lang/zh_hash.map.json'), '{}\n')

  const config = configFor(root)
  await runOnce(config)
  const compilations = await watchUntilQuiet(config)
  assert.ok(compilations <= 2, `watch recompiled ${compilations} times after the collection result was already written`)
})
