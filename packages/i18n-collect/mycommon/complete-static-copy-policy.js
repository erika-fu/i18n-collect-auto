const crypto = require('crypto')
const fs = require('fs')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const parse5 = require('parse5')
const { containsHan, offsetToPosition } = require('../myloader/resource')
const {
  STRUCTURED_MESSAGE_HOSTS,
  bindingAttribute,
  emptyTemplate,
  isStructuredTag,
  parseVueTemplate,
  sourceOffset,
  structuredTextRegions,
  transparentWrapper
} = require('./template-policy-regions')

const BASELINE_VERSION = 1

const REASON_CONCATENATION = 'concatenation'
const REASON_INTERPOLATION = 'interpolation'
const REASON_CONDITIONAL = 'conditional'
const REASON_FORMATTING = 'formatting'
const REASON_STRUCTURED_FRAGMENTATION = 'structured-fragmentation'
const REASON_DYNAMIC_KEY = 'dynamic-key'

const CAPABILITY_EXPLICIT_LOCALIZATION_REQUIRED = 'explicit-localization-required'
const DISPOSITION_NEEDS_REVIEW = 'needs-review'
const SEMANTIC_ROLE_DYNAMIC_MESSAGE = 'dynamic-message'

const DIAGNOSTIC_BY_REASON = {
  [REASON_CONCATENATION]:
    'String concatenation constructs user-facing copy and cannot be safely translated as fragments.',
  [REASON_INTERPOLATION]:
    'Template interpolation constructs user-facing copy and cannot be safely translated as fragments.',
  [REASON_CONDITIONAL]:
    'Conditional construction selects user-facing copy and cannot be safely translated as fragments.',
  [REASON_FORMATTING]:
    'Formatting or plural logic constructs user-facing copy and cannot be safely translated as fragments.',
  [REASON_STRUCTURED_FRAGMENTATION]:
    'Structured markup interleaves user-facing copy with inline elements and cannot be safely translated as fragments.',
  [REASON_DYNAMIC_KEY]:
    'Dynamic key construction builds user-facing copy and cannot be safely translated as fragments.'
}

function normalizeExpressionForId(expression) {
  const source = String(expression || '')
  let result = ''
  let index = 0

  while (index < source.length) {
    const char = source[index]
    if (char === '"' || char === "'") {
      const quote = char
      result += char
      index += 1
      while (index < source.length) {
        const current = source[index]
        result += current
        index += 1
        if (current === '\\') {
          if (index < source.length) {
            result += source[index]
            index += 1
          }
          continue
        }
        if (current === quote) break
      }
      continue
    }
    if (char === '`') {
      result += '`'
      index += 1
      while (index < source.length) {
        const current = source[index]
        if (current === '`') {
          result += '`'
          index += 1
          break
        }
        if (current === '\\') {
          result += current + (source[index + 1] || '')
          index += 2
          continue
        }
        if (current === '$' && source[index + 1] === '{') {
          index += 2
          let depth = 1
          const innerStart = index
          while (index < source.length && depth > 0) {
            const inner = source[index]
            if (inner === '"' || inner === "'") {
              const quote = inner
              index += 1
              while (index < source.length) {
                const nested = source[index]
                index += 1
                if (nested === '\\') {
                  index += 1
                  continue
                }
                if (nested === quote) break
              }
              continue
            }
            if (inner === '`') {
              index += 1
              while (index < source.length) {
                const nested = source[index]
                index += 1
                if (nested === '\\') {
                  index += 1
                  continue
                }
                if (nested === '`') break
              }
              continue
            }
            if (inner === '{') depth += 1
            else if (inner === '}') depth -= 1
            if (depth > 0) index += 1
          }
          result += '${' + normalizeExpressionForId(source.slice(innerStart, index)) + '}'
          index += 1
          continue
        }
        result += current
        index += 1
      }
      continue
    }
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    result += char
    index += 1
  }
  return result
}

function dynamicCandidateId({ path: projectPath, expression, reason, occurrence }) {
  const parts = [
    String(projectPath || '').split('\\').join('/'),
    String(reason || ''),
    normalizeExpressionForId(expression)
  ]
  // The first occurrence keeps the coordinate-free fingerprint. Later copies of
  // the same expression in that resource get their own review identity.
  if (occurrence) parts.push(String(occurrence))
  const fingerprint = crypto
    .createHash('sha256')
    .update(parts.join('\0'), 'utf8')
    .digest('hex')
  return `dynamic.${fingerprint.slice(0, 6)}`
}

function assignOccurrenceIdentities(candidates) {
  const counts = new Map()
  for (const candidate of candidates) {
    const fingerprint = [
      candidate.location.path,
      candidate.reason,
      normalizeExpressionForId(candidate.expression)
    ].join('\0')
    const occurrence = counts.get(fingerprint) || 0
    counts.set(fingerprint, occurrence + 1)
    candidate.id = dynamicCandidateId({
      path: candidate.location.path,
      expression: candidate.expression,
      reason: candidate.reason,
      occurrence
    })
  }
}

const FORMAT_METHODS = new Set([
  'concat',
  'replace',
  'replaceAll',
  'padStart',
  'padEnd',
  'repeat'
])

const FORMAT_CALLEES = new Set(['format', 'sprintf', 'printf', 'plural', 'pluralize', 'ngettext'])

const SCRIPT_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'
])

function extensionOf(projectPath) {
  const base = projectPath.split('/').pop() || ''
  const index = base.lastIndexOf('.')
  return index === -1 ? '' : base.slice(index).toLowerCase()
}

