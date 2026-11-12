const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const { DEFAULTS } = require('../mycommon/config')
const {
  REPRESENTATION_LOCALIZED_CALL,
  staticLocalizationCall
} = require('../mycommon/localized-call')
const { containsHan, offsetToPosition } = require('./resource')

const VUE3_TEXT_HELPERS = new Set([
  'createTextVNode',
  '_createTextVNode'
])

const VUE3_ELEMENT_HELPERS = new Set([
  'createElementVNode',
  '_createElementVNode',
  'createElementBlock',
  '_createElementBlock',
  'createVNode',
  '_createVNode',
  'createBlock',
  '_createBlock'
])

const VUE3_UNSUPPORTED_HELPERS = new Set([
  'createStaticVNode',
  '_createStaticVNode',
  'ssrRenderComponent',
  '_ssrRenderComponent',
  'ssrRenderAttr',
  '_ssrRenderAttr',
  'ssrInterpolate',
  '_ssrInterpolate'
])

const VUE2_TEXT_HELPERS = new Set(['_v', 'v'])
const VUE2_ELEMENT_HELPERS = new Set(['_c', 'h'])
const VUE2_IGNORED_HELPERS = new Set(['_m', 'm', '_u', 'u', '_l', 'l', '_t', 't', '_e', 'e'])
const VUE2_ATTR_BAGS = new Set(['attrs', 'domProps'])

function location(source, projectPath, node, kind) {
  return {
    path: projectPath,
    kind,
    start: offsetToPosition(source, node.start),
    end: offsetToPosition(source, node.end)
  }
}

function entry(value, loc) {
  return { value, locations: [loc] }
}

function localizedCallFrom(node, source, projectPath) {
  const call = staticLocalizationCall(node)
  if (!call) return null
  return {
    value: '',
    key: call.key,
    representation: REPRESENTATION_LOCALIZED_CALL,
    paramsKind: call.paramsKind,
    paramNames: call.paramNames,
    locations: [location(source, projectPath, call.argument, 'template-expression')]
  }
}

function calleeName(node) {
  if (!node) return null
  if (node.type === 'Identifier') return node.name
  return null
}

function staticString(node) {
  if (!node) return null
  if (node.type === 'StringLiteral') return { value: node.value, node }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
    return { value: node.quasis[0].value.cooked, node: node.quasis[0] }
  }
  return null
}

function propertyKey(prop) {
  if (prop.computed) return null
  if (prop.key.type === 'Identifier') return prop.key.name
  if (prop.key.type === 'StringLiteral') return prop.key.value
  return null
}

function hasSpread(objectNode) {
  return objectNode.properties.some(prop => prop.type === 'SpreadElement' || prop.type === 'ObjectMethod')
}

function collectAllowlistedProps(propsNode, allowlist, source, projectPath, entries) {
  if (!propsNode || propsNode.type !== 'ObjectExpression') return
  if (hasSpread(propsNode)) return
  for (const prop of propsNode.properties) {
    if (prop.type !== 'ObjectProperty') continue
    const key = propertyKey(prop)
    if (key == null || !allowlist.has(key)) continue
    const literal = staticString(prop.value)
    if (!literal || !containsHan(literal.value)) continue
    entries.push(entry(literal.value, location(source, projectPath, literal.node, 'script-string')))
  }
}

function collectVue2DataAttrs(dataNode, allowlist, source, projectPath, entries) {
  if (!dataNode || dataNode.type !== 'ObjectExpression') return
  if (hasSpread(dataNode)) return
  for (const prop of dataNode.properties) {
    if (prop.type !== 'ObjectProperty') continue
    const key = propertyKey(prop)
    if (!VUE2_ATTR_BAGS.has(key)) continue
    collectAllowlistedProps(prop.value, allowlist, source, projectPath, entries)
  }
}

function isChildrenArg(node) {
  return node && (
    node.type === 'ArrayExpression'
    || node.type === 'StringLiteral'
    || (node.type === 'TemplateLiteral' && node.expressions.length === 0)
  )
}

