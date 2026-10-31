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
  const { catalog, ...report } = JSON.parse(result.stdout)
  assert.strictEqual(catalog.keys, 1)
  assert.strictEqual(catalog.added.length, 1)
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
  const { catalog: againCatalog, ...againReport } = JSON.parse(again.stdout)
  assert.deepStrictEqual(againReport, report)
  assert.deepStrictEqual(againCatalog.unchanged, catalog.added)
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
    'Catalog: lang/catalog/zh.json (1 key: 1 added, 0 removed, 0 changed, 0 unchanged)',
    'Catalog metadata: lang/catalog/catalog.meta.json',
    'Scope include: (all resources that enter the loader)',
    'Scope exclude: (none)',
    'Context filters: (none)',
    ''
  ].join('\n'))
})

test('an unknown command is a configuration failure', () => {
  const result = run(['publish'])
  assert.strictEqual(result.status, 1)
  assert.match(result.stderr, /configuration: unknown command "publish"/)
  assert.match(result.stdout, /Commands:/)
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

const DEFAULT_CONFIG_HASH = '0b45581a318d9c09078e6de75d2a4cc5'

function md5(value) {
  return require('crypto').createHash('md5').update(value, 'utf8').digest('hex')
}

function readJson(root, file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
}

function derivedKeyFor(catalog, source) {
  const keys = Object.keys(catalog).filter(key => catalog[key] === source && /^src\.app\.[0-9a-f]{8}$/.test(key))
  assert.strictEqual(keys.length, 1, `one derived key for ${source}`)
  return keys[0]
}

test('collect assigns independent automatic keys to identical text while the hash dictionary stays text-deduplicated', { timeout: 30000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-occurrence-keys-'))
  writeWebpackProject(root, {
    source: 'const a = "你好"\nconst b = "你好"\nmodule.exports = [a, b]\n'
  })
  const result = run(['collect', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)

  assert.deepStrictEqual(readJson(root, 'lang/zh_hash.json'), { [md5('你好')]: '你好' })
  const sourceMap = readJson(root, 'lang/zh_hash.map.json')
  assert.strictEqual(sourceMap.entries.length, 1)
  assert.strictEqual(sourceMap.entries[0].key, md5('你好'))
  assert.strictEqual(sourceMap.entries[0].value, '你好')
  assert.strictEqual(sourceMap.entries[0].locations.length, 2)

  const catalog = readJson(root, 'lang/catalog/zh.json')
  const keys = Object.keys(catalog).filter(key => catalog[key] === '你好')
  assert.strictEqual(keys.length, 2)
  assert.notStrictEqual(keys[0], keys[1])
  const metadata = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.deepStrictEqual(
    keys.map(key => metadata.entries[key].locations).flat().sort((a, b) => a.start.line - b.start.line),
    [
      { path: 'src/app.js', kind: 'script-string', start: { line: 1, column: 10 }, end: { line: 1, column: 14 } },
      { path: 'src/app.js', kind: 'script-string', start: { line: 2, column: 10 }, end: { line: 2, column: 14 } }
    ]
  )
  for (const key of keys) {
    assert.strictEqual(metadata.entries[key].origin, 'derived')
    assert.strictEqual(metadata.entries[key].locations.length, 1)
    assert.strictEqual(metadata.entries[key].occurrences.length, 1)
    assert.strictEqual(metadata.entries[key].occurrences[0].semanticHost, 'src/app.js::script')
    assert.strictEqual(metadata.entries[key].occurrences[0].childRole, 'script-string')
    assert.match(metadata.entries[key].occurrences[0].id, /^[0-9a-f]{16}$/)
  }
  assert.strictEqual(metadata.version, 2)
  const contexts = keys.map(key => metadata.entries[key].occurrences[0].localContext).sort()
  assert.deepStrictEqual(contexts, ['sibling:0', 'sibling:1'])
  assert.strictEqual(JSON.parse(result.stdout).catalog.keys, 2)
})

test('collect exports a keyed source catalog beside unchanged hash outputs and reports key changes', { timeout: 30000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-catalog-'))
  writeWebpackProject(root, {
    source: 'const title = /* i18n-key: home.title */ "首页"\nconst hello = "你好"\nmodule.exports = [title, hello]\n'
  })
  const first = run(['collect', '--json'], root)
  assert.strictEqual(first.status, 0, first.stderr)

  assert.deepStrictEqual(readJson(root, 'lang/zh_hash.json'), { [md5('你好')]: '你好', [md5('首页')]: '首页' })
  const sourceMap = readJson(root, 'lang/zh_hash.map.json')
  assert.deepStrictEqual(Object.keys(sourceMap), ['version', 'parserVersion', 'configHash', 'entries'])
  assert.strictEqual(sourceMap.configHash, DEFAULT_CONFIG_HASH)
  for (const entry of sourceMap.entries) assert.deepStrictEqual(Object.keys(entry), ['key', 'value', 'locations'])

  const catalog = readJson(root, 'lang/catalog/zh.json')
  const helloKey = derivedKeyFor(catalog, '你好')
  assert.deepStrictEqual(catalog, { [helloKey]: '你好', 'home.title': '首页' })
  const metadata = readJson(root, 'lang/catalog/catalog.meta.json')
  assert.strictEqual(metadata.version, 2)
  assert.strictEqual(metadata.sourceLocale, 'zh')
  assert.strictEqual(metadata.format, 'json')
  assert.strictEqual(metadata.entries['home.title'].origin, 'explicit')
  assert.strictEqual(metadata.entries[helloKey].origin, 'derived')
  assert.deepStrictEqual(metadata.entries['home.title'].locations, [{
    path: 'src/app.js',
    kind: 'script-string',
    start: { line: 1, column: 41 },
    end: { line: 1, column: 45 }
  }])
  assert.strictEqual(metadata.entries['home.title'].occurrences[0].semanticHost, 'src/app.js::script')
  assert.strictEqual(metadata.entries['home.title'].occurrences[0].childRole, 'script-string')
  assert.deepStrictEqual(metadata.entries['home.title'].occurrences[0].location, metadata.entries['home.title'].locations[0])

  assert.deepStrictEqual(JSON.parse(first.stdout).catalog, {
    format: 'json',
    keys: 2,
    messages: 'lang/catalog/zh.json',
    metadata: 'lang/catalog/catalog.meta.json',
    sourceLocale: 'zh',
    added: ['home.title', helloKey],
    removed: [],
    changed: [],
    unchanged: []
  })

  const catalogBytes = fs.readFileSync(path.join(root, 'lang/catalog/zh.json'))
  const metadataBytes = fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json'))
  const again = run(['collect', '--json'], root)
  assert.strictEqual(again.status, 0, again.stderr)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/zh.json')), catalogBytes)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/catalog.meta.json')), metadataBytes)
  assert.deepStrictEqual(JSON.parse(again.stdout).catalog.unchanged, ['home.title', helloKey])

  fs.writeFileSync(path.join(root, 'src/app.js'), '\n\nconst title = /* i18n-key: home.title */ "主页"\nconst hello = "您好"\nmodule.exports = [title, hello]\n')
  const edited = run(['collect', '--json'], root)
  assert.strictEqual(edited.status, 0, edited.stderr)
  const next = readJson(root, 'lang/catalog/zh.json')
  assert.strictEqual(next[helloKey], '您好')
  assert.strictEqual(derivedKeyFor(next, '您好'), helloKey)
  const report = JSON.parse(edited.stdout).catalog
  assert.deepStrictEqual(
    { added: report.added, removed: report.removed, changed: report.changed, unchanged: report.unchanged },
    { added: [], removed: [], changed: ['home.title', helloKey], unchanged: [] }
  )

  const human = run(['collect'], root)
  assert.strictEqual(human.status, 0, human.stderr)
  assert.match(human.stdout, /Catalog: lang\/catalog\/zh\.json \(2 keys: 0 added, 0 removed, 0 changed, 2 unchanged\)/)
  assert.match(human.stdout, /Catalog metadata: lang\/catalog\/catalog\.meta\.json/)
})