function locationOf(fullSource, path, absoluteStart, absoluteEnd, kind) {
  return {
    path,
    kind,
    start: offsetToPosition(fullSource, absoluteStart),
    end: offsetToPosition(fullSource, absoluteEnd)
  }
}

function pushViolation(violations, seen, item) {
  const key = [
    item.path,
    item.reason,
    item.kind,
    item.text,
    item.start.line,
    item.start.column,
    item.end.line,
    item.end.column
  ].join('\0')
  if (seen.has(key)) return
  seen.add(key)
  violations.push(item)
}

function recordNode(violations, seen, fullSource, projectPath, node, baseOffset, reason, kind, mapOffset) {
  if (!node || node.start == null || node.end == null) return
  let text = ''
  if (node.type === 'StringLiteral') text = node.value
  else if (node.type === 'TemplateElement') text = node.value.cooked || ''
  else return
  if (!containsHan(text)) return
  const start = mapOffset ? mapOffset(node.start) : baseOffset + node.start
  const end = mapOffset ? mapOffset(node.end) : baseOffset + node.end
  const loc = locationOf(fullSource, projectPath, start, end, kind)
  pushViolation(violations, seen, {
    reason,
    path: loc.path,
    kind: loc.kind,
    start: loc.start,
    end: loc.end,
    text
  })
}

function isConcatBinary(node) {
  return node && node.type === 'BinaryExpression' && node.operator === '+'
}

function walkConcatOperands(node, visit) {
  if (!node) return
  if (isConcatBinary(node)) {
    walkConcatOperands(node.left, visit)
    walkConcatOperands(node.right, visit)
    return
  }
  visit(node)
}

function markHanLeaves(violations, seen, fullSource, projectPath, node, baseOffset, reason, kind, mapOffset) {
  if (!node) return
  if (node.type === 'StringLiteral') {
    recordNode(violations, seen, fullSource, projectPath, node, baseOffset, reason, kind, mapOffset)
    return
  }
  if (node.type === 'TemplateLiteral') {
    for (const quasi of node.quasis) {
      recordNode(
        violations,
        seen,
        fullSource,
        projectPath,
        quasi,
        baseOffset,
        reason,
        'template-literal',
        mapOffset
      )
    }
  }
}

function absoluteRange(node, baseOffset, mapOffset) {
  if (!node || node.start == null || node.end == null) return null
  const start = mapOffset ? mapOffset(node.start) : baseOffset + node.start
  const end = mapOffset ? mapOffset(node.end) : baseOffset + node.end
  return { start, end }
}

function collectHanFragmentTexts(node, fragments) {
  if (!node) return
  if (node.type === 'StringLiteral') {
    if (containsHan(node.value || '')) fragments.push(node.value)
    return
  }
  if (node.type === 'TemplateLiteral') {
    for (const quasi of node.quasis) {
      const text = quasi.value.cooked || ''
      if (containsHan(text)) fragments.push(text)
    }
    return
  }
  if (isConcatBinary(node)) {
    walkConcatOperands(node, operand => collectHanFragmentTexts(operand, fragments))
  }
}

function collectHanFragmentRecords(node, fullSource, projectPath, baseOffset, reason, kind, mapOffset, records) {
  if (!node) return
  if (node.type === 'StringLiteral') {
    if (!containsHan(node.value || '')) return
    const range = absoluteRange(node, baseOffset, mapOffset)
    if (!range) return
    const loc = locationOf(fullSource, projectPath, range.start, range.end, kind)
    records.push({
      text: node.value,
      kind: loc.kind,
      start: loc.start,
      end: loc.end
    })
    return
  }
  if (node.type === 'TemplateLiteral') {
    for (const quasi of node.quasis) {
      const text = quasi.value.cooked || ''
      if (!containsHan(text)) continue
      const range = absoluteRange(quasi, baseOffset, mapOffset)
      if (!range) continue
      const loc = locationOf(fullSource, projectPath, range.start, range.end, 'template-literal')
      records.push({
        text,
        kind: loc.kind,
        start: loc.start,
        end: loc.end
      })
    }
    return
  }
  if (isConcatBinary(node)) {
    walkConcatOperands(node, operand => {
      collectHanFragmentRecords(
        operand,
        fullSource,
        projectPath,
        baseOffset,
        reason,
        kind,
        mapOffset,
        records
      )
    })
  }
}

function pushCandidate(candidates, seenCandidates, item) {
  if (!candidates || !seenCandidates) return
  if (!item.staticFragments || item.staticFragments.length === 0) return
  const key = [
    item.location.path,
    item.reason,
    item.expression,
    item.location.start.line,
    item.location.start.column,
    item.location.end.line,
    item.location.end.column
  ].join('\0')
  if (seenCandidates.has(key)) return
  seenCandidates.add(key)
  const id = dynamicCandidateId({
    path: item.location.path,
    expression: item.expression,
    reason: item.reason
  })
  candidates.push({
    id,
    expression: item.expression,
    staticFragments: item.staticFragments,
    fragmentRecords: item.fragmentRecords || [],
    location: item.location,
    reason: item.reason,
    kind: item.kind,
    semanticRole: SEMANTIC_ROLE_DYNAMIC_MESSAGE,
    capability: CAPABILITY_EXPLICIT_LOCALIZATION_REQUIRED,
    disposition: DISPOSITION_NEEDS_REVIEW,
    diagnostic: DIAGNOSTIC_BY_REASON[item.reason] || DIAGNOSTIC_BY_REASON[REASON_INTERPOLATION]
  })
}

