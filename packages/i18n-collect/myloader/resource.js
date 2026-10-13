const path = require('path')
const { scopeMatches } = require('../mycommon/scope-pattern')

const SCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])

function containsHan(value) {
  return typeof value === 'string' && /\p{Script=Han}/u.test(value)
}

function offsetToPosition(source, offset) {
  if (typeof source !== 'string' || !Number.isInteger(offset) || offset < 0 || offset > source.length) {
    throw new RangeError('Offset is outside the source')
  }
  let line = 1
  let column = 0
  for (let index = 0; index < offset; index++) {
    const char = source[index]
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      line += 1
      column = 0
    } else {
      column += 1
    }
  }
  return { line, column }
}

function queryFreePath(resourcePath) {
  return String(resourcePath).split('?')[0].split('#')[0].replace(/\\/g, '/')
}

function projectPathFrom(root, resourcePath) {
  const absolute = path.resolve(root, queryFreePath(resourcePath))
  return path.relative(root, absolute).split(path.sep).join('/')
}

function parseQuery(resourceQuery) {
  const query = resourceQuery ? String(resourceQuery) : ''
  const raw = query.startsWith('?') ? query.slice(1) : query
  return { query, params: new URLSearchParams(raw) }
}

function present(params, name) {
  if (!params.has(name)) return null
  const value = params.get(name)
  return value ? value : null
}

function styleIndexOf(params) {
  const raw = present(params, 'index')
  if (raw == null) return 0
  const index = Number(raw)
  return Number.isInteger(index) && index >= 0 ? index : 0
}

function formatIdentity({ projectPath, block, styleIndex, lang, vue }) {
  if (block === 'script' && vue) return `${projectPath}::script[lang=${lang}]`
  if (block === 'script') return `${projectPath}::script`
  if (block === 'template') return `${projectPath}::template[lang=${lang}]`
  if (block === 'html') return `${projectPath}::html`
  if (block === 'style') return `${projectPath}::style[index=${styleIndex};lang=${lang}]`
  return null
}

function describeResource({ root, resourcePath, resourceQuery = '', styleExtensions = ['.css'] }) {
  const absolutePath = path.resolve(root, queryFreePath(resourcePath))
  const projectPath = projectPathFrom(root, resourcePath)
  const { query, params } = parseQuery(resourceQuery)
  const extension = path.posix.extname(projectPath).toLowerCase()
  const styleExtensionSet = new Set(styleExtensions.map(item => String(item).toLowerCase()))
  const vue = extension === '.vue'
  const type = present(params, 'type')
  let block = null
  let styleIndex = null
  let lang = null

  if (vue && type === 'script') {
    block = 'script'
    lang = present(params, 'lang') || 'js'
  } else if (vue && type === 'template') {
    block = 'template'
    lang = present(params, 'lang') || 'html'
  } else if (vue && type === 'style') {
    block = 'style'
    styleIndex = styleIndexOf(params)
    lang = present(params, 'lang') || 'css'
  } else if (params.has('vue') && type === 'template' && !SCRIPT_EXTENSIONS.has(extension)) {
    block = 'template'
    lang = present(params, 'lang') || 'html'
  } else if (params.has('vue') && type === 'style' && !SCRIPT_EXTENSIONS.has(extension)) {
    block = 'style'
    styleIndex = styleIndexOf(params)
    lang = (present(params, 'lang') || extension.slice(1) || 'css').toLowerCase()
  } else if (SCRIPT_EXTENSIONS.has(extension)) {
    block = 'script'
  } else if (extension === '.html') {
    block = 'html'
  } else if (styleExtensionSet.has(extension)) {
    block = 'style'
    styleIndex = 0
    lang = extension.slice(1).toLowerCase()
  }

  return {
    absolutePath,
    projectPath,
    query,
    block,
    styleIndex,
    lang,
    sourceOffset: 0,
    identity: formatIdentity({ projectPath, block, styleIndex, lang, vue })
  }
}

function isResourceIncluded(projectPath, { include = [], exclude = [] } = {}) {
  const candidate = queryFreePath(projectPath)
  const included = include.length === 0 || include.some(pattern => scopeMatches(candidate, pattern))
  if (!included) return false
  return !exclude.some(pattern => scopeMatches(candidate, pattern))
}

module.exports = {
  containsHan,
  offsetToPosition,
  describeResource,
  isResourceIncluded
}
