const fs = require('fs')
const path = require('path')
const { SKIP_DIRECTORIES } = require('./project-sources')
const { isGlobPattern, scopeMatches } = require('./scope-pattern')
const { extractHtml } = require('../myloader/extract-html')
const { auditStyle } = require('../myloader/audit-style')

const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const STYLE_EXTENSIONS = new Set([
  '.css', '.scss', '.sass', '.less', '.styl', '.stylus'
])

function auditFailure(message) {
  const error = new Error(message)
  error.kind = 'collection'
  return error
}

function extensionOf(projectPath) {
  return path.posix.extname(String(projectPath).split('\\').join('/')).toLowerCase()
}

function styleLangFor(projectPath) {
  const ext = extensionOf(projectPath)
  if (ext === '.scss') return 'scss'
  if (ext === '.sass') return 'sass'
  if (ext === '.less') return 'less'
  if (ext === '.styl' || ext === '.stylus') return 'stylus'
  return 'css'
}

function isAuditExtension(projectPath) {
  const ext = extensionOf(projectPath)
  return HTML_EXTENSIONS.has(ext) || STYLE_EXTENSIONS.has(ext)
}

function listMatchedFiles(root, patterns) {
  const files = []
  const visit = directory => {
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      throw auditFailure(
        `static audit input unreadable: ${path.relative(root, directory).split(path.sep).join('/') || '.'} (${error.code || error.message})`
      )
    }
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        visit(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const projectPath = path.relative(root, absolute).split(path.sep).join('/')
      if (!patterns.some(pattern => scopeMatches(projectPath, pattern))) continue
      files.push({ absolute, projectPath })
    }
  }
  visit(root)
  return files.sort((left, right) => left.projectPath.localeCompare(right.projectPath))
}

function assertConcreteInputsExist(root, patterns) {
  for (const pattern of patterns) {
    if (isGlobPattern(pattern)) continue
    const absolute = path.resolve(root, pattern)
    let stat
    try {
      stat = fs.statSync(absolute)
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw auditFailure(`static audit input missing: ${pattern}`)
      }
      throw auditFailure(
        `static audit input unreadable: ${pattern} (${error.code || error.message})`
      )
    }
    if (isAuditExtension(pattern) && !stat.isFile()) {
      throw auditFailure(`static audit input unreadable: ${pattern}`)
    }
  }
}

function readAuditSource(absolute, projectPath) {
  let source
  try {
    source = fs.readFileSync(absolute, 'utf8')
  } catch (error) {
    throw auditFailure(
      `static audit input unreadable: ${projectPath} (${error.code || error.message})`
    )
  }
  if (typeof source !== 'string') {
    throw auditFailure(`static audit input unreadable: ${projectPath}`)
  }
  return source
}

function snapshotForFile(file, config) {
  const ext = extensionOf(file.projectPath)
  if (!isAuditExtension(file.projectPath)) {
    throw auditFailure(
      `static audit input unsupported: ${file.projectPath} (expected HTML or style source)`
    )
  }
  const source = readAuditSource(file.absolute, file.projectPath)
  const absolutePath = file.absolute
  try {
    if (HTML_EXTENSIONS.has(ext)) {
      const identity = `${file.projectPath}::html`
      const resource = {
        projectPath: file.projectPath,
        absolutePath,
        block: 'html',
        lang: 'html',
        identity
      }
      const { entries } = extractHtml({ source, resource, config })
      return { identity, projectPath: file.projectPath, entries }
    }
    const lang = styleLangFor(file.projectPath)
    const identity = `${file.projectPath}::style[index=0;lang=${lang}]`
    const resource = {
      projectPath: file.projectPath,
      absolutePath,
      block: 'style',
      lang,
      identity
    }
    const { entries } = auditStyle({ source, resource, config })
    return { identity, projectPath: file.projectPath, entries }
  } catch (error) {
    if (error && error.kind === 'collection') throw error
    const detail = error && error.message ? error.message : String(error)
    throw auditFailure(`static audit input unparseable: ${file.projectPath} (${detail})`)
  }
}

function collectStaticAuditSnapshots({ root, config } = {}) {
  if (!root || typeof root !== 'string') {
    throw new TypeError('collectStaticAuditSnapshots requires a project root')
  }
  const patterns = config && config.staticAudit && Array.isArray(config.staticAudit.include)
    ? config.staticAudit.include
    : []
  if (patterns.length === 0) return []

  assertConcreteInputsExist(root, patterns)
  const files = listMatchedFiles(root, patterns)
  return files.map(file => snapshotForFile(file, config || {}))
}

module.exports = {
  collectStaticAuditSnapshots
}