function recordExpressionCandidate(
  candidates,
  seenCandidates,
  fullSource,
  projectPath,
  node,
  baseOffset,
  reason,
  kind,
  mapOffset
) {
  if (!candidates || !node) return
  const range = absoluteRange(node, baseOffset, mapOffset)
  if (!range) return
  const fragments = []
  const fragmentRecords = []
  if (reason === REASON_CONDITIONAL) {
    for (const branch of [node.consequent, node.alternate]) {
      collectHanFragmentTexts(branch, fragments)
      collectHanFragmentRecords(
        branch,
        fullSource,
        projectPath,
        baseOffset,
        reason,
        branch && branch.type === 'TemplateLiteral' ? 'template-literal' : kind,
        mapOffset,
        fragmentRecords
      )
    }
  } else if (reason === REASON_FORMATTING && node.type === 'CallExpression') {
    const callee = node.callee
    if (callee && callee.type === 'MemberExpression') {
      collectHanFragmentTexts(callee.object, fragments)
      collectHanFragmentRecords(
        callee.object,
        fullSource,
        projectPath,
        baseOffset,
        reason,
        kind,
        mapOffset,
        fragmentRecords
      )
    }
    for (const arg of node.arguments || []) {
      collectHanFragmentTexts(arg, fragments)
      collectHanFragmentRecords(
        arg,
        fullSource,
        projectPath,
        baseOffset,
        reason,
        kind,
        mapOffset,
        fragmentRecords
      )
    }
  } else {
    collectHanFragmentTexts(node, fragments)
    collectHanFragmentRecords(
      node,
      fullSource,
      projectPath,
      baseOffset,
      reason,
      kind,
      mapOffset,
      fragmentRecords
    )
  }
  if (fragments.length === 0) return
  const loc = locationOf(fullSource, projectPath, range.start, range.end, kind)
  pushCandidate(candidates, seenCandidates, {
    expression: fullSource.slice(range.start, range.end),
    staticFragments: fragments,
    fragmentRecords,
    location: {
      path: loc.path,
      start: loc.start,
      end: loc.end
    },
    reason,
    kind: loc.kind
  })
}

function parseModule(source) {
  return parser.parse(source, {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true
  })
}

function flattenHtmlChildren(childNodes) {
  const flat = []
  for (const child of childNodes || []) {
    if (child.tagName && transparentWrapper(child.tagName)) {
      flat.push(...flattenHtmlChildren(child.childNodes))
      continue
    }
    flat.push(child)
  }
  return flat
}

function flattenJsxChildren(children) {
  const flat = []
  for (const child of children || []) {
    if (child.type === 'JSXElement' && transparentWrapper(jsxElementName(child))) {
      flat.push(...flattenJsxChildren(child.children))
      continue
    }
    if (child.type === 'JSXFragment') {
      flat.push(...flattenJsxChildren(child.children))
      continue
    }
    flat.push(child)
  }
  return flat
}

function recordStructuredText(violations, seen, fullSource, projectPath, absoluteStart, absoluteEnd, text, kind) {
  if (!containsHan(text)) return
  const loc = locationOf(fullSource, projectPath, absoluteStart, absoluteEnd, kind)
  pushViolation(violations, seen, {
    reason: REASON_STRUCTURED_FRAGMENTATION,
    path: loc.path,
    kind: loc.kind,
    start: loc.start,
    end: loc.end,
    text
  })
}

function collectHtmlHanTexts(node, visit) {
  if (!node) return
  if (node.nodeName === '#text') {
    if (containsHan(node.value || '')) visit(node)
    return
  }
  if (!node.childNodes) return
  for (const child of node.childNodes) collectHtmlHanTexts(child, visit)
}

function recordStructuredCandidate(
  candidates,
  seenCandidates,
  fullSource,
  projectPath,
  absoluteStart,
  absoluteEnd,
  fragments,
  fragmentRecords,
  kind
) {
  if (!candidates || fragments.length === 0) return
  const loc = locationOf(fullSource, projectPath, absoluteStart, absoluteEnd, kind)
  pushCandidate(candidates, seenCandidates, {
    expression: fullSource.slice(absoluteStart, absoluteEnd),
    staticFragments: fragments,
    fragmentRecords,
    location: {
      path: loc.path,
      start: loc.start,
      end: loc.end
    },
    reason: REASON_STRUCTURED_FRAGMENTATION,
    kind: loc.kind
  })
}

