const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { CHECK_POLICY_REMOVED } = require('../mycommon/legacy-contraction')
const { evaluateHybridPolicy } = require('../mycommon/evaluate-hybrid-policy')
const { loadConfig } = require('../mycommon/config')
const { installVue2 } = require('./vue2-fixture')

const bin = path.join(__dirname, '../bin/i18n-collect.js')

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  })
}

function writeProject(root, { source, baseline, files = {} } = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'lang', 'catalog'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/app.js'), source)
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
  if (Object.keys(files).some(name => name.endsWith('.vue'))) installVue2(root)
  if (baseline) {
    fs.writeFileSync(
      path.join(root, 'lang/catalog/complete-static-copy-baseline.json'),
      `${JSON.stringify(baseline, null, 2)}\n`
    )
  }
}

function sourcesFrom(root) {
  const config = loadConfig({ root })
  const files = []
  const visit = directory => {
    for (const name of fs.readdirSync(directory)) {
      const absolute = path.join(directory, name)
      if (fs.statSync(absolute).isDirectory()) {
        if (name === 'node_modules' || name === 'lang') continue
        visit(absolute)
        continue
      }
      if (!/\.(js|jsx|vue)$/.test(name)) continue
      files.push({
        path: path.relative(root, absolute).split(path.sep).join('/'),
        absolutePath: absolute,
        source: fs.readFileSync(absolute, 'utf8')
      })
    }
  }
  visit(root)
  return { config, sources: files.sort((a, b) => a.path.localeCompare(b.path)) }
}

test('check-policy help and invocation migrate to check', () => {
  const help = run(['check-policy', '--help'])
  assert.strictEqual(help.status, 0)
  assert.match(help.stdout, /i18n-collect check-policy/)
  assert.match(help.stdout, /Removed/i)
  assert.match(help.stdout, /i18n-collect check/)

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-policy-gone-'))
  const result = run(['check-policy', '--json'], root)
  assert.strictEqual(result.status, 1, result.stderr)
  assert.match(result.stderr, /check-policy is removed/i)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.message, CHECK_POLICY_REMOVED)
})

test('check CLI fails closed for a runtime-multilingual boundary violation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-cli-boundary-'))
  writeProject(root, {
    source: 'const ok = "完整静态"\n',
    files: {
      'src/pages/multilingual/Page.vue': '<template><p>边界内中文</p></template>\n',
      'lang/catalog/runtime-multilingual-boundaries.json': `${JSON.stringify({
        version: 1,
        boundaries: [{ id: 'demo-multilingual', include: ['src/pages/multilingual'] }]
      }, null, 2)}\n`,
      'lang/catalog/source-catalog.json': '{}\n'
    }
  })
  const before = snapshotTree(root)
  const result = run(['check', '--json'], root)
  assert.notStrictEqual(result.status, 0, result.stdout)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, false)
  assert.ok(report.blocking.includes('runtime-multilingual-policy'))
  assert.ok(report.policy.runtimeMultilingualViolations.some(item => item.text === '边界内中文'))
  assert.deepStrictEqual(snapshotTree(root), before)
})

function snapshotTree(root) {
  const out = new Map()
  const visit = directory => {
    if (!fs.existsSync(directory)) return
    for (const name of fs.readdirSync(directory)) {
      const absolute = path.join(directory, name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      const stat = fs.statSync(absolute)
      if (stat.isDirectory()) {
        visit(absolute)
        continue
      }
      if (stat.isFile()) out.set(relative, fs.readFileSync(absolute))
    }
  }
  visit(root)
  return out
}
test('hybrid policy hard-fails direct literals inside a runtime-multilingual boundary', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-policy-boundary-'))
  writeProject(root, {
    source: 'const ok = "完整静态"\n',
    files: {
      'src/pages/multilingual/Page.vue': '<template><p>边界内中文</p></template>\n',
      'lang/catalog/runtime-multilingual-boundaries.json': `${JSON.stringify({
        version: 1,
        boundaries: [{ id: 'demo-multilingual', include: ['src/pages/multilingual'] }]
      }, null, 2)}\n`
    }
  })
  const { config, sources } = sourcesFrom(root)
  const policy = evaluateHybridPolicy({ sources, config })
  assert.strictEqual(policy.ok, false)
  assert.ok(policy.runtimeMultilingualViolations.some(item => (
    item.path === 'src/pages/multilingual/Page.vue'
    && item.reason === 'runtime-multilingual-literal'
    && item.text === '边界内中文'
  )))
})

test('hybrid policy does not grandfather runtime-multilingual literals via complete-static-copy baseline', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-policy-boundary-base-'))
  const source = 'const title = "边界内中文"\n'
  writeProject(root, {
    source,
    files: {
      'lang/catalog/runtime-multilingual-boundaries.json': `${JSON.stringify({
        version: 1,
        boundaries: [{ id: 'demo-multilingual', include: ['src'] }]
      }, null, 2)}\n`
    },
    baseline: {
      version: 1,
      violations: [{
        reason: 'runtime-multilingual-literal',
        path: 'src/app.js',
        kind: 'script-string',
        start: { line: 1, column: 15 },
        end: { line: 1, column: 21 },
        text: '边界内中文'
      }]
    }
  })
  const { config, sources } = sourcesFrom(root)
  const policy = evaluateHybridPolicy({ sources, config })
  assert.strictEqual(policy.ok, false)
  assert.ok(policy.runtimeMultilingualViolations.some(item => item.text === '边界内中文'))
})