test('collect writes the catalog where the configuration puts it', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-catalog-config-'))
  writeWebpackProject(root, {
    source: 'module.exports = "你好"\n',
    configSource: 'module.exports = { catalogDir: "locales", sourceLocale: "zh-CN" }\n'
  })
  const result = run(['collect', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.deepStrictEqual(Object.values(readJson(root, 'locales/zh-CN.json')), ['你好'])
  assert.strictEqual(readJson(root, 'locales/catalog.meta.json').sourceLocale, 'zh-CN')
  assert.strictEqual(fs.existsSync(path.join(root, 'lang/catalog')), false)
  assert.strictEqual(readJson(root, 'lang/zh_hash.map.json').configHash, DEFAULT_CONFIG_HASH)

  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), 'module.exports = { catalogFormat: "yaml" }\n')
  const unknown = run(['collect'], root)
  assert.strictEqual(unknown.status, 1)
  assert.match(unknown.stderr, /configuration: .*catalogFormat/)
})

test('collect fails on a localization key conflict and keeps every previous output', { timeout: 30000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-conflict-'))
  writeWebpackProject(root, {
    source: 'require("./other")\nmodule.exports = /* i18n-key: shared.title */ "首页"\n',
    files: { 'src/other.js': 'module.exports = "其他"\n' }
  })
  const first = run(['collect'], root)
  assert.strictEqual(first.status, 0, first.stderr)
  const outputs = ['lang/zh_hash.json', 'lang/zh_hash.map.json', 'lang/catalog/zh.json', 'lang/catalog/catalog.meta.json']
  const before = outputs.map(file => fs.readFileSync(path.join(root, file)))

  fs.writeFileSync(path.join(root, 'src/other.js'), 'module.exports = /* i18n-key: shared.title */ "主页"\n')
  const conflict = run(['collect', '--json'], root)
  assert.strictEqual(conflict.status, 2, conflict.stderr)
  assert.strictEqual(JSON.parse(conflict.stdout).failure, 'collection')
  assert.match(conflict.stderr, /localization key conflict/)
  assert.match(conflict.stderr, /"shared\.title" names different source text/)
  assert.match(conflict.stderr, /"首页" \(explicit\) at src\/app\.js:2:\d+ \(script-string\)/)
  assert.match(conflict.stderr, /"主页" \(explicit\) at src\/other\.js:1:\d+ \(script-string\)/)
  outputs.forEach((file, index) => assert.deepStrictEqual(fs.readFileSync(path.join(root, file)), before[index]))

  fs.writeFileSync(path.join(root, 'src/other.js'), 'module.exports = /* i18n-key: Bad Key */ "主页"\n')
  const malformed = run(['collect'], root)
  assert.strictEqual(malformed.status, 2, malformed.stderr)
  assert.match(malformed.stderr, /i18n-collect failed for src\/other\.js, script, line 1, column 17: malformed i18n-key directive/)
  outputs.forEach((file, index) => assert.deepStrictEqual(fs.readFileSync(path.join(root, file)), before[index]))
})

