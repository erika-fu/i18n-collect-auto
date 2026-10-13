const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')
const HELLO = '7eca689f0d3389d9dea66ae112e5cfd7'

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

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

test('collect help describes a non-interactive webpack collection command', () => {
  const result = run(['collect', '--help'])
  assert.strictEqual(result.status, 0)
  assert.strictEqual(result.stderr, '')
  const help = result.stdout
  assert.match(help, /i18n-collect collect/)
  assert.match(help, /--include/)
  assert.match(help, /--exclude/)
  assert.match(help, /--context-filter/)
  assert.match(help, /--webpack-config/)
  assert.match(help, /--json/)
  assert.match(help, /does not translate/)
  assert.match(help, /does not rewrite application source/)
  assert.match(help, /does not make network requests/)
  assert.match(help, /i18n-collect\/myloader/)
  assert.match(help, /i18n-collect\/myplugin/)
  assert.match(help, /configuration failure/)
  assert.match(help, /collection failure/)
  assert.match(help, /build failure/)
})

function writeWebpackProject(root, { entry = './src/app.js', source, files = {}, configSource = '' } = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  fs.writeFileSync(path.join(root, 'src/orphan.js'), 'module.exports = "孤儿词条"\n')
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: 'development',
  entry: ${JSON.stringify(entry)},
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  module: { rules: [{ test: /\\.js$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin()]
}
`)
  if (configSource) fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), configSource)
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(root, 'dist/keep.txt'), 'keep\n')
}

test('collect writes a compatible dictionary through webpack and leaves application source unchanged', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-cli-'))
  writeWebpackProject(root, { source: 'const message = "你好"\nmodule.exports = message\n' })
  const before = snapshotFiles(root)
  const result = run(['collect', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(result.stderr, '')
  const report = JSON.parse(result.stdout)
  assert.deepStrictEqual(report, {
    command: 'collect',
    contextFilters: [],
    dictionary: 'lang/zh_hash.json',
    entries: 1,
    exclude: [],
    include: [],
    ok: true,
    sourceMap: 'lang/zh_hash.map.json'
  })
  const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'lang/zh_hash.json'), 'utf8'))
  const sourceMap = JSON.parse(fs.readFileSync(path.join(root, 'lang/zh_hash.map.json'), 'utf8'))
  assert.deepStrictEqual(dictionary, { [HELLO]: '你好' })
  assert.strictEqual(sourceMap.version, 1)
  assert.strictEqual(sourceMap.parserVersion, 'babel-7')
  assert.deepStrictEqual(sourceMap.entries[0].locations, [{
    path: 'src/app.js',
    kind: 'script-string',
    start: { line: 1, column: 16 },
    end: { line: 1, column: 20 }
  }])
  assert.deepStrictEqual(Object.values(dictionary), ['你好'])
  assert.strictEqual(fs.readFileSync(path.join(root, 'dist/keep.txt'), 'utf8'), 'keep\n')
  for (const [file, bytes] of before) {
    assert.deepStrictEqual(fs.readFileSync(file), bytes)
  }
  const dictionaryBytes = fs.readFileSync(path.join(root, 'lang/zh_hash.json'))
  const mapBytes = fs.readFileSync(path.join(root, 'lang/zh_hash.map.json'))
  const again = run(['collect', '--json'], root)
  assert.strictEqual(again.status, 0, again.stderr)
  assert.strictEqual(again.stdout, result.stdout)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.json')), dictionaryBytes)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.map.json')), mapBytes)
})

function values(root) {
  return Object.values(JSON.parse(fs.readFileSync(path.join(root, 'lang/zh_hash.json'), 'utf8'))).sort()
}

test('collect observes configured scope and lets command-line scope replace it', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-scope-'))
  writeWebpackProject(root, {
    source: 'require("./extra")\nconst message = "页面"\nmodule.exports = message\n',
    files: { 'src/extra.js': 'module.exports = "旁路"\n' },
    configSource: 'module.exports = { exclude: ["src/extra.js"] }\n'
  })
  const configured = run(['collect', '--json'], root)
  assert.strictEqual(configured.status, 0, configured.stderr)
  assert.deepStrictEqual(values(root), ['页面'])
  assert.deepStrictEqual(JSON.parse(configured.stdout).exclude, ['src/extra.js'])

  const replaced = run(['collect', '--json', '--exclude', 'src/app.js'], root)
  assert.strictEqual(replaced.status, 0, replaced.stderr)
  assert.deepStrictEqual(values(root), ['旁路'])
  assert.deepStrictEqual(JSON.parse(replaced.stdout).exclude, ['src/app.js'])
  assert.deepStrictEqual(JSON.parse(replaced.stdout).include, [])

  const included = run(['collect', '--json', '--include', 'src/extra.js', '--exclude', '**/orphan.js'], root)
  assert.strictEqual(included.status, 0, included.stderr)
  assert.deepStrictEqual(values(root), ['旁路'])
  assert.deepStrictEqual(JSON.parse(included.stdout).include, ['src/extra.js'])
})

test('collect lets a command-line context filter replace the configured filter', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-filter-'))
  const source = [
    'const label = "界面文案"',
    'console.log("日志文案")',
    'describe("测试文案", function () {})',
    'module.exports = label',
    ''
  ].join('\n')
  writeWebpackProject(root, {
    source,
    configSource: 'module.exports = { contextFilters: ["logging"] }\n'
  })
  const configured = run(['collect', '--json'], root)
  assert.strictEqual(configured.status, 0, configured.stderr)
  assert.deepStrictEqual(values(root), ['测试文案', '界面文案'].sort())
  assert.deepStrictEqual(JSON.parse(configured.stdout).contextFilters, ['logging'])

  const replaced = run(['collect', '--json', '--context-filter', 'tests'], root)
  assert.strictEqual(replaced.status, 0, replaced.stderr)
  assert.deepStrictEqual(values(root), ['日志文案', '界面文案'].sort())
  assert.deepStrictEqual(JSON.parse(replaced.stdout).contextFilters, ['tests'])
})

test('collect prints a stable human report', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-human-'))
  writeWebpackProject(root, { source: 'const message = "你好"\nmodule.exports = message\n' })
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-elsewhere-'))
  const result = run(['collect', '--cwd', root, '--webpack-config', 'webpack.config.js'], elsewhere)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.strictEqual(result.stderr, '')
  assert.strictEqual(result.stdout, [
    'Collected 1 entry.',
    'Dictionary: lang/zh_hash.json',
    'Source map: lang/zh_hash.map.json',
    'Scope include: (all resources that enter the loader)',
    'Scope exclude: (none)',
    'Context filters: (none)',
    ''
  ].join('\n'))
})

test('an unknown command is a configuration failure and does not translate', () => {
  const result = run(['translate'])
  assert.strictEqual(result.status, 1)
  assert.match(result.stderr, /configuration: unknown command "translate"/)
  assert.doesNotMatch(result.stdout, /translat/)
})

test('collect reports configuration failures for the project file, overrides, and webpack config', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-config-'))
  writeWebpackProject(root, {
    source: 'module.exports = "你好"\n',
    configSource: 'module.exports = { nope: true }\n'
  })
  const invalidFile = run(['collect', '--json'], root)
  assert.strictEqual(invalidFile.status, 1)
  assert.strictEqual(invalidFile.stderr, 'configuration: Invalid i18n-collect.config.js: unknown field "nope"\n')
  assert.deepStrictEqual(JSON.parse(invalidFile.stdout), {
    command: 'collect',
    failure: 'configuration',
    message: 'Invalid i18n-collect.config.js: unknown field "nope"',
    ok: false
  })
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/zh_hash.json')), false)

  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = {}\n')
  const invalidOverride = run(['collect', '--context-filter', 'nope'], root)
  assert.strictEqual(invalidOverride.status, 1)
  assert.match(invalidOverride.stderr, /configuration: Invalid collect options:/)
  assert.match(invalidOverride.stderr, /contextFilters/)
  assert.strictEqual(invalidOverride.stdout, '')

  const unknown = run(['collect', '--translate'], root)
  assert.strictEqual(unknown.status, 1)
  assert.match(unknown.stderr, /unknown option "--translate"/)

  fs.rmSync(path.join(root, 'webpack.config.js'))
  const missing = run(['collect', '--json'], root)
  assert.strictEqual(missing.status, 1)
  assert.match(missing.stderr, /missing webpack configuration: webpack.config.js/)
  assert.strictEqual(JSON.parse(missing.stdout).failure, 'configuration')

  const brokenFlag = run(['collect', '--include', '--json'], root)
  assert.strictEqual(brokenFlag.status, 1)
  assert.strictEqual(JSON.parse(brokenFlag.stdout).failure, 'configuration')
  assert.match(brokenFlag.stderr, /configuration: --include requires a value/)
})

test('collect reports a collection failure and keeps the previous dictionary', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-parse-'))
  const sourceFile = path.join(root, 'src/app.js')
  writeWebpackProject(root, { source: 'const message = "你好"\nmodule.exports = message\n' })
  const first = run(['collect'], root)
  assert.strictEqual(first.status, 0, first.stderr)
  const dictionary = fs.readFileSync(path.join(root, 'lang/zh_hash.json'))
  const sourceMap = fs.readFileSync(path.join(root, 'lang/zh_hash.map.json'))
  fs.writeFileSync(sourceFile, 'const message = "你好\n')
  const failed = run(['collect', '--json'], root)
  assert.strictEqual(failed.status, 2, failed.stderr)
  assert.match(failed.stderr, /collection: /)
  assert.match(failed.stderr, /i18n-collect failed for src\/app\.js/)
  assert.match(failed.stderr, /line \d+/)
  assert.match(failed.stderr, /column \d+/)
  assert.strictEqual(JSON.parse(failed.stdout).failure, 'collection')
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.json')), dictionary)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.map.json')), sourceMap)

  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: 'development',
  entry: './src/app.js',
  module: { rules: [] },
  plugins: [new MyI18nPlugin()]
}
`)
  fs.writeFileSync(sourceFile, 'const message = "你好"\nmodule.exports = message\n')
  const missingLoader = run(['collect'], root)
  assert.strictEqual(missingLoader.status, 2, missingLoader.stderr)
  assert.match(missingLoader.stderr, /i18n-collect loader is not integrated/)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/zh_hash.json')), dictionary)
})

