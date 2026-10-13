const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { loadConfig, validate } = require('../mycommon/config')
const { describeResource, isResourceIncluded, offsetToPosition } = require('../myloader/resource')

function identify(resourcePath, resourceQuery = '') {
  return describeResource({ root: '/project', resourcePath, resourceQuery }).identity
}

test('identifies standalone script, HTML, and CSS resources', () => {
  assert.strictEqual(identify('/project/src/utils/message.js'), 'src/utils/message.js::script')
  assert.strictEqual(identify('/project/src/utils/message.ts'), 'src/utils/message.ts::script')
  assert.strictEqual(identify('/project/public/index.html'), 'public/index.html::html')
  assert.strictEqual(identify('/project/src/base.css'), 'src/base.css::style[index=0;lang=css]')
  assert.strictEqual(
    describeResource({
      root: '/project',
      resourcePath: '/project/src/theme.scss',
      styleExtensions: ['.css', '.scss']
    }).identity,
    'src/theme.scss::style[index=0;lang=scss]'
  )
  assert.strictEqual(
    identify('/project/src/extra.css', '?vue&type=style&index=1&lang=css&id=abc'),
    'src/extra.css::style[index=1;lang=css]'
  )
  assert.deepStrictEqual(describeResource({
    root: '/project',
    resourcePath: '/project/src/utils/message.js',
    resourceQuery: '?id=1&scoped=true&prod=true'
  }), {
    absolutePath: path.resolve('/project/src/utils/message.js'),
    projectPath: 'src/utils/message.js',
    query: '?id=1&scoped=true&prod=true',
    block: 'script',
    styleIndex: null,
    lang: null,
    sourceOffset: 0,
    identity: 'src/utils/message.js::script'
  })
})

test('identifies Vue script, template, and style blocks', () => {
  const file = '/project/src/App.vue'
  assert.strictEqual(identify(file, '?vue&type=script'), 'src/App.vue::script[lang=js]')
  assert.strictEqual(identify(file, '?vue&type=script&lang=js'), 'src/App.vue::script[lang=js]')
  assert.strictEqual(identify(file, '?vue&type=script&lang=ts'), 'src/App.vue::script[lang=ts]')
  assert.strictEqual(identify(file, '?vue&type=template'), 'src/App.vue::template[lang=html]')
  assert.strictEqual(identify(file, '?vue&type=template&lang=html'), 'src/App.vue::template[lang=html]')
  assert.strictEqual(
    identify('/project/src/copy.html', '?vue&type=template&id=abc&scoped=true'),
    'src/copy.html::template[lang=html]'
  )
  assert.notStrictEqual(
    identify('/project/src/copy.html', '?vue&type=template'),
    identify('/project/src/copy.html')
  )
  assert.strictEqual(identify(file, '?vue&type=style'), 'src/App.vue::style[index=0;lang=css]')
  assert.strictEqual(identify(file, '?vue&type=style&index=0&lang=css'), 'src/App.vue::style[index=0;lang=css]')
  assert.strictEqual(identify(file, '?vue&type=style&index=1&lang=scss'), 'src/App.vue::style[index=1;lang=scss]')
  assert.notStrictEqual(
    identify(file, '?vue&type=style&index=0&lang=css'),
    identify(file, '?vue&type=style&index=1&lang=scss')
  )
})

test('ignores Vue query fields that do not change collection semantics', () => {
  const file = '/project/src/App.vue'
  const withNoise = '?vue&type=style&index=1&lang=scss&id=abc&scoped=true&prod=true'
  const semantic = '?vue&type=style&index=1&lang=scss'
  assert.strictEqual(identify(file, withNoise), identify(file, semantic))
  assert.strictEqual(
    identify('/project/src/utils/message.js', '?id=abc&scoped=true&prod=true&type=template'),
    'src/utils/message.js::script'
  )
  assert.strictEqual(
    identify('/project/src/utils/message.js?vue&type=template&id=abc'),
    'src/utils/message.js::script'
  )
})

test('normalizes resource paths to project-relative slash paths', () => {
  assert.strictEqual(
    identify('\\project\\src\\utils\\message.js'),
    'src/utils/message.js::script'
  )
})

