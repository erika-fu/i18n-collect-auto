const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const { contextSuppresses } = require('./context-filter')
const { babelComments, directivesBefore, scanDirectives } = require('./directives')
const { containsHan, offsetToPosition } = require('./resource')

const MODULE_SPECIFIER_PARENTS = new Set([
  'ImportDeclaration',
  'ExportAllDeclaration',
  'ExportNamedDeclaration'
])

function location(source, projectPath, node, kind) {
  return {
    path: projectPath,
    kind,
    start: offsetToPosition(source, node.start),
    end: offsetToPosition(source, node.end)
  }
}

function entry(value, loc, key) {
  return key ? { value, key, locations: [loc] } : { value, locations: [loc] }
}

function extractScript({ source, resource, config }) {
  if (typeof source !== 'string') throw new TypeError('Script extractor requires source text')
  if (!resource || typeof resource.projectPath !== 'string' || !resource.projectPath) {
    throw new TypeError('Script extractor requires a project path')
  }
  const entries = []
  const ast = parser.parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] })
  const fail = (offset, message) => {
    const error = new Error(message)
    error.loc = offsetToPosition(source, offset)
    throw error
  }
  const directives = scanDirectives(babelComments(ast.comments), fail)
  traverse(ast, {
    StringLiteral(nodePath) {
      if (MODULE_SPECIFIER_PARENTS.has(nodePath.parent.type)) return
      const directive = directivesBefore(source, directives, nodePath.node.start, fail)
      if (directive.exclude) return
      if (contextSuppresses(nodePath, config && config.contextFilters)) return
      const value = nodePath.node.value
      if (!containsHan(value)) return
      entries.push(entry(value, location(source, resource.projectPath, nodePath.node, 'script-string'), directive.key))
    },
    TemplateLiteral(nodePath) {
      if (contextSuppresses(nodePath, config && config.contextFilters)) return
      let pending = directivesBefore(source, directives, nodePath.node.start, fail)
      for (const node of nodePath.node.quasis) {
        const value = node.value.cooked
        if (!value || !containsHan(value)) continue
        const applied = pending
        pending = null
        if (applied && applied.exclude) continue
        entries.push(entry(value, location(source, resource.projectPath, node, 'template-literal'), applied && applied.key))
      }
    }
  })
  return entries
}

module.exports = { extractScript }