function scanHtmlStructuredElement(
  element,
  fullSource,
  projectPath,
  baseOffset,
  kind,
  violations,
  seen,
  candidates,
  seenCandidates
) {
  if (!element || !element.childNodes) return
  const host = String(element.tagName || '').toLowerCase()
  if (STRUCTURED_MESSAGE_HOSTS.has(host)) {
    const textKids = []
    const structuredKids = []
    for (const child of flattenHtmlChildren(element.childNodes)) {
      if (child.nodeName === '#text') {
        if (containsHan(child.value || '')) textKids.push(child)
        continue
      }
      if (child.nodeName === '#comment' || child.nodeName === '#document-fragment') continue
      if (child.tagName && isStructuredTag(child.tagName)) structuredKids.push(child)
    }
    if (textKids.length > 0 && structuredKids.length > 0) {
      const fragments = []
      const fragmentRecords = []
      for (const textNode of textKids) {
        const location = textNode.sourceCodeLocation
        if (!location) continue
        recordStructuredText(
          violations,
          seen,
          fullSource,
          projectPath,
          baseOffset + location.startOffset,
          baseOffset + location.endOffset,
          textNode.value,
          kind
        )
        fragments.push(textNode.value)
        const loc = locationOf(
          fullSource,
          projectPath,
          baseOffset + location.startOffset,
          baseOffset + location.endOffset,
          kind
        )
        fragmentRecords.push({
          text: textNode.value,
          kind: loc.kind,
          start: loc.start,
          end: loc.end
        })
      }
      for (const structured of structuredKids) {
        collectHtmlHanTexts(structured, textNode => {
          const location = textNode.sourceCodeLocation
          if (!location) return
          recordStructuredText(
            violations,
            seen,
            fullSource,
            projectPath,
            baseOffset + location.startOffset,
            baseOffset + location.endOffset,
            textNode.value,
            kind
          )
          fragments.push(textNode.value)
          const loc = locationOf(
            fullSource,
            projectPath,
            baseOffset + location.startOffset,
            baseOffset + location.endOffset,
            kind
          )
          fragmentRecords.push({
            text: textNode.value,
            kind: loc.kind,
            start: loc.start,
            end: loc.end
          })
        })
      }
      const hostLocation = element.sourceCodeLocation
      if (hostLocation) {
        recordStructuredCandidate(
          candidates,
          seenCandidates,
          fullSource,
          projectPath,
          baseOffset + hostLocation.startOffset,
          baseOffset + hostLocation.endOffset,
          fragments,
          fragmentRecords,
          kind
        )
      }
    }
  }
  for (const child of element.childNodes) {
    if (child.tagName) {
      scanHtmlStructuredElement(
        child,
        fullSource,
        projectPath,
        baseOffset,
        kind,
        violations,
        seen,
        candidates,
        seenCandidates
      )
    }
  }
}

function scanHtmlStructuredMarkup(
  fullSource,
  projectPath,
  templateStart,
  templateEnd,
  kind,
  violations,
  seen,
  candidates,
  seenCandidates
) {
  const fragment = fullSource.slice(templateStart, templateEnd)
  const root = parse5.parseFragment(fragment, { sourceCodeLocationInfo: true })
  for (const child of root.childNodes || []) {
    if (child.tagName) {
      scanHtmlStructuredElement(
        child,
        fullSource,
        projectPath,
        templateStart,
        kind,
        violations,
        seen,
        candidates,
        seenCandidates
      )
    }
  }
}

function jsxElementName(node) {
  if (!node || node.type !== 'JSXElement') return null
  const name = node.openingElement && node.openingElement.name
  if (!name) return null
  if (name.type === 'JSXIdentifier') return name.name
  if (name.type === 'JSXMemberExpression') {
    const parts = []
    let current = name
    while (current) {
      if (current.type === 'JSXIdentifier') {
        parts.unshift(current.name)
        break
      }
      if (current.type === 'JSXMemberExpression') {
        parts.unshift(current.property.name)
        current = current.object
        continue
      }
      return null
    }
    return parts.join('.')
  }
  return null
}

function collectJsxHanTexts(node, visit) {
  if (!node) return
  if (node.type === 'JSXText') {
    if (containsHan(node.value || '')) visit(node)
    return
  }
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
    for (const child of node.children || []) collectJsxHanTexts(child, visit)
  }
}

function scanJsxStructuredElement(
  node,
  fullSource,
  projectPath,
  baseOffset,
  violations,
  seen,
  candidates,
  seenCandidates
) {
  if (!node || node.type !== 'JSXElement') return
  const host = String(jsxElementName(node) || '').toLowerCase()
  if (STRUCTURED_MESSAGE_HOSTS.has(host)) {
    const textKids = []
    const structuredKids = []
    for (const child of flattenJsxChildren(node.children)) {
      if (child.type === 'JSXText') {
        if (containsHan(child.value || '')) textKids.push(child)
        continue
      }
      if (child.type !== 'JSXElement') continue
      const name = jsxElementName(child)
      if (isStructuredTag(name)) structuredKids.push(child)
    }
    if (textKids.length > 0 && structuredKids.length > 0) {
      const fragments = []
      const fragmentRecords = []
      for (const textNode of textKids) {
        recordStructuredText(
          violations,
          seen,
          fullSource,
          projectPath,
          baseOffset + textNode.start,
          baseOffset + textNode.end,
          textNode.value,
          'script-string'
        )
        fragments.push(textNode.value)
        const loc = locationOf(
          fullSource,
          projectPath,
          baseOffset + textNode.start,
          baseOffset + textNode.end,
          'script-string'
        )
        fragmentRecords.push({
          text: textNode.value,
          kind: loc.kind,
          start: loc.start,
          end: loc.end
        })
      }
      for (const structured of structuredKids) {
        collectJsxHanTexts(structured, textNode => {
          recordStructuredText(
            violations,
            seen,
            fullSource,
            projectPath,
            baseOffset + textNode.start,
            baseOffset + textNode.end,
            textNode.value,
            'script-string'
          )
          fragments.push(textNode.value)
          const loc = locationOf(
            fullSource,
            projectPath,
            baseOffset + textNode.start,
            baseOffset + textNode.end,
            'script-string'
          )
          fragmentRecords.push({
            text: textNode.value,
            kind: loc.kind,
            start: loc.start,
            end: loc.end
          })
        })
      }
      if (node.start != null && node.end != null) {
        recordStructuredCandidate(
          candidates,
          seenCandidates,
          fullSource,
          projectPath,
          baseOffset + node.start,
          baseOffset + node.end,
          fragments,
          fragmentRecords,
          'script-string'
        )
      }
    }
  }
}

