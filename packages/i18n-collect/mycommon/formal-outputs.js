const fs = require('fs')
const path = require('path')
const { catalogFiles, loadConfig } = require('./config')

function formalOutputPaths(config) {
  const files = catalogFiles(config)
  return [
    config.outputPath,
    config.sourceMapFilename,
    files.messages,
    files.metadata
  ]
}

function snapshotFormalOutputs(root, paths) {
  return paths.map(relative => {
    const file = path.join(root, relative)
    const exists = fs.existsSync(file)
    return {
      path: relative,
      exists,
      content: exists ? fs.readFileSync(file) : null
    }
  })
}

function changedFormalOutputs(root, snapshot) {
  const changed = []
  for (const entry of snapshot) {
    const file = path.join(root, entry.path)
    const exists = fs.existsSync(file)
    if (exists !== entry.exists) {
      changed.push(entry.path)
      continue
    }
    if (exists && Buffer.compare(fs.readFileSync(file), entry.content) !== 0) {
      changed.push(entry.path)
    }
  }
  return changed
}

function restoreFormalOutputs(root, snapshot) {
  for (const entry of snapshot) {
    const file = path.join(root, entry.path)
    if (!entry.exists) {
      if (fs.existsSync(file)) fs.unlinkSync(file)
      continue
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, entry.content)
  }
}

function loadFormalOutputPaths(root) {
  const config = loadConfig({ root })
  return formalOutputPaths(config)
}

module.exports = {
  changedFormalOutputs,
  formalOutputPaths,
  loadFormalOutputPaths,
  restoreFormalOutputs,
  snapshotFormalOutputs
}