test('matches include and exclude on directory boundaries', () => {
  const config = validate('/project', {
    include: ['src/foo/'],
    exclude: ['src/foo/secret']
  })
  assert.strictEqual(isResourceIncluded('src/foo', config), true)
  assert.strictEqual(isResourceIncluded('src/foo/bar.js', config), true)
  assert.strictEqual(isResourceIncluded('src/foobar.js', config), false)
  assert.strictEqual(isResourceIncluded('src/foo/secret/a.js', config), false)
  assert.strictEqual(isResourceIncluded('src/foo/secret.js', config), true)
  assert.strictEqual(isResourceIncluded('src/foo/bar.js?vue&type=script&id=1', config), true)
  assert.strictEqual(isResourceIncluded('src/other.js', { include: [], exclude: ['src/other.js'] }), false)
  assert.strictEqual(isResourceIncluded('src/kept.js', { include: [], exclude: [] }), true)
})

test('matches project-relative globs and lets exclude veto either kind of rule', () => {
  const config = validate('/project', {
    include: ['src/**/*.vue', 'public/*.html'],
    exclude: ['src/legacy', 'src/**/*.spec.js']
  })
  assert.strictEqual(isResourceIncluded('src/App.vue', config), true)
  assert.strictEqual(isResourceIncluded('src/views/Home.vue', config), true)
  assert.strictEqual(isResourceIncluded('src/App.js', config), false)
  assert.strictEqual(isResourceIncluded('public/index.html', config), true)
  assert.strictEqual(isResourceIncluded('public/nested/index.html', config), false)
  assert.strictEqual(isResourceIncluded('src/legacy/Old.vue', config), false)
  assert.strictEqual(isResourceIncluded('src/components/Button.spec.js', config), false)
  assert.strictEqual(isResourceIncluded('src/App.vue?vue&type=template&id=1', config), true)

  const mixed = validate('/project', {
    include: ['src/components'],
    exclude: ['src/components/**/*.spec.js']
  })
  assert.strictEqual(isResourceIncluded('src/components/Button.vue', mixed), true)
  assert.strictEqual(isResourceIncluded('src/components/forms/Button.spec.js', mixed), false)
  assert.strictEqual(isResourceIncluded('src/componentsExtra/Button.vue', mixed), false)

  const globInclude = validate('/project', {
    include: ['**/*.css'],
    exclude: ['src/vendor']
  })
  assert.strictEqual(isResourceIncluded('src/base.css', globInclude), true)
  assert.strictEqual(isResourceIncluded('src/theme/a.css', globInclude), true)
  assert.strictEqual(isResourceIncluded('src/vendor/a.css', globInclude), false)
  assert.strictEqual(isResourceIncluded('src/app.js', { include: [], exclude: ['**/*.test.js'] }), true)
  assert.strictEqual(isResourceIncluded('src/app.test.js', { include: [], exclude: ['**/*.test.js'] }), false)
})

test('rejects invalid, absolute, escaping, and ambiguous scope patterns', () => {
  assert.throws(() => validate('/project', { include: ['/src/**/*.vue'] }), /project-relative/)
  assert.throws(() => validate('/project', { exclude: ['C:/src/**/*.js'] }), /project-relative/)
  assert.throws(() => validate('/project', { include: ['../**/*.js'] }), /inside the project root/)
  assert.throws(() => validate('/project', { exclude: ['src/../../**/*.vue'] }), /inside the project root/)
  assert.throws(() => validate('/project', { include: ['src/**.js'] }), /ambiguous/)
  assert.throws(() => validate('/project', { include: ['src/**/../secret.js'] }), /ambiguous/)
  assert.throws(() => validate('/project', { exclude: ['src/{a,b}.js'] }), /ambiguous/)
  assert.throws(() => validate('/project', { include: ['src/**/'] }), /ambiguous/)
  assert.throws(() => validate('/project', { include: ['src/[.js'] }), /invalid/)
  assert.throws(() => validate('/project', { include: ['src/[]'] }), /invalid/)
  assert.deepStrictEqual(validate('/project', { include: ['src\\**\\*.vue'] }).include, ['src/**/*.vue'])
  assert.deepStrictEqual(validate('/project', { include: ['src/../kept/**/*.js'] }).include, ['kept/**/*.js'])
  assert.throws(() => validate('/project', { include: ['src/**/*.js', 'src/**/**/*.js'] }), /duplicate/)
  const classes = validate('/project', { include: ['src/file?.js', 'src/page-[ab].vue'] })
  assert.strictEqual(isResourceIncluded('src/file1.js', classes), true)
  assert.strictEqual(isResourceIncluded('src/file10.js', classes), false)
  assert.strictEqual(isResourceIncluded('src/page-a.vue', classes), true)
  assert.strictEqual(isResourceIncluded('src/page-c.vue', classes), false)
  const bracket = validate('/project', { include: ['src/page-[' + ']]' + '.vue'] })
  assert.strictEqual(isResourceIncluded('src/page-].vue', bracket), true)
  assert.strictEqual(isResourceIncluded('src/page-a.vue', bracket), false)
})

