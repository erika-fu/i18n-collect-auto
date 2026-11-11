const fs = require('fs')
const path = require('path')
const { isResourceIncluded } = require('../myloader/resource')

const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
  '.vue', '.html', '.htm',
  '.css', '.scss', '.sass', '.less', '.styl', '.stylus'
])

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.cache'
])

function listSourceFileEntries(root, config) {
  const files = []
  const visit = directory => {
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      return
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
      const extension = path.posix.extname(projectPath).toLowerCase()
      if (!SOURCE_EXTENSIONS.has(extension)) continue
      if (!isResourceIncluded(projectPath, config)) continue
      files.push({ absolute, projectPath })
    }
  }
  visit(root)
  return files.sort((left, right) => left.projectPath.localeCompare(right.projectPath))
}

function listProjectSources(root, config) {
  return listSourceFileEntries(root, config).map(file => ({
    path: file.projectPath,
    absolutePath: file.absolute,
    source: fs.readFileSync(file.absolute, 'utf8')
  }))
}

module.exports = {
  SOURCE_EXTENSIONS,
  SKIP_DIRECTORIES,
  listProjectSources,
  listSourceFileEntries
}
