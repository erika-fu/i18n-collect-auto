const assert = require('assert')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { ReplacementPlanner } = require('../mycommon/replacement-planner')
const { transformBuildReplacement } = require('../mycommon/build-replace')
const { extractScript } = require('../myloader/extract-script')
const { installVue2 } = require('./vue2-fixture')
const { installVue3 } = require('./vue3-fixture')
const { keyForSource, seedSourceCatalog } = require('./build-test-helpers')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')
const vue3DemoRoot = path.resolve(__dirname, '../../../apps/vue3-demo')
const vueLoaderPath = require.resolve('vue-loader', { paths: [vue3DemoRoot] })
const vueLoaderCompilerPath = require.resolve('vue-loader/dist/compiler', { paths: [vue3DemoRoot] })
const vuePath = require.resolve('vue', { paths: [vue3DemoRoot] })
const vueI18nPath = require.resolve('vue-i18n', { paths: [vue3DemoRoot] })
const compilerSfcPath = require.resolve('@vue/compiler-sfc')
const vue2LoaderPath = require.resolve('@vue/vue-loader-v15')
const vue2Path = require.resolve('vue')
const vue2I18nPath = require.resolve('vue-i18n')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function md5(value) {
  return crypto.createHash('md5').update(value, 'utf8').digest('hex')
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
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
  return new Map(projectFiles(root).map(file => {
    const stat = fs.statSync(file)
    return [file, { content: fs.readFileSync(file), mtimeMs: stat.mtimeMs }]
  }))
}

function assertUnchanged(before, root, ignore = []) {
  const ignored = new Set(ignore.map(file => path.resolve(root, file)))
  const after = snapshotFiles(root)
  for (const [file, entry] of before) {
    if (ignored.has(file) || file.startsWith(path.join(root, 'dist')) || file.startsWith(path.join(root, 'lang'))) {
      continue
    }
    assert.ok(after.has(file), `missing ${file}`)
    const next = after.get(file)
    const contents = entry.content || entry
    const mtimeMs = entry.mtimeMs
    assert.deepStrictEqual(next.content, contents, `changed ${path.relative(root, file)}`)
    if (mtimeMs != null) {
      assert.strictEqual(next.mtimeMs, mtimeMs, `mtime changed ${path.relative(root, file)}`)
    }
  }
}

function writeProxyPackage(root, name, version, entry) {
  const packageRoot = path.join(root, 'node_modules', ...name.split('/'))
  fs.mkdirSync(packageRoot, { recursive: true })
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
    name,
    version,
    main: 'index.js'
  }))
  fs.writeFileSync(
    path.join(packageRoot, 'index.js'),
    `module.exports = require(${JSON.stringify(entry)})\n`
  )
}