test('hybrid policy keeps automatic-collection areas outside boundaries clean when only complete static copy is present', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-policy-outside-boundary-'))
  writeProject(root, {
    source: 'const ok = "完整静态"\n',
    files: {
      'lang/catalog/runtime-multilingual-boundaries.json': `${JSON.stringify({
        version: 1,
        boundaries: [{ id: 'demo-multilingual', include: ['src/pages/multilingual'] }]
      }, null, 2)}\n`
    }
  })
  const { config, sources } = sourcesFrom(root)
  const policy = evaluateHybridPolicy({ sources, config })
  assert.strictEqual(policy.ok, true)
  assert.deepStrictEqual(policy.runtimeMultilingualViolations, [])
  assert.deepStrictEqual(policy.newViolations, [])
})

test('hybrid policy points structured fragmentation at explicit localization', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-policy-structured-'))
  writeProject(root, {
    source: 'module.exports = {}\n',
    files: {
      'src/Page.vue': [
        '<template><p>请阅读我们的<a href="/t">条款</a></p></template>',
        '<script>export default { name: "Page" }</script>',
        ''
      ].join('\n')
    }
  })
  const { config, sources } = sourcesFrom(root)
  const policy = evaluateHybridPolicy({ sources, config })
  assert.strictEqual(policy.ok, false)
  assert.match(policy.message, /structured-fragmentation/)
  assert.match(policy.message, /请阅读我们的/)
  assert.match(policy.message, /explicit localization/i)
})

test('hybrid policy fails new violations with reason and location', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-policy-new-'))
  writeProject(root, { source: 'const split = "你" + name + "好"\n' })
  const { config, sources } = sourcesFrom(root)
  const policy = evaluateHybridPolicy({ sources, config })
  assert.strictEqual(policy.ok, false)
  assert.match(policy.message, /policy: complete-static-copy/)
  assert.match(policy.message, /new: src\/app\.js:1:\d+ \[concatenation\]/)
})

test('hybrid policy grandfathers exact baseline entries and fails modified ones', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-policy-base-'))
  const source = 'const split = "你" + name + "好"\n'
  const { scanCompleteStaticCopyPolicy } = require('../mycommon/complete-static-copy-policy')
  const violations = scanCompleteStaticCopyPolicy([{ path: 'src/app.js', source }])
  writeProject(root, {
    source,
    baseline: { version: 1, violations }
  })
  const first = sourcesFrom(root)
  const clean = evaluateHybridPolicy(first)
  assert.strictEqual(clean.ok, true)
  assert.strictEqual(clean.grandfathered, 2)
  assert.deepStrictEqual(clean.newViolations, [])
  assert.deepStrictEqual(clean.modifiedViolations, [])

  fs.writeFileSync(path.join(root, 'src/app.js'), 'const split = "您" + name + "好"\n')
  const modified = evaluateHybridPolicy(sourcesFrom(root))
  assert.strictEqual(modified.ok, false)
  assert.match(modified.message, /modified: src\/app\.js:1:\d+ \[concatenation\] "您"/)
})

test('hybrid policy covers Vue and React source shapes in one scan', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-policy-shapes-'))
  writeProject(root, {
    source: 'const ok = "完整静态"\n',
    files: {
      'src/Page.vue': [
        '<template><p>{{ `欢迎${name}` }}</p><p>{{ `纯静态` }}</p></template>',
        '<script>export default { name: "Page" }</script>',
        ''
      ].join('\n'),
      'src/App.jsx': 'export function App() { const n = 1; return <p>{`还有${n}项`}</p> }\n'
    }
  })
  const policy = evaluateHybridPolicy(sourcesFrom(root))
  assert.strictEqual(policy.ok, false)
  assert.ok(policy.newViolations.some(item => item.path === 'src/Page.vue' && item.text === '欢迎'))
  assert.ok(policy.newViolations.some(item => item.path === 'src/App.jsx' && item.text === '还有'))
  assert.ok(!policy.newViolations.some(item => item.text === '完整静态' || item.text === '纯静态'))
})

test('committed demos pass hybrid policy after example migration', () => {
  for (const demo of ['demo', 'vue3-demo', 'react-demo']) {
    const demoRoot = path.join(__dirname, `../../../apps/${demo}`)
    const config = loadConfig({ root: demoRoot })
    const { listProjectSources } = require('../mycommon/project-sources')
    const sources = listProjectSources(config.root, config)
    const policy = evaluateHybridPolicy({ sources, config })
    assert.strictEqual(policy.ok, true, `${demo}: ${policy.message}`)
    assert.deepStrictEqual(policy.runtimeMultilingualViolations, [])
    assert.deepStrictEqual(policy.newViolations, [])
    assert.deepStrictEqual(policy.modifiedViolations, [])
  }
})