function isComputedKeyExpression(nodePath) {
  const parent = nodePath.parent
  if (!parent) return false
  if (parent.type === 'MemberExpression' && parent.computed && parent.property === nodePath.node) {
    return true
  }
  if (parent.type === 'ObjectProperty' && parent.computed && parent.key === nodePath.node) {
    return true
  }
  return false
}

function scanAst(
  ast,
  fullSource,
  projectPath,
  baseOffset,
  violations,
  seen,
  expressionKind,
  mapOffset,
  candidates,
  seenCandidates
) {
  const scriptKind = expressionKind || 'script-string'
  traverse(ast, {
    JSXElement(nodePath) {
      scanJsxStructuredElement(
        nodePath.node,
        fullSource,
        projectPath,
        baseOffset,
        violations,
        seen,
        candidates,
        seenCandidates
      )
    },
    BinaryExpression(nodePath) {
      if (nodePath.node.operator !== '+') return
      if (nodePath.parent && isConcatBinary(nodePath.parent)) return
      if (isComputedKeyExpression(nodePath)) return
      walkConcatOperands(nodePath.node, operand => {
        markHanLeaves(
          violations,
          seen,
          fullSource,
          projectPath,
          operand,
          baseOffset,
          REASON_CONCATENATION,
          scriptKind,
          mapOffset
        )
      })
      recordExpressionCandidate(
        candidates,
        seenCandidates,
        fullSource,
        projectPath,
        nodePath.node,
        baseOffset,
        REASON_CONCATENATION,
        scriptKind,
        mapOffset
      )
    },
    TemplateLiteral(nodePath) {
      if (nodePath.node.expressions.length === 0) return
      if (isComputedKeyExpression(nodePath)) return
      for (const quasi of nodePath.node.quasis) {
        recordNode(
          violations,
          seen,
          fullSource,
          projectPath,
          quasi,
          baseOffset,
          REASON_INTERPOLATION,
          'template-literal',
          mapOffset
        )
      }
      recordExpressionCandidate(
        candidates,
        seenCandidates,
        fullSource,
        projectPath,
        nodePath.node,
        baseOffset,
        REASON_INTERPOLATION,
        'template-literal',
        mapOffset
      )
    },
    ConditionalExpression(nodePath) {
      const { consequent, alternate } = nodePath.node
      for (const branch of [consequent, alternate]) {
        if (isConcatBinary(branch)) {
          walkConcatOperands(branch, operand => {
            markHanLeaves(
              violations,
              seen,
              fullSource,
              projectPath,
              operand,
              baseOffset,
              REASON_CONDITIONAL,
              scriptKind,
              mapOffset
            )
          })
          continue
        }
        markHanLeaves(
          violations,
          seen,
          fullSource,
          projectPath,
          branch,
          baseOffset,
          REASON_CONDITIONAL,
          branch && branch.type === 'TemplateLiteral' ? 'template-literal' : scriptKind,
          mapOffset
        )
      }
      recordExpressionCandidate(
        candidates,
        seenCandidates,
        fullSource,
        projectPath,
        nodePath.node,
        baseOffset,
        REASON_CONDITIONAL,
        scriptKind,
        mapOffset
      )
    },

    CallExpression(nodePath) {
      const callee = nodePath.node.callee
      let formatting = false
      if (callee.type === 'Identifier' && FORMAT_CALLEES.has(callee.name)) formatting = true
      if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
        if (FORMAT_METHODS.has(callee.property.name)) formatting = true
      }
      if (!formatting) return
      if (callee.type === 'MemberExpression') {
        markHanLeaves(
          violations,
          seen,
          fullSource,
          projectPath,
          callee.object,
          baseOffset,
          REASON_FORMATTING,
          scriptKind,
          mapOffset
        )
      }
      for (const arg of nodePath.node.arguments) {
        markHanLeaves(
          violations,
          seen,
          fullSource,
          projectPath,
          arg,
          baseOffset,
          REASON_FORMATTING,
          scriptKind,
          mapOffset
        )
      }
      recordExpressionCandidate(
        candidates,
        seenCandidates,
        fullSource,
        projectPath,
        nodePath.node,
        baseOffset,
        REASON_FORMATTING,
        scriptKind,
        mapOffset
      )
    },

    MemberExpression(nodePath) {
      if (!nodePath.node.computed) return
      const property = nodePath.node.property
      const fragments = []
      collectHanFragmentTexts(property, fragments)
      if (fragments.length === 0) return
      if (
        property.type === 'TemplateLiteral' && property.expressions.length > 0
        || isConcatBinary(property)
      ) {
        markHanLeaves(
          violations,
          seen,
          fullSource,
          projectPath,
          property,
          baseOffset,
          REASON_DYNAMIC_KEY,
          property.type === 'TemplateLiteral' ? 'template-literal' : scriptKind,
          mapOffset
        )
        recordExpressionCandidate(
          candidates,
          seenCandidates,
          fullSource,
          projectPath,
          property,
          baseOffset,
          REASON_DYNAMIC_KEY,
          property.type === 'TemplateLiteral' ? 'template-literal' : scriptKind,
          mapOffset
        )
      }
    },

    ObjectProperty(nodePath) {
      if (!nodePath.node.computed) return
      const key = nodePath.node.key
      const fragments = []
      collectHanFragmentTexts(key, fragments)
      if (fragments.length === 0) return
      if (
        key.type === 'TemplateLiteral' && key.expressions.length > 0
        || isConcatBinary(key)
      ) {
        markHanLeaves(
          violations,
          seen,
          fullSource,
          projectPath,
          key,
          baseOffset,
          REASON_DYNAMIC_KEY,
          key.type === 'TemplateLiteral' ? 'template-literal' : scriptKind,
          mapOffset
        )
        recordExpressionCandidate(
          candidates,
          seenCandidates,
          fullSource,
          projectPath,
          key,
          baseOffset,
          REASON_DYNAMIC_KEY,
          key.type === 'TemplateLiteral' ? 'template-literal' : scriptKind,
          mapOffset
        )
      }
    }
  })
}