function writeJsProject(root, {
  source = [
    "const { t } = require('./i18n')",
    "module.exports = function label() { return '你好' }",
    ''
  ].join('\n'),
  files = {}
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
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'dual-mode-js',
    private: true
  }, null, 2))
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), [
    'module.exports = {',
    '  buildReplacement: {',
    '    enabled: true,',
    '    adapter: "js",',
    '    runtimeModule: "src/i18n.js",',
    '    runtimeExport: "t"',
    '  }',
    '}',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const MyI18nPlugin = require(${JSON.stringify(plugin)})
module.exports = {
  context: __dirname,
  mode: 'development',
  devtool: false,
  entry: './src/app.js',
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  module: { rules: [{ test: /\\.[cm]?[jt]sx?$/, loader: ${JSON.stringify(loader)} }] },
  plugins: [new MyI18nPlugin()]
}
`)
}

function catalogKeyFor(root, source) {
  const sourceCatalogPath = path.join(root, 'lang/catalog/source-catalog.json')
  if (fs.existsSync(sourceCatalogPath)) {
    return keyForSource(root, source)
  }
  const metadata = readJson(root, 'lang/catalog/catalog.meta.json')
  const key = Object.keys(metadata.entries).find(name => metadata.entries[name].source === source)
  assert.ok(key, `missing catalog key for ${source}`)
  return key
}

function occurrenceFromSource(key, text, containingSource, projectPath = 'src/app.js') {
  const extracted = extractScript({
    source: containingSource,
    resource: { projectPath },
    config: {}
  }).find(entry => entry.value === text)
  assert.ok(extracted, `missing occurrence for ${text}`)
  return {
    key,
    source: text,
    location: {
      path: projectPath,
      kind: extracted.locations[0].kind,
      start: extracted.locations[0].start,
      end: extracted.locations[0].end
    }
  }
}

test('CLI preview and Build replacement choose the same adapter call for one occurrence', () => {
  const source = [
    "const { t } = require('./i18n')",
    "module.exports = function label() { return '你好' }",
    ''
  ].join('\n')
  const item = occurrenceFromSource('home.hello', '你好', source)
  const planner = new ReplacementPlanner({
    adapter: 'js',
    runtime: { localizationFunction: true, helperName: 't', helperAvailable: true }
  })
  const planned = planner.plan({
    occurrences: [item],
    resources: new Map([['src/app.js', source]])
  })
  const built = transformBuildReplacement({
    source,
    root: '/project',
    projectPath: 'src/app.js',
    resourcePath: path.join('/project', 'src/app.js'),
    occurrences: [item],
    adapter: 'js',
    runtimeModule: 'src/i18n.js',
    runtimeExport: 't',
    styleExtensions: []
  })

  assert.strictEqual(planned.replacements.length, 1)
  assert.strictEqual(planned.replacements[0].call, "t('home.hello')")
  assert.strictEqual(built.planned.replacements[0].call, planned.replacements[0].call)
  assert.deepStrictEqual(
    built.planned.edits.map(edit => ({ start: edit.start, end: edit.end, text: edit.text })),
    planned.edits.map(edit => ({ start: edit.start, end: edit.end, text: edit.text }))
  )
  assert.match(built.code, /t\('home\.hello'\)/)
})

test('after Build replacement, Source replacement preview matches the pre-build preview', { timeout: 120000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dual-build-first-'))
  const source = [
    "const { t } = require('./i18n')",
    "module.exports = function label() { return '你好' }",
    ''
  ].join('\n')
  writeJsProject(root, { source })

  seedSourceCatalog(root)
  const previewBefore = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(previewBefore.status, 0, previewBefore.stderr)
  const before = JSON.parse(previewBefore.stdout)
  assert.strictEqual(before.replacements.length, 1)
  const key = before.replacements[0].key
  const call = before.replacements[0].call
  const previewContent = before.previews[0].content

  const diskBeforeBuild = snapshotFiles(root)
  const build = run(['build', '--json'], root)
  assert.strictEqual(build.status, 0, build.stderr)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/replacements.json')))
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), source)
  assertUnchanged(diskBeforeBuild, root)

  const previewAfter = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(previewAfter.status, 0, previewAfter.stderr)
  const after = JSON.parse(previewAfter.stdout)
  assert.strictEqual(after.dryRun, true)
  assert.strictEqual(after.written, false)
  assert.strictEqual(after.replacements.length, 1)
  assert.strictEqual(after.replacements[0].key, key)
  assert.strictEqual(after.replacements[0].call, call)
  assert.strictEqual(after.replacements[0].source, '你好')
  assert.strictEqual(after.previews[0].content, previewContent)
  assert.strictEqual(catalogKeyFor(root, '你好'), key)

  const write = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(write.status, 0, write.stderr)
  const written = JSON.parse(write.stdout)
  assert.strictEqual(written.written, true)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), previewContent)
  assert.ok(fs.existsSync(path.join(root, 'lang/catalog/replacements.json')))
  assert.strictEqual(readJson(root, 'lang/catalog/replacements.json').replacements[0].call, call)
})

test('after replace --write, Build replacement keeps localized calls and leaves metadata untouched', { timeout: 120000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dual-replace-first-'))
  const source = [
    "const { t } = require('./i18n')",
    "module.exports = function label() { return '你好' }",
    ''
  ].join('\n')
  writeJsProject(root, { source })

  seedSourceCatalog(root)
  const key = catalogKeyFor(root, '你好')
  const write = run(['replace', '--adapter', 'js', '--write', '--json'], root)
  assert.strictEqual(write.status, 0, write.stderr)
  const replaced = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8')
  assert.match(replaced, new RegExp(`t\\('${key.replace(/\./g, '\\.')}'\\)`))
  assert.doesNotMatch(replaced, /你好/)
  const metadataBefore = fs.readFileSync(path.join(root, 'lang/catalog/replacements.json'))
  seedSourceCatalog(root)

  const build = run(['build', '--json'], root)
  assert.strictEqual(build.status, 0, build.stderr)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/replacements.json')), metadataBefore)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), replaced)

  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(bundle, new RegExp(key.replace(/\./g, '\\.')))
  assert.doesNotMatch(bundle, /t\(t\(|你好/)
})

test('mixed localized-call and source-text occurrences keep separate identities under Build replacement', { timeout: 120000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dual-mixed-'))
  const source = [
    "const { t } = require('./i18n')",
    "const migrated = '已迁移'",
    "const pending = '待迁移'",
    'module.exports = { migrated, pending }',
    ''
  ].join('\n')
  writeJsProject(root, { source })

  seedSourceCatalog(root)
  const migratedKey = catalogKeyFor(root, '已迁移')
  const pendingKey = catalogKeyFor(root, '待迁移')
  assert.notStrictEqual(migratedKey, pendingKey)

  const mixed = [
    "const { t } = require('./i18n')",
    `const migrated = t('${migratedKey}')`,
    "const pending = '待迁移'",
    'module.exports = { migrated, pending }',
    ''
  ].join('\n')
  fs.writeFileSync(path.join(root, 'src/app.js'), mixed)
  fs.writeFileSync(path.join(root, 'lang/catalog/replacements.json'), `${JSON.stringify({
    version: 1,
    adapter: 'js',
    replacements: [{
      path: 'src/app.js',
      key: migratedKey,
      kind: 'script-string',
      source: '已迁移',
      call: `t('${migratedKey}')`,
      start: { line: 2, column: 17 },
      end: { line: 2, column: 21 }
    }]
  }, null, 2)}\n`)
  const recordedBytes = fs.readFileSync(path.join(root, 'lang/catalog/replacements.json'))
  seedSourceCatalog(root)

  const build = run(['build', '--json'], root)
  assert.strictEqual(build.status, 0, build.stderr)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), mixed)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/replacements.json')), recordedBytes)

  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(bundle, new RegExp(migratedKey.replace(/\./g, '\\.')))
  assert.match(bundle, new RegExp(pendingKey.replace(/\./g, '\\.')))
  assert.doesNotMatch(bundle, /待迁移/)
  assert.doesNotMatch(bundle, /t\(t\(/)

  const preview = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const report = JSON.parse(preview.stdout)
  assert.strictEqual(report.replacements.length, 1)
  assert.strictEqual(report.replacements[0].key, pendingKey)
  assert.strictEqual(report.replacements[0].call, `t('${pendingKey}')`)
  assert.ok(report.recognized.some(item => item.key === migratedKey && item.call === `t('${migratedKey}')`))
})

test('projects with existing replacement metadata can enable Build replacement without rebuilding history', { timeout: 120000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dual-upgrade-'))
  const source = [
    "const { t } = require('./i18n')",
    "module.exports = function label() { return '你好' }",
    ''
  ].join('\n')
  writeJsProject(root, { source })
  seedSourceCatalog(root)
  const key = catalogKeyFor(root, '你好')
  const recorded = {
    version: 1,
    adapter: 'js',
    replacements: [{
      path: 'src/notes.js',
      key: 'home.notes',
      kind: 'script-string',
      source: '备注',
      call: "t('home.notes')",
      start: { line: 1, column: 0 },
      end: { line: 1, column: 4 }
    }]
  }
  fs.writeFileSync(path.join(root, 'lang/catalog/replacements.json'), `${JSON.stringify(recorded, null, 2)}\n`)
  const recordedBytes = fs.readFileSync(path.join(root, 'lang/catalog/replacements.json'))
  seedSourceCatalog(root)

  const build = run(['build', '--json'], root)
  assert.strictEqual(build.status, 0, build.stderr)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/replacements.json')), recordedBytes)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), source)
  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(bundle, new RegExp(key.replace(/\./g, '\\.')))
  assert.doesNotMatch(bundle, /你好/)
})

test('legacy MD5 localization calls stay outside keyed Build replacement', { timeout: 120000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dual-md5-'))
  const hash = md5('旧文案')
  const source = [
    "const { t } = require('./i18n')",
    `const legacy = t('${hash}')`,
    "const fresh = '你好'",
    'module.exports = { legacy, fresh }',
    ''
  ].join('\n')
  writeJsProject(root, { source })
  const catalog = seedSourceCatalog(root)
  assert.ok(!catalog[hash], 'MD5 call must not become a keyed catalog entry')

  const build = run(['build', '--json'], root)
  assert.strictEqual(build.status, 0, build.stderr)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), source)

  const freshKey = catalogKeyFor(root, '你好')
  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(bundle, new RegExp(hash))
  assert.match(bundle, new RegExp(freshKey.replace(/\./g, '\\.')))
  assert.doesNotMatch(bundle, /你好/)
  assert.doesNotMatch(bundle, new RegExp(`t\\(t\\('${hash}'\\)\\)`))
})

test('identical Chinese text shares one automatic key while an explicit shared key stays shared', { timeout: 120000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dual-keys-'))
  const source = [
    "const { t } = require('./i18n')",
    "const first = '重复文案'",
    "const second = '重复文案'",
    "const shared = /* i18n-key: home.shared */ '共享文案'",
    "const sharedAgain = /* i18n-key: home.shared */ '共享文案'",
    'module.exports = { first, second, shared, sharedAgain }',
    ''
  ].join('\n')
  writeJsProject(root, { source })
  const catalog = seedSourceCatalog(root)
  const duplicateKeys = Object.keys(catalog).filter(name => catalog[name] === '重复文案')
  assert.strictEqual(duplicateKeys.length, 1)
  assert.strictEqual(catalog['home.shared'], '共享文案')

  const build = run(['build', '--json'], root)
  assert.strictEqual(build.status, 0, build.stderr)

  const preview = run(['replace', '--adapter', 'js', '--json'], root)
  assert.strictEqual(preview.status, 0, preview.stderr)
  const report = JSON.parse(preview.stdout)
  const calls = report.replacements.map(item => item.call).sort()
  assert.deepStrictEqual(calls, [
    `t('${duplicateKeys[0]}')`,
    `t('${duplicateKeys[0]}')`,
    "t('home.shared')",
    "t('home.shared')"
  ].sort())

  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  for (const key of [...duplicateKeys, 'home.shared']) {
    assert.match(bundle, new RegExp(key.replace(/\./g, '\\.')))
  }
  assert.doesNotMatch(bundle, /重复文案|共享文案/)
})

test('repeated Build replacement stays idempotent on disk and does not nest calls', { timeout: 120000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dual-repeat-'))
  const source = [
    "const { t } = require('./i18n')",
    "module.exports = function label() { return '你好' }",
    ''
  ].join('\n')
  writeJsProject(root, { source })
  seedSourceCatalog(root)

  const first = run(['build', '--json'], root)
  assert.strictEqual(first.status, 0, first.stderr)
  const key = catalogKeyFor(root, '你好')
  const catalogAfterFirst = fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json'))
  const sourceAfterFirst = fs.readFileSync(path.join(root, 'src/app.js'))
  assert.strictEqual(sourceAfterFirst.toString(), source)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/replacements.json')))
  const bundleFirst = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(bundleFirst, new RegExp(key.replace(/\./g, '\\.')))

  const second = run(['build', '--json'], root)
  assert.strictEqual(second.status, 0, second.stderr)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'src/app.js')), sourceAfterFirst)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json')), catalogAfterFirst)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/replacements.json')))
  const bundleSecond = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(bundleSecond, new RegExp(key.replace(/\./g, '\\.')))
  assert.doesNotMatch(bundleSecond, /t\(t\(|你好/)
})

test('stale committed source catalog fails Build replacement closed', { timeout: 120000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dual-stale-'))
  writeJsProject(root, {
    source: [
      "const { t } = require('./i18n')",
      "const temporary = '临时文案'",
      "module.exports = function label() { return '你好' }",
      ''
    ].join('\n')
  })
  seedSourceCatalog(root)
  const catalogBefore = fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json'))
  fs.writeFileSync(path.join(root, 'src/app.js'), [
    "const { t } = require('./i18n')",
    "module.exports = function label() { return '你好' }",
    ''
  ].join('\n'))

  const build = run(['build', '--json'], root)
  assert.strictEqual(build.status, 2, build.stderr)
  const body = JSON.parse(build.stdout)
  assert.strictEqual(body.stage, 'analysis')
  assert.match(build.stderr, /source catalog|no longer matches|scan/i)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/source-catalog.json')), catalogBefore)
})

function writeVue3DualProject(root, vueSource) {
  installVue3(root)
  writeProxyPackage(root, 'vue', '3.5.42', vuePath)
  writeProxyPackage(root, 'vue-i18n', '9.14.5', vueI18nPath)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'vue3-dual-fixture',
    private: true,
    dependencies: { vue: '3.5.42', 'vue-i18n': '9.14.5' }
  }, null, 2))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/Home.vue'), vueSource)
  fs.writeFileSync(path.join(root, 'src/i18n.js'), 'export function t(key) { return key }\n')
  fs.writeFileSync(path.join(root, 'src/main.js'), [
    "import { createApp } from 'vue'",
    "import { createI18n } from 'vue-i18n'",
    "import Home from './Home.vue'",
    'const i18n = createI18n({ legacy: false, locale: "zh", messages: { zh: {} } })',
    'createApp(Home).use(i18n).mount("#app")',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), [
    'module.exports = {',
    '  buildReplacement: {',
    '    enabled: true,',
    '    adapter: "vue3",',
    '    runtimeModule: "src/i18n.js",',
    '    runtimeExport: "t"',
    '  }',
    '}',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const vueLoaderCompiler = require(${JSON.stringify(vueLoaderCompilerPath)})
vueLoaderCompiler.compiler = require(${JSON.stringify(compilerSfcPath)})
const { VueLoaderPlugin } = require(${JSON.stringify(vueLoaderPath)})
const MyI18nPlugin = require(${JSON.stringify(plugin)})
const collector = ${JSON.stringify(loader)}
module.exports = {
  context: __dirname,
  mode: 'development',
  devtool: false,
  entry: './src/main.js',
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  resolve: { extensions: ['.js', '.vue'] },
  module: {
    rules: [
      { test: /\\.vue$/, loader: ${JSON.stringify(vueLoaderPath)} },
      { test: /\\.m?js$/, exclude: /node_modules/, use: [collector] },
      { test: /\\.vue$/, resourceQuery: /type=template/, use: [collector] },
      { test: /\\.vue$/, resourceQuery: /type=script/, use: [collector] }
    ]
  },
  plugins: [new VueLoaderPlugin(), new MyI18nPlugin()]
}
`)
}

