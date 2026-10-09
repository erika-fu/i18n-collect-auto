const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
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

function extractScript({ source, resource }) {
  if (typeof source !== 'string') throw new TypeError('Script extractor requires source text')
  if (!resource || typeof resource.projectPath !== 'string' || !resource.projectPath) {
    throw new TypeError('Script extractor requires a project path')
  }
  const entries = []
  const ast = parser.parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] })
  traverse(ast, {
    StringLiteral(nodePath) {
      if (MODULE_SPECIFIER_PARENTS.has(nodePath.parent.type)) return
      const value = nodePath.node.value
      if (!containsHan(value)) return
      entries.push({
        value,
        locations: [location(source, resource.projectPath, nodePath.node, 'script-string')]
      })
    },
    TemplateLiteral(nodePath) {
      for (const node of nodePath.node.quasis) {
        const value = node.value.cooked
        if (!value || !containsHan(value)) continue
        entries.push({
          value,
          locations: [location(source, resource.projectPath, node, 'template-literal')]
        })
      }
    }
  })
  return entries
}

module.exports = { extractScript }
