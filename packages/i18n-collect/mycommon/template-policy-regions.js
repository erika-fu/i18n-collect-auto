const path = require('path')
const { parseTemplate } = require('../myloader/template-parser')
const { containsHan } = require('../myloader/resource')

const BINDING_MODIFIERS = new Set(['prop', 'sync', 'camel'])
const STRUCTURED_INLINE_TAGS = new Set([
  'a', 'em', 'strong', 'b', 'i', 'mark', 'u', 's', 'del', 'ins',
  'button', 'input', 'select', 'textarea', 'code', 'kbd', 'abbr', 'slot'
])
const TRANSPARENT_WRAPPER_TAGS = new Set(['span', 'font'])
const STRUCTURED_MESSAGE_HOSTS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th',
  'dt', 'dd', 'caption', 'summary', 'legend', 'figcaption'
])
const STANDARD_HTML_ELEMENTS = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo', 'blockquote',
  'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'datalist',
  'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr',
  'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map',
  'mark', 'menu', 'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option', 'output',
  'p', 'param', 'picture', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'search',
  'section', 'select', 'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr',
  'track', 'u', 'ul', 'var', 'video', 'wbr'
])

function emptyTemplate() {
  return { constructs: [], comments: [], regions: [], warnings: [] }
}

function parseVueTemplate(source, file, options = {}) {
  const projectPath = file.path.split('\\').join('/')
  return parseTemplate({
    source,
    resource: {
      absolutePath: file.absolutePath || path.resolve(options.root || process.cwd(), projectPath),
      projectPath
    },
    standalone: false,
    config: {
      vueVersion: file.vueVersion == null ? options.vueVersion : file.vueVersion
    }
  })
}

function bindingAttribute(name) {
  let body = String(name || '')
  if (body.startsWith('v-bind:')) body = body.slice('v-bind:'.length)
  else if (body.startsWith(':')) body = body.slice(1)
  else return null
  if (!body || body.startsWith('[')) return null
  const parts = body.split('.')
  const base = parts.shift()
  if (!base || parts.some(part => !BINDING_MODIFIERS.has(part))) return null
  return { base }
}

function sourceOffset(region, index) {
  const offsets = region.sourceOffsets || []
  if (offsets.length === 0) return region.start + index
  return offsets[Math.max(0, Math.min(index, offsets.length - 1))]
}

function isStructuredTag(name) {
  const lower = String(name || '').toLowerCase()
  if (!lower) return false
  if (STRUCTURED_INLINE_TAGS.has(lower) || lower.includes('-')) return true
  return !STANDARD_HTML_ELEMENTS.has(lower)
}

function transparentWrapper(name) {
  return TRANSPARENT_WRAPPER_TAGS.has(String(name || '').toLowerCase())
}

function structuredTextRegions(template) {
  const children = new Map()
  const textRegionsByOwner = new Map()
  for (const construct of template.constructs) {
    const siblings = children.get(construct.parentId) || []
    siblings.push(construct)
    children.set(construct.parentId, siblings)
  }
  for (const region of template.regions) {
    if (region.type !== 'text' || !containsHan(region.value)) continue
    for (const owner of region.owners) {
      const owned = textRegionsByOwner.get(owner) || []
      owned.push(region)
      textRegionsByOwner.set(owner, owned)
    }
  }

  function flattened(parentId) {
    const found = []
    for (const child of children.get(parentId) || []) {
      if (
        child.kind === 'element' &&
        transparentWrapper(child.name)
      ) {
        found.push(...flattened(child.id))
      } else {
        found.push(child)
      }
    }
    return found
  }

  function textRegionsOwnedBy(constructId) {
    return textRegionsByOwner.get(constructId) || []
  }

  const selected = []
  const seen = new Set()
  for (const host of template.constructs) {
    if (host.kind !== 'element') continue
    if (!STRUCTURED_MESSAGE_HOSTS.has(String(host.name || '').toLowerCase())) continue
    const direct = flattened(host.id)
    const textChildren = direct.filter(child => (
      child.kind === 'text' && textRegionsOwnedBy(child.id).length > 0
    ))
    const structuredChildren = direct.filter(child => (
      child.kind === 'element' && isStructuredTag(child.name)
    ))
    if (textChildren.length === 0 || structuredChildren.length === 0) continue
    for (const child of [...textChildren, ...structuredChildren]) {
      for (const region of textRegionsOwnedBy(child.id)) {
        const key = `${region.start}:${region.end}`
        if (seen.has(key)) continue
        seen.add(key)
        selected.push({
          ...region,
          hostId: host.id,
          hostStart: host.start,
          hostEnd: host.end
        })
      }
    }
  }
  return selected
}

module.exports = {
  STRUCTURED_MESSAGE_HOSTS,
  bindingAttribute,
  emptyTemplate,
  isStructuredTag,
  parseVueTemplate,
  sourceOffset,
  structuredTextRegions,
  transparentWrapper
}
