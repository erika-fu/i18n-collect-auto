const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

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

function projectFiles(root) {
  const files = []
  const visit = directory => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name)
      if (fs.statSync(file).isDirectory()) visit(file)
      else files.push(file)
    }
  }
  visit(root)
  return files.sort()
}

function snapshotFiles(root) {
  return new Map(projectFiles(root).map(file => [file, fs.readFileSync(file)]))
}

function assertUnchanged(before, root, ignore = []) {
  const ignored = new Set(ignore.map(file => path.resolve(root, file)))
  const after = snapshotFiles(root)
  for (const [file, contents] of before) {
    if (ignored.has(file) || file.startsWith(path.join(root, 'dist')) || file.startsWith(path.join(root, 'lang'))) {
      continue
    }
    assert.ok(after.has(file), `missing ${file}`)
    assert.deepStrictEqual(after.get(file), contents, `changed ${path.relative(root, file)}`)
  }
}

function writeBuildProject(root, {
  source = 'module.exports = function label() {\n  return "你好"\n}\n',
  files = {},
  entry = './src/app.js',
  configSource = [
    'module.exports = {',
    '  buildReplacement: {',
    '    enabled: true,',
    '    adapter: "js",',
    '    runtimeModule: "src/i18n.js",',
    '    runtimeExport: "t"',
    '  }',
    '}',
    ''
  ].join('\n')
} = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  fs.writeFileSync(path.join(root, 'src/i18n.js'), [
    'function t(key) { return key }',
    'module.exports = { t }',
    ''
  ].join('\n'))
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), configSource)
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: 'development',
  devtool: false,
  entry: ${JSON.stringify(entry)},
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  module: { rules: [{ test: /\\.[cm]?[jt]sx?$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin()]
}
`)
}

test('build help describes the two-phase Build replacement command', () => {
  const result = run(['build', '--help'])
  assert.strictEqual(result.status, 0)
  assert.match(result.stdout, /i18n-collect build/)
  assert.match(result.stdout, /Phase 1/)
  assert.match(result.stdout, /Phase 2/)
  assert.match(result.stdout, /buildReplacement/)
  assert.match(result.stdout, /does not modify|not modified/i)
})

test('build requires buildReplacement to be enabled', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-off-'))
  writeBuildProject(root, { configSource: 'module.exports = {}\n' })
  const result = run(['build', '--json'], root)
  assert.strictEqual(result.status, 1)
  assert.match(result.stderr, /buildReplacement\.enabled/)
})

test('build publishes a stable key into the formal bundle without rewriting source files', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-ok-'))
  writeBuildProject(root)
  const before = snapshotFiles(root)
  const result = run(['build', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(result.stderr, '')
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'build')
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.adapter, 'js')
  assert.ok(report.collection.catalog.keys >= 1)
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), 'utf8'))
  const key = Object.keys(metadata.entries).find(name => metadata.entries[name].source === '你好')
  assert.ok(key)
  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(bundle, new RegExp(key.replace(/\./g, '\\.')))
  assert.doesNotMatch(bundle, /你好/)
  assertUnchanged(before, root)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), before.get(path.join(root, 'src/app.js')).toString())
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/replacements.json')))
})

test('build fails the first phase on a key conflict and does not emit a formal bundle', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-conflict-'))
  writeBuildProject(root, {
    source: 'require("./other")\nmodule.exports = /* i18n-key: shared.title */ "首页"\n',
    files: {
      'src/other.js': 'module.exports = /* i18n-key: shared.title */ "主页"\n'
    }
  })
  const before = snapshotFiles(root)
  const result = run(['build', '--json'], root)
  assert.strictEqual(result.status, 2, result.stderr)
  assert.match(result.stderr, /localization key conflict|collection:/)
  const body = JSON.parse(result.stdout)
  assert.strictEqual(body.ok, false)
  assert.strictEqual(body.command, 'build')
  assert.ok(!fs.existsSync(path.join(root, 'dist/bundle.js')))
  assertUnchanged(before, root)
})

test('build ESM entry injects runtime import into the formal bundle', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-build-esm-'))
  writeBuildProject(root, {
    source: 'export function label() {\n  return "你好"\n}\n',
    entry: './src/app.js',
    files: {
      'src/i18n.js': 'export function t(key) { return key }\n'
    }
  })
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: 'development',
  devtool: false,
  entry: './src/app.js',
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  module: { rules: [{ test: /\\.js$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin()],
  experiments: { outputModule: false }
}
`)
  const before = snapshotFiles(root)
  const result = run(['build', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), 'utf8'))
  const key = Object.keys(metadata.entries).find(name => metadata.entries[name].source === '你好')
  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(bundle, new RegExp(key.replace(/\./g, '\\.')))
  assertUnchanged(before, root)
})