function writeVue2DualProject(root, vueSource) {
  const vueVersion = require('vue/package.json').version
  const vueI18nVersion = require('vue-i18n/package.json').version
  installVue2(root)
  writeProxyPackage(root, 'vue', vueVersion, vue2Path)
  writeProxyPackage(root, 'vue-i18n', vueI18nVersion, vue2I18nPath)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'vue2-dual-fixture',
    private: true,
    dependencies: { vue: vueVersion, 'vue-i18n': vueI18nVersion }
  }, null, 2))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/Home.vue'), vueSource)
  fs.writeFileSync(path.join(root, 'src/i18n.js'), 'export function t(key) { return key }\n')
  fs.writeFileSync(path.join(root, 'src/main.js'), [
    "import Vue from 'vue'",
    "import VueI18n from 'vue-i18n'",
    "import Home from './Home.vue'",
    'Vue.use(VueI18n)',
    'const i18n = new VueI18n({ locale: "zh", messages: { zh: {} } })',
    'new Vue({ i18n, render: h => h(Home) }).$mount("#app")',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'i18n-collect.config.js'), [
    'module.exports = {',
    '  buildReplacement: {',
    '    enabled: true,',
    '    adapter: "vue2",',
    '    runtimeModule: "src/i18n.js",',
    '    runtimeExport: "t"',
    '  }',
    '}',
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(root, 'webpack.config.js'), `const path = require('path')
const { VueLoaderPlugin } = require(${JSON.stringify(vue2LoaderPath)})
const MyI18nPlugin = require(${JSON.stringify(plugin)})
const collector = ${JSON.stringify(loader)}
module.exports = {
  context: __dirname,
  mode: 'development',
  devtool: false,
  entry: './src/main.js',
  output: { filename: 'bundle.js', path: path.join(__dirname, 'dist'), clean: true },
  resolve: {
    extensions: ['.js', '.vue'],
    alias: { vue$: ${JSON.stringify(require.resolve('vue/dist/vue.esm.js'))} }
  },
  module: {
    rules: [
      { test: /\\.vue$/, loader: ${JSON.stringify(vue2LoaderPath)} },
      { test: /\\.m?js$/, exclude: /node_modules/, use: [collector] },
      { test: /\\.vue$/, resourceQuery: /type=template/, use: [collector] },
      { test: /\\.vue$/, resourceQuery: /type=script/, use: [collector] }
    ]
  },
  plugins: [new VueLoaderPlugin(), new MyI18nPlugin()]
}
`)
}

