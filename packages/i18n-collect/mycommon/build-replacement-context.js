const path = require('path')

const contexts = new Map()

function resolveRoot(root) {
  return path.resolve(root)
}

function setBuildReplacementContext(root, context) {
  contexts.set(resolveRoot(root), context || null)
}

function getBuildReplacementContext(root) {
  return contexts.get(resolveRoot(root)) || null
}

function clearBuildReplacementContext(root) {
  contexts.delete(resolveRoot(root))
}

module.exports = {
  clearBuildReplacementContext,
  getBuildReplacementContext,
  setBuildReplacementContext
}
