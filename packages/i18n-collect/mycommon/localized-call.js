const REPRESENTATION_LOCALIZED_CALL = 'localized-call'

function localizationCalleeName(callee) {
  if (!callee) return null
  if (callee.type === 'Identifier' && (callee.name === 't' || callee.name === '$t')) return callee.name
  if (callee.type !== 'MemberExpression' || callee.computed || !callee.property || callee.property.type !== 'Identifier') {
    return null
  }
  if (callee.property.name !== '$t' || !callee.object || callee.object.type !== 'ThisExpression') return null
  return 'this.$t'
}

function staticLocalizationKey(argument) {
  if (!argument) return null
  if (argument.type === 'StringLiteral') return argument.value
  if (argument.type === 'Literal' && typeof argument.value === 'string') return argument.value
  return null
}

function localizationCallParams(argument) {
  if (argument == null) return { paramsKind: 'none', paramNames: [] }
  if (argument.type !== 'ObjectExpression') return { paramsKind: 'dynamic', paramNames: [] }
  const paramNames = []
  for (const property of argument.properties || []) {
    if (!property || property.type !== 'ObjectProperty' || property.computed) {
      return { paramsKind: 'dynamic', paramNames: [] }
    }
    if (!property.key || property.key.type !== 'Identifier') {
      return { paramsKind: 'dynamic', paramNames: [] }
    }
    paramNames.push(property.key.name)
  }
  return { paramsKind: 'static', paramNames }
}

function staticLocalizationCall(node) {
  if (!node || node.type !== 'CallExpression' || node.optional) return null
  const callee = localizationCalleeName(node.callee)
  if (!callee) return null
  const key = staticLocalizationKey(node.arguments && node.arguments[0])
  if (key == null || key === '') return null
  const params = localizationCallParams(node.arguments && node.arguments[1])
  return {
    callee,
    key,
    argument: node.arguments[0],
    paramsKind: params.paramsKind,
    paramNames: params.paramNames
  }
}

function isStaticLocalizationKeyArgument(nodePath) {
  let current = nodePath.parentPath
  while (current) {
    if (current.isCallExpression()) {
      const call = staticLocalizationCall(current.node)
      return Boolean(call && call.argument === nodePath.node)
    }
    if (current.isFunction()) break
    current = current.parentPath
  }
  return false
}

module.exports = {
  REPRESENTATION_LOCALIZED_CALL,
  isStaticLocalizationKeyArgument,
  staticLocalizationCall
}