function scanScriptSource(
  fullSource,
  projectPath,
  baseOffset,
  slice,
  violations,
  seen,
  candidates,
  seenCandidates
) {
  const ast = parseModule(slice)
  scanAst(
    ast,
    fullSource,
    projectPath,
    baseOffset,
    violations,
    seen,
    'script-string',
    null,
    candidates,
    seenCandidates
  )
}

function scanExpressionSource(
  fullSource,
  projectPath,
  baseOffset,
  slice,
  violations,
  seen,
  candidates,
  seenCandidates
) {
  const trimmed = slice.trim()
  if (!trimmed) return
  const lead = slice.indexOf(trimmed)
  const wrapped = `(${trimmed})`
  const ast = parser.parse(wrapped, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true
  })
  // Leading '(' shifts every node start by 1 relative to the trimmed expression.
  scanAst(
    ast,
    fullSource,
    projectPath,
    baseOffset + lead - 1,
    violations,
    seen,
    'template-expression',
    null,
    candidates,
    seenCandidates
  )
}

function scanExpressionRegion(
  fullSource,
  projectPath,
  region,
  violations,
  seen,
  candidates,
  seenCandidates
) {
  const trimmed = region.value.trim()
  if (!trimmed) return
  const lead = region.value.indexOf(trimmed)
  const ast = parser.parse(`(${trimmed})`, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true
  })
  const mapOffset = offset => sourceOffset(region, lead - 1 + offset)
  scanAst(
    ast,
    fullSource,
    projectPath,
    0,
    violations,
    seen,
    'template-expression',
    mapOffset,
    candidates,
    seenCandidates
  )
}

function scanTag(source, index) {
  if (source[index] !== '<') return null
  const closing = source[index + 1] === '/'
  let cursor = index + (closing ? 2 : 1)
  if (!/[A-Za-z]/.test(source[cursor] || '')) return null
  const nameStart = cursor
  while (cursor < source.length && /[A-Za-z0-9:-]/.test(source[cursor])) cursor += 1
  const name = source.slice(nameStart, cursor)
  let selfClosing = false
  let quote = null
  while (cursor < source.length) {
    const char = source[cursor]
    if (quote) {
      if (char === quote) quote = null
      cursor += 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      cursor += 1
      continue
    }
    if (char === '/' && source[cursor + 1] === '>') selfClosing = true
    if (char === '>') {
      return {
        name,
        closing,
        selfClosing: selfClosing && !closing,
        attrs: source.slice(nameStart + name.length, selfClosing ? cursor - 1 : cursor),
        tagStart: index,
        tagEnd: cursor + 1
      }
    }
    cursor += 1
  }
  return null
}

function attributeValue(rawAttrs, name) {
  const pattern = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\\`]+))`,
    'i'
  )
  const match = pattern.exec(rawAttrs)
  if (!match) return null
  return match[1] ?? match[2] ?? match[3] ?? ''
}

function skipToClose(source, from, name) {
  const close = new RegExp(`</${name}\\s*>`, 'i')
  const found = close.exec(source.slice(from))
  if (!found) return source.length
  return from + found.index + found[0].length
}

function findBlock(source, blockName) {
  const blocks = []
  let cursor = 0
  while (cursor < source.length) {
    if (source.startsWith('<!--', cursor)) {
      const end = source.indexOf('-->', cursor + 4)
      cursor = end === -1 ? source.length : end + 3
      continue
    }
    if (source[cursor] !== '<') {
      cursor += 1
      continue
    }
    const tag = scanTag(source, cursor)
    if (!tag || tag.closing) {
      cursor = tag ? tag.tagEnd : cursor + 1
      continue
    }
    const name = tag.name.toLowerCase()
    if (name !== blockName) {
      if ((name === 'script' || name === 'style' || name === 'template') && !tag.selfClosing) {
        cursor = skipToClose(source, tag.tagEnd, name)
      } else {
        cursor = tag.tagEnd
      }
      continue
    }
    if (tag.selfClosing) {
      cursor = tag.tagEnd
      continue
    }
    const close = new RegExp(`</${name}\\s*>`, 'i')
    const found = close.exec(source.slice(tag.tagEnd))
    if (!found) break
    const contentStart = tag.tagEnd
    const contentEnd = tag.tagEnd + found.index
    blocks.push({
      start: contentStart,
      end: contentEnd,
      attrs: tag.attrs,
      lang: (attributeValue(tag.attrs, 'lang') || '').toLowerCase()
    })
    cursor = contentEnd + found[0].length
  }
  return blocks
}

