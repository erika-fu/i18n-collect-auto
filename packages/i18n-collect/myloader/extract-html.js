const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const { DEFAULTS } = require('../mycommon/config')
const {
  REPRESENTATION_LOCALIZED_CALL,
  isStaticLocalizationKeyArgument,
  staticLocalizationCall
} = require('../mycommon/localized-call')
const { contextSuppresses } = require('./context-filter')
const { babelComments, directivesBefore, keyConflict, runtimeKeyConflict, scanDirectives } = require('./directives')
const { containsHan, offsetToPosition } = require('./resource')
const { parseTemplate } = require('./template-parser')

const BINDING_MODIFIERS = new Set(['prop', 'sync', 'camel'])

function failAt(source, offset, message) {
  const bounded = Math.max(0, Math.min(offset, source.length))
  const error = new Error(message)
  error.loc = offsetToPosition(source, bounded)
  return error
}

function projectPathOf(resource) {
  return resource.projectPath.split('\\').join('/')
}

function classifyAttribute(name, allowlist) {
  let body = name
  let dynamic = false
  if (body.startsWith('v-bind:')) {
    dynamic = true
    body = body.slice('v-bind:'.length)
  } else if (body.startsWith(':')) {
    dynamic = true
    body = body.slice(1)
  }
  if (!dynamic) return allowlist.has(name) ? { dynamic: false } : null
  if (!body || body.startsWith('[')) return null
  const parts = body.split('.')
  const base = parts.shift()
  if (!base || parts.some(part => !BINDING_MODIFIERS.has(part))) return null
  return allowlist.has(base) ? { dynamic: true } : null
}

function attachedComments(ast) {
  const comments = []
  const seen = new Set()
  traverse(ast, {
    enter(nodePath) {
      const node = nodePath.node
      for (const key of ['leadingComments', 'innerComments', 'trailingComments']) {
        for (const comment of node[key] || []) {
          if (seen.has(comment)) continue
          seen.add(comment)
          comments.push(comment)
        }
      }
    }
  })
  return comments
}

function constructDirectives(template, source, fail) {
  const directives = scanDirectives(template.comments, fail)
  const found = new Map()
  if (directives.length === 0) return found
  for (const construct of template.constructs) {
    const directive = directivesBefore(source, directives, construct.start, fail)
    if (directive.exclude || directive.key) found.set(construct.id, directive)
  }
  return found
}