test('Vue 3 build-then-replace and replace-then-build keep the same keys without nesting', { timeout: 180000 }, () => {
  const source = [
    '<template>',
    '  <p>欢迎</p>',
    '</template>',
    '<script setup>',
    "import { t } from './i18n.js'",
    "const tip = '说明'",
    '</script>',
    ''
  ].join('\n')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dual-vue3-'))
  writeVue3DualProject(root, source)

  seedSourceCatalog(root)
  const welcomeKey = catalogKeyFor(root, '欢迎')
  const tipKey = catalogKeyFor(root, '说明')
  const previewBefore = run(['replace', '--adapter', 'vue3', '--json'], root)
  assert.strictEqual(previewBefore.status, 0, previewBefore.stderr)
  const before = JSON.parse(previewBefore.stdout)
  assert.strictEqual(before.replacements.length, 2)

  seedSourceCatalog(root)
  const build = run(['build', '--json'], root)
  assert.strictEqual(build.status, 0, build.stderr)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), source)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/replacements.json')))
  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(bundle, new RegExp(welcomeKey.replace(/\./g, '\\.')))
  assert.match(bundle, new RegExp(tipKey.replace(/\./g, '\\.')))

  const previewAfter = run(['replace', '--adapter', 'vue3', '--json'], root)
  assert.strictEqual(previewAfter.status, 0, previewAfter.stderr)
  const after = JSON.parse(previewAfter.stdout)
  assert.deepStrictEqual(
    after.replacements.map(item => item.call).sort(),
    before.replacements.map(item => item.call).sort()
  )

  const write = run(['replace', '--adapter', 'vue3', '--write', '--json'], root)
  assert.strictEqual(write.status, 0, write.stderr)
  const replaced = fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8')
  assert.match(replaced, new RegExp(`\\$t\\('${welcomeKey.replace(/\./g, '\\.')}'\\)`))
  assert.match(replaced, new RegExp(`t\\('${tipKey.replace(/\./g, '\\.')}'\\)`))
  const recorded = fs.readFileSync(path.join(root, 'lang/catalog/replacements.json'))

  seedSourceCatalog(root)
  const rebuild = run(['build', '--json'], root)
  assert.strictEqual(rebuild.status, 0, rebuild.stderr)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), replaced)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/replacements.json')), recorded)
  const rebuilt = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8')
  assert.match(rebuilt, new RegExp(welcomeKey.replace(/\./g, '\\.')))
  assert.match(rebuilt, new RegExp(tipKey.replace(/\./g, '\\.')))
  assert.doesNotMatch(rebuilt, /\$t\(\$t\(|t\(t\(/)
})

test('Vue 2 build-then-replace and replace-then-build keep the same keys without nesting', { timeout: 180000 }, () => {
  const source = [
    '<template>',
    '  <p>欢迎</p>',
    '</template>',
    '<script>',
    'export default {',
    '  methods: {',
    "    greet() { return '你好' }",
    '  }',
    '}',
    '</script>',
    ''
  ].join('\n')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dual-vue2-'))
  writeVue2DualProject(root, source)

  seedSourceCatalog(root)
  const welcomeKey = catalogKeyFor(root, '欢迎')
  const helloKey = catalogKeyFor(root, '你好')
  const previewBefore = run(['replace', '--adapter', 'vue2', '--json'], root)
  assert.strictEqual(previewBefore.status, 0, previewBefore.stderr)
  const before = JSON.parse(previewBefore.stdout)

  seedSourceCatalog(root)
  const build = run(['build', '--json'], root)
  assert.strictEqual(build.status, 0, build.stderr)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), source)
  assert.ok(!fs.existsSync(path.join(root, 'lang/catalog/replacements.json')))

  const previewAfter = run(['replace', '--adapter', 'vue2', '--json'], root)
  assert.strictEqual(previewAfter.status, 0, previewAfter.stderr)
  const after = JSON.parse(previewAfter.stdout)
  assert.deepStrictEqual(
    after.replacements.map(item => item.call).sort(),
    before.replacements.map(item => item.call).sort()
  )

  const write = run(['replace', '--adapter', 'vue2', '--write', '--json'], root)
  assert.strictEqual(write.status, 0, write.stderr)
  const replaced = fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8')
  assert.match(replaced, new RegExp(`\\$t\\('${welcomeKey.replace(/\./g, '\\.')}'\\)`))
  assert.match(replaced, new RegExp(`this\\.\\$t\\('${helloKey.replace(/\./g, '\\.')}'\\)`))
  const recorded = fs.readFileSync(path.join(root, 'lang/catalog/replacements.json'))

  seedSourceCatalog(root)
  const rebuild = run(['build', '--json'], root)
  assert.strictEqual(rebuild.status, 0, rebuild.stderr)
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/Home.vue'), 'utf8'), replaced)
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'lang/catalog/replacements.json')), recorded)
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8'), /\$t\(\$t\(|this\.\$t\(this\.\$t\(/)
})
