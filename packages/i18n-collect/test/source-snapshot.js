const assert = require('assert')
const fs = require('fs')
const path = require('path')

function listFiles(root, {
  skipNames = ['node_modules', 'dist', 'lang'],
  extensions = null
} = {}) {
  const files = []
  const visit = directory => {
    if (!fs.existsSync(directory)) return
    for (const name of fs.readdirSync(directory)) {
      if (skipNames.includes(name)) continue
      const file = path.join(directory, name)
      if (fs.statSync(file).isDirectory()) {
        visit(file)
        continue
      }
      if (extensions && !extensions.test(name)) continue
      files.push(file)
    }
  }
  visit(root)
  return files.sort()
}

function snapshotSources(root, options = {}) {
  return new Map(listFiles(root, options).map(file => {
    const stat = fs.statSync(file)
    return [file, { content: fs.readFileSync(file), mtimeMs: stat.mtimeMs }]
  }))
}

function assertSourcesUnchanged(before, root = null) {
  for (const [file, entry] of before) {
    const relative = root ? path.relative(root, file) : file
    assert.ok(fs.existsSync(file), `missing ${relative}`)
    const stat = fs.statSync(file)
    assert.deepStrictEqual(fs.readFileSync(file), entry.content, `content changed ${relative}`)
    assert.strictEqual(stat.mtimeMs, entry.mtimeMs, `mtime changed ${relative}`)
  }
}

function leftoverArtifacts(root) {
  const names = []
  const visit = directory => {
    if (!fs.existsSync(directory)) return
    for (const name of fs.readdirSync(directory)) {
      if (
        name.startsWith('.i18n-build-staging-')
        || name.includes('.i18n-build-bak-')
        || name.startsWith('.commit-')
        || name.startsWith('.tmp-')
        || name.startsWith('.bak-')
      ) {
        names.push(path.join(directory, name))
      }
      const file = path.join(directory, name)
      if (fs.statSync(file).isDirectory() && name !== 'node_modules') visit(file)
    }
  }
  visit(root)
  return names.sort()
}

module.exports = {
  assertSourcesUnchanged,
  leftoverArtifacts,
  listFiles,
  snapshotSources
}