function extractHtml({ source, resource, config }) {
  if (typeof source !== 'string') throw new TypeError('HTML extractor requires source text')
  if (!resource || typeof resource.projectPath !== 'string' || !resource.projectPath) {
    throw new TypeError('HTML extractor requires a project path')
  }
  const projectPath = projectPathOf(resource)
  const standalone = resource.block === 'html'
  const textKind = standalone ? 'static-html-text' : 'html-text'
  const attributeKind = standalone ? 'static-html-attribute' : 'html-attribute'
  const allowlist = new Set((config && config.attributeAllowlist) || DEFAULTS.attributeAllowlist)
  const contextFilters = config && config.contextFilters
  const template = parseTemplate({ source, resource, standalone, config })
  const entries = []

  function push(value, kind, start, end, owners, suppress, key, representation, params) {
    entries.push({
      value,
      locations: [{
        path: projectPath,
        kind,
        start: offsetToPosition(source, start),
        end: offsetToPosition(source, end)
      }],
      owners: owners.slice(),
      start,
      suppress: suppress === true,
      key: key || null,
      representation: representation || null,
      paramsKind: params && params.paramsKind ? params.paramsKind : null,
      paramNames: params && Array.isArray(params.paramNames) ? params.paramNames : null
    })
  }

  function collectExpression(region, kind) {
    let expression
    try {
      expression = parser.parseExpression(region.value)
    } catch (error) {
      const pos = Number.isInteger(error.pos) ? error.pos : 0
      const offset = region.sourceOffsets[Math.max(0, Math.min(pos, region.sourceOffsets.length - 1))]
      throw failAt(source, offset, error.message)
    }
    const ast = {
      type: 'File',
      program: {
        type: 'Program',
        sourceType: 'module',
        directives: [],
        body: [{ type: 'ExpressionStatement', expression }]
      }
    }
    const fail = (offset, message) => {
      const sourceOffset = region.sourceOffsets[Math.max(0, Math.min(offset, region.sourceOffsets.length - 1))]
      throw failAt(source, sourceOffset, message)
    }
    const directives = scanDirectives(babelComments(attachedComments(ast)), fail)
    const excludeStringDelimiters = kind === 'html-attribute'
    traverse(ast, {
      CallExpression(nodePath) {
        const call = staticLocalizationCall(nodePath.node)
        if (!call) return
        const directive = directivesBefore(region.value, directives, nodePath.node.start, fail)
        if (directive.exclude) return
        if (contextSuppresses(nodePath, contextFilters)) return
        if (directive.key && directive.key !== call.key) {
          fail(nodePath.node.start, runtimeKeyConflict(directive.key, call.key))
        }
        const startIndex = excludeStringDelimiters ? call.argument.start + 1 : call.argument.start
        const endIndex = excludeStringDelimiters ? call.argument.end - 1 : call.argument.end
        push(
          '',
          kind,
          region.sourceOffsets[startIndex],
          region.sourceOffsets[endIndex],
          region.owners,
          false,
          call.key,
          REPRESENTATION_LOCALIZED_CALL,
          { paramsKind: call.paramsKind, paramNames: call.paramNames }
        )
      },
      StringLiteral(nodePath) {
        if (isStaticLocalizationKeyArgument(nodePath)) return
        const value = nodePath.node.value
        if (!containsHan(value)) return
        if (contextSuppresses(nodePath, contextFilters)) return
        const directive = directivesBefore(region.value, directives, nodePath.node.start, fail)
        const startIndex = excludeStringDelimiters ? nodePath.node.start + 1 : nodePath.node.start
        const endIndex = excludeStringDelimiters ? nodePath.node.end - 1 : nodePath.node.end
        push(
          value,
          kind,
          region.sourceOffsets[startIndex],
          region.sourceOffsets[endIndex],
          region.owners,
          directive.exclude,
          directive.key
        )
      },
      TemplateLiteral(nodePath) {
        if (contextSuppresses(nodePath, contextFilters)) return
        let pending = directivesBefore(region.value, directives, nodePath.node.start, fail)
        for (const quasi of nodePath.node.quasis) {
          const value = quasi.value.cooked
          if (!value || !containsHan(value)) continue
          const applied = pending
          pending = null
          push(
            value,
            kind,
            region.sourceOffsets[quasi.start],
            region.sourceOffsets[quasi.end],
            region.owners,
            Boolean(applied && applied.exclude),
            applied && applied.key
          )
        }
      }
    })
  }

  for (const region of template.regions) {
    if (region.type === 'text') {
      if (containsHan(region.value)) {
        if (region.untrusted) {
          throw failAt(source, region.start, 'HTML text location is untrustworthy')
        }
        push(region.value, textKind, region.start, region.end, region.owners)
      }
      continue
    }
    if (region.type === 'expression') {
      collectExpression(region, region.expressionKind)
      continue
    }
    const classified = classifyAttribute(region.name, allowlist)
    if (!classified || (standalone && classified.dynamic)) continue
    if (classified.dynamic) {
      collectExpression(region, 'html-attribute')
    } else if (containsHan(region.value)) {
      push(region.value, attributeKind, region.start, region.end, region.owners)
    }
  }

  const marked = constructDirectives(template, source, (offset, message) => {
    throw failAt(source, offset, message)
  })
  const dropped = new Set()
  for (const [constructId, directive] of marked) {
    let earliest = null
    for (const entry of entries) {
      if (!entry.owners.includes(constructId)) continue
      if (!earliest || entry.start < earliest.start) earliest = entry
    }
    if (!earliest) continue
    if (directive.exclude) dropped.add(earliest)
    if (!directive.key || directive.exclude || earliest.suppress) continue
    if (earliest.key && earliest.key !== directive.key) {
      const message = earliest.representation === REPRESENTATION_LOCALIZED_CALL
        ? runtimeKeyConflict(directive.key, earliest.key)
        : keyConflict(directive.key, earliest.key)
      throw failAt(source, earliest.start, message)
    }
    earliest.key = directive.key
  }
  return {
    entries: entries.filter(entry => !entry.suppress && !dropped.has(entry)).map(entry => {
      const mapped = { value: entry.value, locations: entry.locations }
      if (entry.key) mapped.key = entry.key
      if (entry.representation) mapped.representation = entry.representation
      if (entry.representation === REPRESENTATION_LOCALIZED_CALL) {
        mapped.paramsKind = entry.paramsKind || 'none'
        mapped.paramNames = Array.isArray(entry.paramNames) ? entry.paramNames : []
      }
      return mapped
    }),
    warnings: template.warnings
  }
}

module.exports = { extractHtml }
