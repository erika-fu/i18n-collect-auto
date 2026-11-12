const path = require('path')
const Service = require('@vue/cli-service/lib/Service')
const MyI18nPlugin = require('../../packages/i18n-collect/myplugin')
const collector = require.resolve('../../packages/i18n-collect/myloader')

// i18n-collect collect/build load a webpack config object. Vue CLI keeps the
// integration in vue.config.js; resolve that same config here and attach the
// Webpack collection loader/plugin for module-graph collection.
process.env.NODE_ENV = process.env.NODE_ENV || 'production'
process.env.VUE_CLI_MODE = process.env.VUE_CLI_MODE || process.env.NODE_ENV

const service = new Service(path.resolve(__dirname))
service.init(process.env.VUE_CLI_MODE)
const config = service.resolveWebpackConfig()

function stripThreadLoader(rules) {
  if (!Array.isArray(rules)) return
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    if (rule.oneOf) stripThreadLoader(rule.oneOf)
    if (rule.rules) stripThreadLoader(rule.rules)
    const uses = rule.use == null ? null : Array.isArray(rule.use) ? rule.use : [rule.use]
    if (!uses) continue
    rule.use = uses.filter(item => {
      const loader = typeof item === 'string' ? item : item && item.loader
      return !loader || !String(loader).includes('thread-loader')
    })
    if (rule.use.length === 1) rule.use = rule.use[0]
    if (Array.isArray(rule.use) && rule.use.length === 0) delete rule.use
  }
}

stripThreadLoader(config.module && config.module.rules)

config.module = config.module || { rules: [] }
config.module.rules = [
  ...(config.module.rules || []),
  {
    test: /\.m?[jt]sx?$/,
    exclude: /node_modules/,
    enforce: 'pre',
    use: [collector]
  },
  { test: /\.vue$/, resourceQuery: /type=template/, enforce: 'pre', use: [collector] },
  { test: /\.vue$/, resourceQuery: /type=script/, enforce: 'pre', use: [collector] },
  {
    test: /\.css$/,
    exclude: [/node_modules/, /\.vue$/],
    enforce: 'pre',
    use: [collector]
  }
]
config.plugins = [...(config.plugins || []), new MyI18nPlugin({ publishOutputs: false })]

module.exports = config
