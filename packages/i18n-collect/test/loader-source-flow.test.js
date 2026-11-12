const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const loader = require('../myloader')
const { COLLECT_METADATA } = require('../mycommon/session')
const { keyFor } = require('../mycommon/store')

test('loader collects from the active Webpack source, not from a pitch disk reread', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-loader-source-'))
  const resourcePath = path.join(root, 'src', 'app.js')
  fs.mkdirSync(path.dirname(resourcePath), { recursive: true })
  fs.writeFileSync(resourcePath, 'module.exports = "磁盘文案"\n')
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')

  assert.strictEqual(typeof loader.pitch, 'undefined')

  const mod = { buildInfo: {} }
  const compiler = { root: null }
  compiler.root = compiler
  const compilation = { warnings: [] }
  let callbackSource = null

  loader.call(
    {
      resourcePath,
      resourceQuery: '',
      rootContext: root,
      _module: mod,
      _compiler: compiler,
      _compilation: compilation,
      getOptions() {
        return { root }
      },
      callback(_error, source) {
        callbackSource = source
      }
    },
    'module.exports = "管线文案"\n',
    null,
    null
  )

  assert.strictEqual(callbackSource, 'module.exports = "管线文案"\n')
  const snapshot = mod.buildInfo[COLLECT_METADATA].snapshot
  assert.ok(snapshot)
  assert.deepStrictEqual(
    snapshot.entries.map(entry => entry.value),
    ['管线文案']
  )
  assert.ok(!snapshot.entries.some(entry => entry.value === '磁盘文案'))
  assert.strictEqual(keyFor('管线文案'), keyFor(snapshot.entries[0].value))
})
