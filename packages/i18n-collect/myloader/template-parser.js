const path = require('path')
const parse5Adapter = require('./template-parser-parse5')
const vue2Adapter = require('./template-parser-vue2')
const { resolveVueCompilers } = require('./vue-compiler-resolver')

function requestedLang(resource) {
  if (resource.lang) return String(resource.lang).toLowerCase()
  const query = String(resource.query || '')
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
  return (params.get('lang') || 'html').toLowerCase()
}

function parseTemplate(input) {
  if (requestedLang(input.resource) !== 'html') {
    return { constructs: [], comments: [], regions: [], warnings: [] }
  }
  if (!input.standalone) {
    const resourcePath = input.resource.absolutePath || path.resolve(input.resource.projectPath)
    const compilers = resolveVueCompilers({
      resourcePath,
      vueVersion: input.config && input.config.vueVersion
    })
    if (compilers.major === 2) {
      return vue2Adapter.parse({
        ...input,
        templateCompiler: compilers.templateCompiler
      })
    }
  }
  return parse5Adapter.parse(input)
}

module.exports = { parseTemplate }
