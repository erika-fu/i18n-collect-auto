// Keyed catalog first. The hash dictionary answers only a key the catalog does not contain.
function demoLocaleMessages (catalog, hashDictionary) {
  return { ...(hashDictionary || {}), ...(catalog || {}) }
}

function resolveDemoMessage (key, catalog, hashDictionary) {
  const messages = demoLocaleMessages(catalog, hashDictionary)
  if (Object.prototype.hasOwnProperty.call(messages, key)) return messages[key]
  return undefined
}

module.exports = { demoLocaleMessages, resolveDemoMessage }
