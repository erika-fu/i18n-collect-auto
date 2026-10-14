const { t } = require('./i18n')
require('./notes')
require('./legacy/old')
const message = /* i18n-key: home.hello */ '你好'
const hidden = /* no-i18n-auto */ '机密'
module.exports = { message, hidden }
