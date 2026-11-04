const parse5Adapter = require('./template-parser-parse5')

function parseTemplate(input) {
  return parse5Adapter.parse(input)
}

module.exports = { parseTemplate }