test('collect refuses unsupported catalog metadata and keeps every previous output', { timeout: 30000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-collect-meta-schema-'))
  writeWebpackProject(root, {
    source: 'module.exports = "你好"\n'
  })
  const first = run(['collect'], root)
  assert.strictEqual(first.status, 0, first.stderr)
  const outputs = ['lang/zh_hash.json', 'lang/zh_hash.map.json', 'lang/catalog/zh.json', 'lang/catalog/catalog.meta.json']
  const before = Object.fromEntries(outputs.map(file => [file, fs.readFileSync(path.join(root, file))]))

  const metadata = JSON.parse(before['lang/catalog/catalog.meta.json'].toString('utf8'))
  metadata.version = 99
  fs.writeFileSync(path.join(root, 'lang/catalog/catalog.meta.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = "改写"\n')

  const refused = run(['collect', '--json'], root)
  assert.strictEqual(refused.status, 2, refused.stderr)
  assert.strictEqual(JSON.parse(refused.stdout).failure, 'collection')
  assert.match(refused.stderr, /cannot be upgraded to version 2/)
  assert.match(refused.stderr, /restore a version 1 or 2 catalog\.meta\.json/)
  for (const file of outputs) {
    if (file === 'lang/catalog/catalog.meta.json') {
      assert.strictEqual(readJson(root, file).version, 99)
      continue
    }
    assert.deepStrictEqual(fs.readFileSync(path.join(root, file)), before[file])
  }
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

