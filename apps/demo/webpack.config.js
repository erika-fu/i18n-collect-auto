const path = require('path')
const Service = require('@vue/cli-service/lib/Service')

// i18n-collect build loads a webpack config object. Vue CLI keeps the
// integration in vue.config.js; resolve that same config here.
process.env.NODE_ENV = process.env.NODE_ENV || 'production'
process.env.VUE_CLI_MODE = process.env.VUE_CLI_MODE || process.env.NODE_ENV

const service = new Service(path.resolve(__dirname))
service.init(process.env.VUE_CLI_MODE)
module.exports = service.resolveWebpackConfig()
