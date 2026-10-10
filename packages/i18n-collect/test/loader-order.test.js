const assert = require('assert')
const fs = require('fs')
const path = require('path')
const test = require('node:test')
const webpack = require('webpack')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const { NormalModule } = webpack

const demoRoot = path.resolve(__dirname, '../../../apps/demo')
const collectorPath = fs.realpathSync(require.resolve('../myloader')).replace(/\\/g, '/')

function compile(config, prepare) {
  return new Promise((resolve, reject) => {
    const compiler = webpack(config)
    if (prepare) prepare(compiler)
    compiler.run((error, stats) => {
      compiler.close(closeError => {
        if (error) reject(error)
        else if (closeError) reject(closeError)
        else resolve(stats)
      })
    })
  })
}

function loaderPath(loader) {
  const request = typeof loader === 'string' ? loader : loader && loader.loader
  if (!request) return ''
  try {
    return fs.realpathSync(request).replace(/\\/g, '/')
  } catch (error) {
    return String(request).replace(/\\/g, '/')
  }
}

function usesOf(rule) {
  if (Array.isArray(rule.use)) return rule.use.map(loaderPath)
  if (rule.loader) return [loaderPath(rule.loader)]
  return []
}

function walk(rules, visit, parentTest) {
  for (const rule of rules || []) {
    const test = rule.test || parentTest
    visit(rule, test)
    walk(rule.oneOf, visit, test)
    walk(rule.rules, visit, test)
  }
}

function resolveDemoConfig() {
  const Service = require('@vue/cli-service/lib/Service')
  const service = new Service(demoRoot)
  const ready = service.init('production')
  return Promise.resolve(ready).then(() => service.resolveWebpackConfig())
}

function messages(stats) {
  return stats.toJson({ errors: true }).errors.map(error => error.message).join('\n')
}