test('rejects include and exclude paths that are absolute, escaping, empty, root-only, or duplicate', () => {
  assert.throws(() => validate('/project', { include: ['/etc/passwd'] }), /project-relative/)
  assert.throws(() => validate('/project', { exclude: ['C:/Windows'] }), /project-relative/)
  assert.throws(() => validate('/project', { include: ['../secret'] }), /inside the project root/)
  assert.throws(() => validate('/project', { exclude: ['src/../../outside'] }), /inside the project root/)
  assert.throws(() => validate('/project', { include: [''] }), /empty or the project root/)
  assert.throws(() => validate('/project', { include: ['.'] }), /empty or the project root/)
  assert.throws(() => validate('/project', { exclude: ['src/..'] }), /empty or the project root/)
  assert.throws(() => validate('/project', { include: ['src/foo', 'src/foo/'] }), /duplicate/)
  assert.throws(() => validate('/project', { exclude: ['src/foo', 'src/bar/../foo'] }), /duplicate/)
  assert.deepStrictEqual(validate('/project', { include: ['src\\foo\\bar\\..\\'] }).include, ['src/foo'])
})

test('context filters are off by default and only accept the named categories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-context-'))
  assert.deepStrictEqual(loadConfig({ root }).contextFilters, [])
  assert.deepStrictEqual(
    validate('/project', { contextFilters: ['analytics', 'logging'] }).contextFilters,
    ['analytics', 'logging']
  )
  assert.throws(() => validate('/project', { contextFilters: ['comments'] }), /contextFilters/)
  assert.throws(() => validate('/project', { contextFilters: ['tests', 'tests'] }), /duplicate/)
  assert.deepStrictEqual(
    loadConfig({ root, loaderOptions: { contextFilters: ['tests'] } }).contextFilters,
    ['tests']
  )
  assert.throws(() => loadConfig({ root, pluginOptions: { contextFilters: ['logging'] } }), /unknown explicit option "contextFilters"/)
  const file = path.join(root, 'i18n-collect.config.js')
  fs.writeFileSync(file, 'module.exports = { contextFilters: [] }\n')
  const disabled = loadConfig({ root })
  fs.writeFileSync(file, 'module.exports = { contextFilters: ["logging"] }\n')
  const enabled = loadConfig({ root })
  assert.notStrictEqual(enabled.configHash, disabled.configHash)
  assert.notStrictEqual(enabled.fileConfigHash, disabled.fileConfigHash)
})

test('keeps loader and plugin options on their own fields and drops htmlEntries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-config-'))
  const config = loadConfig({ root })
  assert.deepStrictEqual(config.styleExtensions, ['.css'])
  assert.strictEqual(Object.hasOwn(config, 'htmlEntries'), false)
  assert.throws(() => validate('/project', { htmlEntries: ['public/index.html'] }), /unknown field/)
  assert.throws(() => loadConfig({ root, loaderOptions: { outputPath: 'lang/out.json' } }), /unknown explicit option "outputPath"/)
  assert.throws(() => loadConfig({ root, loaderOptions: { sourceMapFilename: 'lang/map.json' } }), /unknown explicit option "sourceMapFilename"/)
  assert.throws(() => loadConfig({ root, pluginOptions: { include: ['src'] } }), /unknown explicit option "include"/)
  assert.throws(() => loadConfig({ root, pluginOptions: { styleExtensions: ['.css'] } }), /unknown explicit option "styleExtensions"/)
  assert.throws(() => loadConfig({ root, pluginOptions: { htmlEntries: ['public/index.html'] } }), /unknown explicit option "htmlEntries"/)
})

test('counts offsets as 1-based lines and 0-based UTF-16 columns', () => {
  assert.deepStrictEqual(offsetToPosition('ab\ncd', 0), { line: 1, column: 0 })
  assert.deepStrictEqual(offsetToPosition('ab\ncd', 3), { line: 2, column: 0 })
  assert.deepStrictEqual(offsetToPosition('ab\ncd', 5), { line: 2, column: 2 })
  assert.deepStrictEqual(offsetToPosition('ab\r\ncd', 4), { line: 2, column: 0 })
  assert.deepStrictEqual(offsetToPosition('😀好', 2), { line: 1, column: 2 })
})
