const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { scanCompleteStaticCopyPolicy } = require('../mycommon/complete-static-copy-policy')

const bin = path.join(__dirname, '../bin/i18n-collect.js')
const loader = require.resolve('../myloader')
const plugin = require.resolve('../myplugin')

const FORMAL = [
  'lang/zh_hash.json',
  'lang/zh_hash.map.json',
  'lang/catalog/zh.json',
  'lang/catalog/catalog.meta.json'
]

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function writeWebpackProject(root, { entry = './src/app.js', source, files = {}, configSource = '' } = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
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
}

function readFormal(root) {
  return Object.fromEntries(FORMAL.map(file => [file, fs.readFileSync(path.join(root, file))]))
}

test('verify help describes freshness, policy, and distinct failure categories', () => {
  const result = run(['verify', '--help'])
  assert.strictEqual(result.status, 0)
  assert.match(result.stdout, /i18n-collect verify/)
  assert.match(result.stdout, /formal/)
  assert.match(result.stdout, /check-policy|policy/)
  assert.match(result.stdout, /stale/)
  assert.match(result.stdout, /baseline/)
  assert.match(result.stdout, /collection failure/)
  assert.match(result.stdout, /--json/)
})

test('verify passes on a clean worktree after a successful collect', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-verify-clean-'))
  writeWebpackProject(root, { source: 'module.exports = "你好"\n' })
  const collected = run(['collect'], root)
  assert.strictEqual(collected.status, 0, collected.stderr)
  const before = readFormal(root)

  const result = run(['verify', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.command, 'verify')
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.failure, undefined)
  for (const file of FORMAL) {
    assert.deepStrictEqual(fs.readFileSync(path.join(root, file)), before[file])
  }
})

test('verify fails as stale when formal outputs would change and restores committed bytes', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-verify-stale-'))
  writeWebpackProject(root, { source: 'module.exports = "你好"\n' })
  const collected = run(['collect'], root)
  assert.strictEqual(collected.status, 0, collected.stderr)
  const before = readFormal(root)

  fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = "你好世界"\n')
  const result = run(['verify', '--json'], root)
  assert.strictEqual(result.status, 9, result.stderr)
  assert.match(result.stderr, /^stale:/m)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.strictEqual(report.failure, 'stale')
  assert.ok(Array.isArray(report.changed) && report.changed.length > 0)
  for (const file of FORMAL) {
    assert.deepStrictEqual(fs.readFileSync(path.join(root, file)), before[file], file)
  }
})

test('verify fails as policy for a newly introduced violation without rewriting formal outputs', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-verify-policy-'))
  writeWebpackProject(root, {
    source: 'module.exports = "完整静态"\n',
    files: { 'src/policy.js': 'const split = "你" + name + "好"\n' }
  })
  const collected = run(['collect'], root)
  assert.strictEqual(collected.status, 0, collected.stderr)
  const before = readFormal(root)

  const result = run(['verify'], root)
  assert.strictEqual(result.status, 8, result.stderr)
  assert.match(result.stderr, /^policy:/m)
  assert.match(result.stderr, /concatenation/)
  for (const file of FORMAL) {
    assert.deepStrictEqual(fs.readFileSync(path.join(root, file)), before[file], file)
  }
})

test('verify passes when complete-static-copy violations are exactly grandfathered', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-verify-base-'))
  const policySource = 'const split = "你" + name + "好"\n'
  const violations = scanCompleteStaticCopyPolicy([{ path: 'src/policy.js', source: policySource }])
  writeWebpackProject(root, {
    source: 'module.exports = "完整静态"\n',
    files: {
      'src/policy.js': policySource,
      'lang/catalog/complete-static-copy-baseline.json': `${JSON.stringify({ version: 1, violations }, null, 2)}\n`
    }
  })
  const collected = run(['collect'], root)
  assert.strictEqual(collected.status, 0, collected.stderr)

  const result = run(['verify', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.ok(report.policy.grandfathered >= 1)
})

test('verify keeps collection failures hard even when a policy baseline is present', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-verify-hard-'))
  writeWebpackProject(root, {
    source: 'require("./other")\nmodule.exports = /* i18n-key: shared.title */ "首页"\n',
    files: {
      'src/other.js': 'module.exports = "其他"\n',
      'lang/catalog/complete-static-copy-baseline.json': `${JSON.stringify({
        version: 1,
        violations: [{
          reason: 'concatenation',
          path: 'src/ignored.js',
          kind: 'script-string',
          start: { line: 1, column: 0 },
          end: { line: 1, column: 1 },
          text: '你'
        }]
      }, null, 2)}\n`
    }
  })
  const collected = run(['collect'], root)
  assert.strictEqual(collected.status, 0, collected.stderr)
  const before = readFormal(root)

  fs.writeFileSync(path.join(root, 'src/other.js'), 'module.exports = /* i18n-key: shared.title */ "主页"\n')
  const result = run(['verify', '--json'], root)
  assert.strictEqual(result.status, 2, result.stderr)
  assert.match(result.stderr, /^collection:/m)
  assert.match(result.stderr, /localization key conflict/)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.strictEqual(report.failure, 'collection')
  for (const file of FORMAL) {
    assert.deepStrictEqual(fs.readFileSync(path.join(root, file)), before[file], file)
  }
})
