const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { keyFor } = require('../mycommon/store')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function writeCollectProject(root, {
  entry = './src/app.js',
  files = {
    'src/app.js': 'module.exports = function label() {\n  return "你好"\n}\n',
    'src/orphan.js': 'module.exports = function orphan() {\n  return "不可达文案"\n}\n'
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
  plugins: [new MyI18nPlugin()]
}
`)
}

test('collect runs a Webpack compilation and publishes reachable runtime messages', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-ok-'))
  writeCollectProject(root)
  const result = run(['collect', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.command, 'collect')
  const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'lang/zh_hash.json'), 'utf8'))
  assert.deepStrictEqual(dictionary, { [keyFor('你好')]: '你好' })
  assert.ok(!Object.values(dictionary).includes('不可达文案'))
})

test('collection failures leave previous dictionary outputs unchanged', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-fail-'))
  writeCollectProject(root)
  const ok = run(['collect', '--json'], root)
  assert.strictEqual(ok.status, 0, ok.stderr)
  const dictionaryPath = path.join(root, 'lang/zh_hash.json')
  const before = fs.readFileSync(dictionaryPath)
  fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = "你好"\n%%%\n')
  const failed = run(['collect', '--json'], root)
  assert.notStrictEqual(failed.status, 0, failed.stdout)
  assert.deepStrictEqual(fs.readFileSync(dictionaryPath), before)
})