test('the demo production config runs the collector ahead of later transforms', { timeout: 60000 }, async () => {
  const resolved = await resolveDemoConfig()
  const jsRules = []
  const cssRules = []
  const queryRules = []
  walk(resolved.module.rules, (rule, ruleTest) => {
    const loaders = usesOf(rule)
    const matches = file => ruleTest && ruleTest.test && ruleTest.test(file)
    if (loaders.includes(collectorPath) && matches('src/main.js')) jsRules.push(loaders)
    if (matches('src/base.css')) cssRules.push({ query: String(rule.resourceQuery || ''), loaders })
    if (rule.resourceQuery) queryRules.push({ query: String(rule.resourceQuery), loaders })
  })
  assert.strictEqual(jsRules.length, 1)
  const jsLoaders = jsRules[0]
  const threadAt = jsLoaders.findIndex(loader => loader.includes('/thread-loader/'))
  const babelAt = jsLoaders.findIndex(loader => loader.includes('/babel-loader/'))
  assert.ok(jsLoaders.indexOf(collectorPath) < threadAt)
  assert.ok(threadAt < babelAt)
  const standaloneCss = cssRules.filter(rule => rule.loaders.includes(collectorPath) && !rule.query.includes('vue'))
  assert.ok(standaloneCss.length > 0)
  assert.ok(standaloneCss.every(rule => rule.loaders.at(-1) === collectorPath && rule.loaders.some(loader => loader.includes('/postcss-loader/'))))
  assert.ok(cssRules.some(rule => rule.query.includes('vue') && !rule.loaders.includes(collectorPath)))
  assert.ok(queryRules.some(rule => rule.query.includes('type=template') && rule.loaders.includes(collectorPath)))
  assert.ok(queryRules.some(rule => rule.query.includes('type=script') && rule.loaders.includes(collectorPath)))
  assert.ok(queryRules.some(rule => rule.query.includes('type=style') && rule.loaders.includes(collectorPath)))
  const html = resolved.plugins.find(plugin => {
    const options = plugin && (plugin.options || plugin.userOptions)
    return options && typeof options.template === 'string' && options.template.includes('myloader')
  })
  assert.ok(html)
  const template = String((html.options || html.userOptions).template).replace(/\\/g, '/')
  const collectorAt = template.indexOf('/myloader/')
  assert.ok(template.includes('/html-webpack-plugin/'))
  assert.ok(template.indexOf('/html-webpack-plugin/') < collectorAt)
  assert.ok(collectorAt < template.lastIndexOf('/public/index.html'))
  assert.match(template, /"force":true/)

  const root = fs.mkdtempSync(path.join(__dirname, '.tmp-loader-order-'))
  try {
    fs.mkdirSync(path.join(root, 'src'))
    fs.mkdirSync(path.join(root, 'public'))
    fs.writeFileSync(path.join(root, 'src/main.js'), 'require("./base.css")\nrequire("./App.vue")\nmodule.exports = "脚本原文"\n')
    fs.writeFileSync(path.join(root, 'src/base.css'), '.a::before { content: "独立样式"; }\n')
    fs.writeFileSync(path.join(root, 'src/App.vue'), [
      '<template><p>模板原文</p></template>',
      '<script>export default { name: "页面" }</script>',
      '<style>.a::before { content: "样式原文"; }</style>',
      ''
    ].join('\n'))
    const htmlFile = path.join(root, 'public/index.html')
    fs.writeFileSync(htmlFile, '<!DOCTYPE html><html><head><title><%= htmlWebpackPlugin.options.title %></title></head><body><p>页面原文</p></body></html>\n')
    const prefix = template.slice(0, template.lastIndexOf('!') + 1)
    const rows = []
    const record = compiler => {
      const tap = compilation => {
        NormalModule.getCompilationHooks(compilation).beforeLoaders.tap('i18n-order', (loaders, mod) => {
          rows.push({
            resource: String(mod.resource || '').replace(/\\/g, '/'),
            loaders: loaders.map(item => String(item.loader || '').replace(/\\/g, '/'))
          })
        })
      }
      compiler.hooks.compilation.tap('i18n-order', tap)
      compiler.hooks.thisCompilation.tap('i18n-order', compilation => {
        compilation.hooks.childCompiler.tap('i18n-order', child => {
          child.hooks.compilation.tap('i18n-order', tap)
        })
      })
    }
    const stats = await compile({
      context: root,
      mode: 'development',
      entry: path.join(root, 'src/main.js'),
      output: { path: path.join(root, 'dist'), filename: 'bundle.js', publicPath: '/' },
      cache: false,
      infrastructureLogging: { level: 'error' },
      optimization: { minimize: false },
      resolve: resolved.resolve,
      module: resolved.module,
      plugins: [
        ...resolved.plugins.filter(plugin => {
          const name = plugin.constructor && plugin.constructor.name
          return name === 'VueLoaderPlugin' || name === 'MiniCssExtractPlugin' || name === 'MyI18nPlugin'
        }),
        new HtmlWebpackPlugin({
          template: `${prefix}${htmlFile}`,
          filename: 'index.html',
          title: '演示标题',
          inject: true
        })
      ]
    }, record)
    assert.strictEqual(stats.hasErrors(), false, messages(stats))
    const match = (suffix, query) => rows.filter(row => row.resource.includes(suffix) && (!query || row.resource.includes(query)))
    const script = match('/src/main.js', '').find(row => !row.resource.includes('?'))
    assert.ok(script)
    assert.ok(script.loaders.findIndex(loader => loader.includes('/myloader/')) < script.loaders.findIndex(loader => loader.includes('/thread-loader/')))
    assert.ok(script.loaders.findIndex(loader => loader.includes('/thread-loader/')) < script.loaders.findIndex(loader => loader.includes('/babel-loader/')))
    const css = match('/src/base.css', '').find(row => row.loaders.some(loader => loader.includes('/myloader/')))
    assert.ok(css)
    assert.ok(css.loaders.findIndex(loader => loader.includes('/postcss-loader/')) < css.loaders.findIndex(loader => loader.includes('/myloader/')))
    assert.strictEqual(css.loaders.at(-1).includes('/myloader/'), true)
    const templateBlock = match('/src/App.vue', 'type=template').find(row => row.loaders.some(loader => loader.includes('/myloader/')))
    const styleBlock = match('/src/App.vue', 'type=style').find(row => row.loaders.some(loader => loader.includes('/myloader/')))
    const at = (loaders, part) => loaders.findIndex(loader => loader.includes(part))
    const described = loaders => loaders.map(loader => loader.split('/node_modules/').pop()).join(' | ')
    assert.ok(at(templateBlock.loaders, '/myloader/') < at(templateBlock.loaders, 'templateLoader'), described(templateBlock.loaders))
    assert.ok(at(templateBlock.loaders, '/myloader/') < at(templateBlock.loaders, '/thread-loader/'), described(templateBlock.loaders))
    assert.ok(at(styleBlock.loaders, '/css-loader/') !== -1, described(styleBlock.loaders))
    assert.ok(at(styleBlock.loaders, '/postcss-loader/') < at(styleBlock.loaders, '/myloader/'), described(styleBlock.loaders))
    assert.ok(at(styleBlock.loaders, '/css-loader/') < at(styleBlock.loaders, '/myloader/'), described(styleBlock.loaders))
    const page = match('/public/index.html', '').find(row => row.loaders.some(loader => loader.includes('/myloader/')))
    assert.ok(page.loaders.findIndex(loader => loader.includes('/html-webpack-plugin/')) < page.loaders.findIndex(loader => loader.includes('/myloader/')))
    const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'lang/zh_hash.json'), 'utf8'))
    assert.deepStrictEqual(new Set(Object.values(dictionary)), new Set(['脚本原文', '独立样式', '模板原文', '页面', '样式原文', '页面原文']))
    const htmlOut = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8')
    assert.ok(!htmlOut.includes('<%'))
    assert.ok(htmlOut.includes('<title>演示标题</title>'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
