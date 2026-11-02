const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

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
  if (baseline) {
    fs.writeFileSync(
      path.join(root, 'lang/catalog/complete-static-copy-baseline.json'),
      `${JSON.stringify(baseline, null, 2)}\n`
    )
  }
}

test('check-policy help describes baseline semantics and diagnostics', () => {
  const result = run(['check-policy', '--help'])
  assert.strictEqual(result.status, 0)
  assert.match(result.stdout, /i18n-collect check-policy/)
  assert.match(result.stdout, /complete-static-copy-baseline/)
  assert.match(result.stdout, /Interpolation, concatenation/)
  assert.match(result.stdout, /structured messages|links, emphasis/i)
  assert.match(result.stdout, /never hides collection failures/)
  assert.match(result.stdout, /runtime-multilingual-boundaries/)
  assert.match(result.stdout, /never grandfather|not grandfather|cannot be grandfathered/i)
})

test('check-policy hard-fails direct literals inside a runtime-multilingual boundary', () => {
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
  const jsonResult = run(['check-policy', '--json'], root)
  assert.strictEqual(jsonResult.status, 2, jsonResult.stderr)
  const report = JSON.parse(jsonResult.stdout)
  assert.strictEqual(report.ok, false)
  assert.ok(Array.isArray(report.runtimeMultilingualViolations))
  assert.ok(report.runtimeMultilingualViolations.some(item => (
    item.path === 'src/pages/multilingual/Page.vue'
    && item.reason === 'runtime-multilingual-literal'
    && item.text === '边界内中文'
  )))
  const textResult = run(['check-policy'], root)
  assert.strictEqual(textResult.status, 2, textResult.stderr)
  assert.match(textResult.stderr, /runtime-multilingual-literal/)
  assert.match(textResult.stderr, /边界内中文/)
})

test('check-policy does not grandfather runtime-multilingual literals via complete-static-copy baseline', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-policy-boundary-base-'))
  const source = 'const title = "边界内中文"\n'
  writeProject(root, {
    source: 'const ok = "完整静态"\n',
    baseline: {
      version: 1,
      violations: [{
        reason: 'runtime-multilingual-literal',
        path: 'src/pages/multilingual/app.js',
        kind: 'script-string',
        start: { line: 1, column: 14 },
        end: { line: 1, column: 22 },
        text: '边界内中文'
      }]
    },
    files: {
      'src/pages/multilingual/app.js': source,
      'lang/catalog/runtime-multilingual-boundaries.json': `${JSON.stringify({
        version: 1,
        boundaries: [{ id: 'js-boundary', include: ['src/pages/multilingual'] }]
      }, null, 2)}\n`
    }
  })
  const result = run(['check-policy'], root)
  assert.strictEqual(result.status, 2, result.stderr)
  assert.match(result.stderr, /runtime-multilingual-literal/)
  assert.match(result.stderr, /边界内中文/)
})

test('check-policy keeps automatic-collection areas outside boundaries clean when only complete static copy is present', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-policy-outside-boundary-'))
  writeProject(root, {
    source: 'const ok = "完整静态"\n',
    files: {
      'lang/catalog/runtime-multilingual-boundaries.json': `${JSON.stringify({
        version: 1,
        boundaries: [{ id: 'other', include: ['src/pages/multilingual'] }]
      }, null, 2)}\n`
    }
  })
  const result = run(['check-policy', '--json'], root)
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.deepStrictEqual(report.runtimeMultilingualViolations, [])
})

test('check-policy points structured fragmentation at explicit localization', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-policy-structured-'))
  writeProject(root, {
    source: 'const ok = "完整静态"\n',
    files: {
      'src/Notice.vue': [
        '<template>',
        '  <p>请阅读我们的<a href="/terms">服务条款</a></p>',
        '</template>',
        ''
      ].join('\n')
    }
  })
  const result = run(['check-policy'], root)
  assert.strictEqual(result.status, 2, result.stderr)
  assert.match(result.stderr, /structured-fragmentation/)
  assert.match(result.stderr, /请阅读我们的/)
  assert.match(result.stderr, /explicit localization/i)
})

test('check-policy fails new violations with reason and location', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-policy-new-'))
  writeProject(root, { source: 'const split = "你" + name + "好"\n' })
  const result = run(['check-policy'], root)
  assert.strictEqual(result.status, 2, result.stderr)
  assert.match(result.stderr, /policy: complete-static-copy/)
  assert.match(result.stderr, /new: src\/app\.js:1:\d+ \[concatenation\]/)
})

test('check-policy grandfathers exact baseline entries and fails modified ones', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-policy-base-'))
  const source = 'const split = "你" + name + "好"\n'
  const { scanCompleteStaticCopyPolicy } = require('../mycommon/complete-static-copy-policy')
  const violations = scanCompleteStaticCopyPolicy([{ path: 'src/app.js', source }])
  writeProject(root, {
    source,
    baseline: { version: 1, violations }
  })
  const clean = run(['check-policy', '--json'], root)
  assert.strictEqual(clean.status, 0, clean.stderr)
  const report = JSON.parse(clean.stdout)
  assert.strictEqual(report.ok, true)
  assert.strictEqual(report.grandfathered, 2)
  assert.deepStrictEqual(report.newViolations, [])
  assert.deepStrictEqual(report.modifiedViolations, [])

  fs.writeFileSync(path.join(root, 'src/app.js'), 'const split = "您" + name + "好"\n')
  const modified = run(['check-policy'], root)
  assert.strictEqual(modified.status, 2, modified.stderr)
  assert.match(modified.stderr, /modified: src\/app\.js:1:\d+ \[concatenation\] "您"/)
})

test('check-policy covers Vue and React source shapes in one scan', () => {
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
  const result = run(['check-policy', '--json'], root)
  assert.strictEqual(result.status, 2, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.ok(report.newViolations.some(item => item.path === 'src/Page.vue' && item.text === '欢迎'))
  assert.ok(report.newViolations.some(item => item.path === 'src/App.jsx' && item.text === '还有'))
  assert.ok(!report.newViolations.some(item => item.text === '完整静态' || item.text === '纯静态'))
})

test('committed demo baseline still grandfathers current complete-static-copy violations', () => {
  const demoRoot = path.join(__dirname, '../../../apps/demo')
  const result = run(['check-policy', '--json', '--cwd', demoRoot])
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.ok(report.grandfathered >= 1)
  assert.deepStrictEqual(report.newViolations, [])
  assert.deepStrictEqual(report.modifiedViolations, [])
})

test('committed react-demo baseline still grandfathers current complete-static-copy violations', () => {
  const demoRoot = path.join(__dirname, '../../../apps/react-demo')
  const result = run(['check-policy', '--json', '--cwd', demoRoot])
  assert.strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.strictEqual(report.ok, true)
  assert.ok(report.grandfathered >= 1)
  assert.deepStrictEqual(report.newViolations, [])
  assert.deepStrictEqual(report.modifiedViolations, [])
})