function scanExpressionEnd(raw, from) {
  let depth = 0
  let quote = null
  for (let index = from; index < raw.length; index++) {
    const char = raw[index]
    if (quote) {
      if (char === '\\') {
        index += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      if (depth === 0 && raw[index + 1] === '}') return index
      if (depth > 0) depth -= 1
    }
  }
  return -1
}

function interpolationSpans(raw) {
  const spans = []
  let cursor = 0
  while (cursor < raw.length) {
    const open = raw.indexOf('{{', cursor)
    if (open === -1) break
    const end = scanExpressionEnd(raw, open + 2)
    if (end < 0) break
    spans.push({ start: open + 2, end })
    cursor = end + 2
  }
  return spans
}

function scanTemplateMarkup(
  fullSource,
  projectPath,
  templateStart,
  templateEnd,
  violations,
  seen,
  htmlKind,
  candidates,
  seenCandidates
) {
  const fragment = fullSource.slice(templateStart, templateEnd)
  const spans = interpolationSpans(fragment)
  for (const span of spans) {
    const expression = fragment.slice(span.start, span.end)
    scanExpressionSource(
      fullSource,
      projectPath,
      templateStart + span.start,
      expression,
      violations,
      seen,
      candidates,
      seenCandidates
    )
  }

  const binding = /(?:^|\s)(?::|v-bind:)([A-Za-z_:][\w:.-]*)\s*=\s*(["'])/g
  let match
  while ((match = binding.exec(fragment))) {
    const quote = match[2]
    const valueStart = match.index + match[0].length
    let cursor = valueStart
    while (cursor < fragment.length) {
      const char = fragment[cursor]
      if (char === '\\') {
        cursor += 2
        continue
      }
      if (char === quote) break
      cursor += 1
    }
    const expression = fragment.slice(valueStart, cursor)
    scanExpressionSource(
      fullSource,
      projectPath,
      templateStart + valueStart,
      expression,
      violations,
      seen,
      candidates,
      seenCandidates
    )
  }

  scanHtmlStructuredMarkup(
    fullSource,
    projectPath,
    templateStart,
    templateEnd,
    htmlKind || 'html-text',
    violations,
    seen,
    candidates,
    seenCandidates
  )
}

function scanVueSource(file, projectPath, violations, seen, options, candidates, seenCandidates) {
  const fullSource = file.source
  for (const block of findBlock(fullSource, 'script')) {
    scanScriptSource(
      fullSource,
      projectPath,
      block.start,
      fullSource.slice(block.start, block.end),
      violations,
      seen,
      candidates,
      seenCandidates
    )
  }
  const template = findBlock(fullSource, 'template').length > 0
    ? parseVueTemplate(fullSource, file, options)
    : emptyTemplate()
  for (const region of template.regions) {
    if (region.type === 'expression') {
      scanExpressionRegion(
        fullSource,
        projectPath,
        region,
        violations,
        seen,
        candidates,
        seenCandidates
      )
    } else if (region.type === 'attribute' && bindingAttribute(region.name)) {
      scanExpressionRegion(
        fullSource,
        projectPath,
        region,
        violations,
        seen,
        candidates,
        seenCandidates
      )
    }
  }
  const structured = structuredTextRegions(template)
  for (const region of structured) {
    recordStructuredText(
      violations,
      seen,
      fullSource,
      projectPath,
      region.start,
      region.end,
      region.value,
      'html-text'
    )
  }
  if (candidates && structured.length > 0) {
    const byHost = new Map()
    for (const region of structured) {
      const hostKey = region.hostId == null ? `${region.start}:${region.end}` : String(region.hostId)
      const group = byHost.get(hostKey) || []
      group.push(region)
      byHost.set(hostKey, group)
    }
    for (const group of byHost.values()) {
      if (group.length === 0) continue
      const start = group[0].hostStart != null
        ? group[0].hostStart
        : Math.min(...group.map(item => item.start))
      const end = group[0].hostEnd != null
        ? group[0].hostEnd
        : Math.max(...group.map(item => item.end))
      const fragments = group.map(item => item.value)
      const fragmentRecords = group.map(item => {
        const loc = locationOf(fullSource, projectPath, item.start, item.end, 'html-text')
        return {
          text: item.value,
          kind: loc.kind,
          start: loc.start,
          end: loc.end
        }
      })
      recordStructuredCandidate(
        candidates,
        seenCandidates,
        fullSource,
        projectPath,
        start,
        end,
        fragments,
        fragmentRecords,
        'html-text'
      )
    }
  }
}

function scanPolicyFiles(files, options = {}) {
  if (!Array.isArray(files)) throw new TypeError('scanPolicyFiles requires a files array')
  const violations = []
  const seen = new Set()
  const candidates = []
  const seenCandidates = new Set()
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || typeof file.source !== 'string') {
      throw new TypeError('each file needs path and source strings')
    }
    const projectPath = file.path.split('\\').join('/')
    const ext = extensionOf(projectPath)
    if (ext === '.vue') {
      scanVueSource(file, projectPath, violations, seen, options, candidates, seenCandidates)
    } else if (SCRIPT_EXTENSIONS.has(ext) || ext === '') {
      scanScriptSource(
        file.source,
        projectPath,
        0,
        file.source,
        violations,
        seen,
        candidates,
        seenCandidates
      )
    } else if (ext === '.html' || ext === '.htm') {
      scanTemplateMarkup(
        file.source,
        projectPath,
        0,
        file.source.length,
        violations,
        seen,
        'static-html-text',
        candidates,
        seenCandidates
      )
    }
  }
  violations.sort((left, right) => {
    const byPath = left.path.localeCompare(right.path)
    if (byPath) return byPath
    if (left.start.line !== right.start.line) return left.start.line - right.start.line
    if (left.start.column !== right.start.column) return left.start.column - right.start.column
    return left.reason.localeCompare(right.reason)
  })
  candidates.sort((left, right) => {
    const byPath = left.location.path.localeCompare(right.location.path)
    if (byPath) return byPath
    if (left.location.start.line !== right.location.start.line) {
      return left.location.start.line - right.location.start.line
    }
    if (left.location.start.column !== right.location.start.column) {
      return left.location.start.column - right.location.start.column
    }
    return left.expression.localeCompare(right.expression)
  })
  assignOccurrenceIdentities(candidates)
  return { violations, candidates }
}

function scanCompleteStaticCopyPolicy(files, options = {}) {
  return scanPolicyFiles(files, options).violations
}

function discoverDynamicMessageCandidates(files, options = {}) {
  return scanPolicyFiles(files, options).candidates.map(candidate => ({
    id: candidate.id,
    expression: candidate.expression,
    staticFragments: candidate.staticFragments,
    fragmentRecords: candidate.fragmentRecords,
    location: candidate.location,
    reason: candidate.reason,
    kind: candidate.kind,
    sourceSurfaceHint: candidate.kind,
    semanticRole: candidate.semanticRole,
    capability: candidate.capability,
    disposition: candidate.disposition,
    diagnostic: candidate.diagnostic
  }))
}

function positionKey(position) {
  return `${position.line}:${position.column}`
}

function exactViolationKey(item) {
  return [
    item.path,
    item.reason,
    item.kind,
    item.text,
    positionKey(item.start),
    positionKey(item.end)
  ].join('\0')
}

function softViolationKeys(item) {
  return [
    `${item.path}\0${item.reason}\0${item.kind}\0${positionKey(item.start)}`,
    `${item.path}\0${item.reason}\0${item.kind}\0${item.text}`
  ]
}

function normalizeViolation(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`complete-static-copy baseline violations[${index}] must be an object`)
  }
  for (const field of ['reason', 'path', 'kind', 'text']) {
    if (typeof raw[field] !== 'string' || !raw[field]) {
      throw new Error(`complete-static-copy baseline violations[${index}].${field} must be a non-empty string`)
    }
  }
  for (const field of ['start', 'end']) {
    const position = raw[field]
    if (!position || typeof position !== 'object' || Array.isArray(position)) {
      throw new Error(`complete-static-copy baseline violations[${index}].${field} must be a position`)
    }
    if (!Number.isInteger(position.line) || position.line < 1) {
      throw new Error(`complete-static-copy baseline violations[${index}].${field}.line must be a positive integer`)
    }
    if (!Number.isInteger(position.column) || position.column < 0) {
      throw new Error(`complete-static-copy baseline violations[${index}].${field}.column must be a non-negative integer`)
    }
  }
  return {
    reason: raw.reason,
    path: String(raw.path).split('\\').join('/'),
    kind: raw.kind,
    start: { line: raw.start.line, column: raw.start.column },
    end: { line: raw.end.line, column: raw.end.column },
    text: raw.text
  }
}

