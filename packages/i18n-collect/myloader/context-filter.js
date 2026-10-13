const LOGGING = new Set([
  'console.log',
  'console.info',
  'console.warn',
  'console.error',
  'console.debug',
  'console.trace',
  'log',
  'logger.log',
  'logger.info',
  'logger.warn',
  'logger.error',
  'logger.debug',
  'logger.trace'
])

const ANALYTICS = new Set([
  'gtag',
  'track',
  'analytics.track',
  'analytics.page',
  'analytics.identify',
  'analytics.screen',
  'dataLayer.push'
])

const TEST_CALLS = new Set([
  'describe',
  'it',
  'test',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'expect',
  'describe.only',
  'describe.skip',
  'describe.each',
  'it.only',
  'it.skip',
  'it.each',
  'it.todo',
  'describe.todo',
  'test.only',
  'test.skip',
  'test.each',
  'test.todo'
])

function calleeName(node) {
  if (!node) return null
  if (node.type === 'Identifier') return node.name
  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    node.object.type === 'Identifier'
  ) {
    return `${node.object.name}.${node.property.name}`
  }
  return null
}

function nearestCall(nodePath) {
  let current = nodePath.parentPath
  while (current) {
    if (current.isCallExpression()) return current
    current = current.parentPath
  }
  return null
}

function isCallArgument(callPath, nodePath) {
  let current = nodePath
  while (current && current.parentPath && current.parentPath !== callPath) current = current.parentPath
  return Boolean(current && current.parentPath === callPath && current.listKey === 'arguments')
}

function contextSuppresses(nodePath, filters) {
  if (!Array.isArray(filters) || filters.length === 0) return false
  const selected = new Set(filters)
  if (selected.has('tests')) {
    let current = nodePath.parentPath
    while (current) {
      if (current.isCallExpression() && !current.node.optional && TEST_CALLS.has(calleeName(current.node.callee))) return true
      current = current.parentPath
    }
  }
  const call = nearestCall(nodePath)
  if (!call || call.node.optional || !isCallArgument(call, nodePath)) return false
  const name = calleeName(call.node.callee)
  if (selected.has('logging') && LOGGING.has(name)) return true
  if (selected.has('analytics') && ANALYTICS.has(name)) return true
  return false
}

module.exports = { contextSuppresses }
