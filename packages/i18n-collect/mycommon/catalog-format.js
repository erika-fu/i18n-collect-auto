// A catalog format adapter: { name, extension, serialize(messages) -> string, parse(text) -> messages }.
// messages is a flat { key: text } object; serialize must return identical text for identical messages.

function isFlatMapping(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(text => typeof text === 'string')
}

const json = {
  name: 'json',
  extension: '.json',
  serialize(messages) {
    const sorted = Object.fromEntries(Object.keys(messages).sort().map(key => [key, messages[key]]))
    return `${JSON.stringify(sorted, null, 2)}\n`
  },
  parse(text) {
    const value = JSON.parse(text)
    if (!isFlatMapping(value)) throw new Error('a json catalog must be a flat mapping of strings')
    return value
  }
}

const FORMATS = new Map([[json.name, json]])
const CATALOG_FORMATS = [...FORMATS.keys()]

function catalogFormat(name) {
  const adapter = FORMATS.get(name)
  if (!adapter) throw new Error(`unknown catalog format "${name}"; expected one of ${CATALOG_FORMATS.join(', ')}`)
  return adapter
}

module.exports = { CATALOG_FORMATS, catalogFormat }