function readPolicyBaseline(filePath) {
  if (!fs.existsSync(filePath)) return []
  let document
  try {
    document = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`complete-static-copy baseline is not valid JSON: ${error.message}`)
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('complete-static-copy baseline must be an object')
  }
  if (document.version !== BASELINE_VERSION) {
    throw new Error(`complete-static-copy baseline version ${document.version} is unsupported; supported version is ${BASELINE_VERSION}`)
  }
  if (!Array.isArray(document.violations)) {
    throw new Error('complete-static-copy baseline must include a violations array')
  }
  return document.violations.map((item, index) => normalizeViolation(item, index))
}

function comparePolicyBaseline(current, baseline) {
  if (!Array.isArray(current) || !Array.isArray(baseline)) {
    throw new TypeError('comparePolicyBaseline requires current and baseline arrays')
  }
  const exact = new Map(baseline.map(item => [exactViolationKey(item), item]))
  const soft = new Map()
  for (const item of baseline) {
    for (const key of softViolationKeys(item)) {
      if (!soft.has(key)) soft.set(key, item)
    }
  }
  const grandfathered = []
  const newViolations = []
  const modifiedViolations = []
  for (const item of current) {
    const exactKey = exactViolationKey(item)
    if (exact.has(exactKey)) {
      grandfathered.push(item)
      continue
    }
    const related = softViolationKeys(item).map(key => soft.get(key)).find(Boolean)
    if (related) modifiedViolations.push({ current: item, baseline: related })
    else newViolations.push(item)
  }
  return { grandfathered, newViolations, modifiedViolations }
}

module.exports = {
  BASELINE_VERSION,
  REASON_CONCATENATION,
  REASON_CONDITIONAL,
  REASON_DYNAMIC_KEY,
  REASON_FORMATTING,
  REASON_INTERPOLATION,
  REASON_STRUCTURED_FRAGMENTATION,
  CAPABILITY_EXPLICIT_LOCALIZATION_REQUIRED,
  comparePolicyBaseline,
  discoverDynamicMessageCandidates,
  dynamicCandidateId,
  normalizeExpressionForId,
  readPolicyBaseline,
  scanCompleteStaticCopyPolicy
}