test('collect reports a webpack build failure without publishing a new dictionary', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-build-'))
  writeWebpackProject(root, {
    source: 'const message = "页面"\nrequire("./missing-module")\nmodule.exports = message\n'
  })
  const unresolved = run(['collect'], root)
  assert.strictEqual(unresolved.status, 3, unresolved.stderr)
  assert.match(unresolved.stderr, /^build: /)
  assert.match(unresolved.stderr, /missing-module/)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/zh_hash.json')), false)

  fs.writeFileSync(path.join(root, 'webpack.config.js'), 'throw new Error("build scaffold failed")\n')
  const exploded = run(['collect', '--json'], root)
  assert.strictEqual(exploded.status, 3)
  assert.match(exploded.stderr, /build: build scaffold failed/)
  assert.strictEqual(JSON.parse(exploded.stdout).failure, 'build')
})

test('collect refuses a network request from the webpack configuration', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-net-'))
  writeWebpackProject(root, { source: 'module.exports = "你好"\n' })
  const source = fs.readFileSync(path.join(root, 'src/app.js'))
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const https = require('https')
https.get('https://example.com/collect')
module.exports = {}
`)
  const result = run(['collect'], root)
  assert.strictEqual(result.status, 3)
  assert.match(result.stderr, /does not make network requests/)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'src/app.js')), source)
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/zh_hash.json')), false)
})

test('collect runs a function webpack configuration without scanning files outside the build', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-fn-'))
  writeWebpackProject(root, { source: 'const message = "你好"\nmodule.exports = message\n' })
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = function () {
  return {
    context: __dirname,
    mode: 'development',
    entry: './src/app.js',
    output: { filename: 'bundle.js', path: path.join(__dirname, 'dist') },
    module: { rules: [{ test: /\\.js$/, loader: ${JSON.stringify(loader)} }] },
    plugins: [new MyI18nPlugin()]
  }
}
`)
  const result = run(['collect', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.deepStrictEqual(values(root), ['你好'])
})

test('collect writes the dictionary configured on the webpack plugin', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-plugin-out-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src/app.js'), 'const message = "你好"\nmodule.exports = message\n')
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: 'development',
  entry: './src/app.js',
  module: { rules: [{ test: /\\.js$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin({ outputPath: 'out/zh.json', sourceMapFilename: 'out/zh.map.json' })]
}
`)
  const result = run(['collect', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.dictionary, 'out/zh.json')
  assert.strictEqual(report.sourceMap, 'out/zh.map.json')
  const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'out/zh.json'), 'utf8'))
  assert.deepStrictEqual(dictionary, { [HELLO]: '你好' })
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/zh_hash.json')), false)
})

