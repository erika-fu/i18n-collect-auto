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

function watchSettled(config, mutate) {
  return new Promise((resolve, reject) => {
    const compiler = webpack(config)
    let compilations = 0
    let timer
    let stopped = false
    let mutated = !mutate
    let baseline = 0
    const watching = compiler.watch({ aggregateTimeout: 20 }, (error, stats) => {
      if (stopped) return
      if (error) return finish(error)
      if (stats.hasErrors()) return finish(new Error(stats.toJson().errors.map(item => item.message).join('\n')))
      compilations += 1
      if (compilations >= 8) return finish(new Error(`watch recompiled ${compilations} times`))
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!mutated) {
          mutated = true
          baseline = compilations
          try {
            mutate()
          } catch (mutationError) {
            return finish(mutationError)
          }
          return
        }
        finish(null, { compilations, baseline })
      }, 2500)
    })

    function finish(error, value) {
      if (stopped) return
      stopped = true
      clearTimeout(timer)
      watching.close(closeError => {
        if (error) reject(error)
        else if (closeError) reject(closeError)
        else resolve(value)
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
  const outputs = ['lang/zh_hash.json', 'lang/zh_hash.map.json'].map(file => path.join(root, file))
  const before = outputs.map(file => fs.statSync(file).mtimeMs)
  const result = await watchSettled(config)
  assert.ok(result.compilations <= 2, `watch recompiled ${result.compilations} times after the collection result was already written`)
  assert.deepStrictEqual(outputs.map(file => fs.statSync(file).mtimeMs), before)
})

test('a real dictionary change recompiles once more and then settles', { timeout: 40000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-watch-change-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.mkdirSync(path.join(root, 'lang'))
  const source = path.join(root, 'src/app.js')
  fs.writeFileSync(source, 'require("../lang/zh_hash.json")\nmodule.exports = "你好"\n')
  fs.writeFileSync(path.join(root, 'lang/zh_hash.json'), '{}\n')
  fs.writeFileSync(path.join(root, 'lang/zh_hash.map.json'), '{}\n')

  const result = await watchSettled(configFor(root), () => {
    fs.writeFileSync(source, 'require("../lang/zh_hash.json")\nmodule.exports = "世界"\n')
  })
  const followUps = result.compilations - result.baseline
  assert.ok(followUps >= 1 && followUps <= 2, `watch ran ${followUps} compilations after the source change`)
  assert.deepStrictEqual(Object.values(JSON.parse(fs.readFileSync(path.join(root, 'lang/zh_hash.json'), 'utf8'))), ['世界'])
})