function collectVue3(ast, source, projectPath, allowlist, entries, diagnostics) {
  traverse(ast, {
    CallExpression(nodePath) {
      const localized = localizedCallFrom(nodePath.node, source, projectPath)
      if (localized) {
        entries.push(localized)
        return
      }
      const name = calleeName(nodePath.node.callee)
      if (!name) return
      if (VUE3_UNSUPPORTED_HELPERS.has(name)) {
        diagnostics.push({
          message: `Unsupported Vue 3 render helper "${name}" was skipped`,
          path: projectPath
        })
        return
      }
      if (VUE3_TEXT_HELPERS.has(name)) {
        const literal = staticString(nodePath.node.arguments[0])
        if (!literal || !containsHan(literal.value)) return
        entries.push(entry(literal.value, location(source, projectPath, literal.node, 'script-string')))
        return
      }
      if (!VUE3_ELEMENT_HELPERS.has(name)) return
      const args = nodePath.node.arguments
      const propsNode = args[1]
      if (propsNode && propsNode.type === 'ObjectExpression') {
        collectAllowlistedProps(propsNode, allowlist, source, projectPath, entries)
      }
      const children = args[2]
      const childLiteral = staticString(children)
      if (childLiteral && containsHan(childLiteral.value)) {
        entries.push(entry(childLiteral.value, location(source, projectPath, childLiteral.node, 'script-string')))
      }
    }
  })
}

function collectVue2(ast, source, projectPath, allowlist, entries) {
  traverse(ast, {
    CallExpression(nodePath) {
      const name = calleeName(nodePath.node.callee)
      if (!name) return
      if (VUE2_IGNORED_HELPERS.has(name)) return
      if (VUE2_TEXT_HELPERS.has(name)) {
        const literal = staticString(nodePath.node.arguments[0])
        if (!literal || !containsHan(literal.value)) return
        entries.push(entry(literal.value, location(source, projectPath, literal.node, 'script-string')))
        return
      }
      if (!VUE2_ELEMENT_HELPERS.has(name)) return
      const args = nodePath.node.arguments
      if (args.length < 2) return
      const second = args[1]
      const third = args[2]
      if (second && second.type === 'ObjectExpression') {
        collectVue2DataAttrs(second, allowlist, source, projectPath, entries)
        const childLiteral = staticString(third)
        if (childLiteral && containsHan(childLiteral.value)) {
          entries.push(entry(childLiteral.value, location(source, projectPath, childLiteral.node, 'script-string')))
        }
        return
      }
      if (isChildrenArg(second)) {
        const childLiteral = staticString(second)
        if (childLiteral && containsHan(childLiteral.value)) {
          entries.push(entry(childLiteral.value, location(source, projectPath, childLiteral.node, 'script-string')))
        }
      }
    }
  })
}

const VUE3_HELPER_PATTERN = /\b_?create(?:Element)?(?:VNode|Block|TextVNode|StaticVNode)\b/
const VUE2_HELPER_PATTERN = /\b(?:_c|_v|_m)\s*\(|\bwith\s*\(\s*this\s*\)/

function resolvePolicy(vueVersion, source) {
  if (vueVersion === 2) return 2
  if (vueVersion === 3) return 3
  const vue3 = VUE3_HELPER_PATTERN.test(source)
  const vue2 = VUE2_HELPER_PATTERN.test(source)
  if (vue3 && !vue2) return 3
  if (vue2 && !vue3) return 2
  return null
}

function looksLikeVueRenderSource(source) {
  if (typeof source !== 'string') return false
  const trimmed = source.trimStart()
  if (!trimmed || trimmed.startsWith('<')) return false
  return (
    VUE3_HELPER_PATTERN.test(source)
    || VUE2_HELPER_PATTERN.test(source)
    || /\bexport\s+(?:default\s+)?function\s+render\b/.test(source)
    || /\bfunction\s+render\s*\(/.test(source)
  )
}

function extractVueRender({ source, resource, config }) {
  if (typeof source !== 'string') throw new TypeError('Vue render extractor requires source text')
  if (!resource || typeof resource.projectPath !== 'string' || !resource.projectPath) {
    throw new TypeError('Vue render extractor requires a project path')
  }
  const projectPath = resource.projectPath.split('\\').join('/')
  const allowlist = new Set((config && config.attributeAllowlist) || DEFAULTS.attributeAllowlist)
  const vueVersion = config && config.vueVersion
  const entries = []
  const diagnostics = []
  const policy = resolvePolicy(vueVersion, source)
  if (policy == null) {
    diagnostics.push({
      message: 'Vue render-function policy could not be resolved; set vueVersion to 2 or 3',
      path: projectPath
    })
    return { entries, diagnostics }
  }
  const ast = parser.parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] })
  if (policy === 2) collectVue2(ast, source, projectPath, allowlist, entries)
  else collectVue3(ast, source, projectPath, allowlist, entries, diagnostics)
  return { entries, diagnostics }
}

module.exports = { extractVueRender, looksLikeVueRenderSource }
