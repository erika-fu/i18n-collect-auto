const zh = require('../../lang/catalog/zh.json')
const en = require('../../lang/catalog/en.json')

const catalogs = { zh, en }
let locale = 'en'

function format(message, params) {
  if (!params) return message
  return String(message).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ))
}

function setLocale(next) {
  locale = next
  return locale
}

function t(key, params) {
  const catalog = catalogs[locale] || {}
  const fallback = catalogs.zh || {}
  const message = Object.prototype.hasOwnProperty.call(catalog, key)
    ? catalog[key]
    : fallback[key]
  if (message == null) return key
  return format(message, params)
}

module.exports = { setLocale, t, catalogs }
