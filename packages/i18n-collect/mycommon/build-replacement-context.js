const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const contexts = new Map()

function resolveRoot(root) {
  return path.resolve(root)
}

function contextFile(root) {
  const id = crypto.createHash('sha1').update(resolveRoot(root)).digest('hex')
  return path.join(os.tmpdir(), `i18n-collect-build-ctx-${id}.json`)
}

function setBuildReplacementContext(root, context) {
  const resolved = resolveRoot(root)
  contexts.set(resolved, context || null)
  const file = contextFile(resolved)
  if (context && Array.isArray(context.occurrences)) {
    fs.writeFileSync(file, `${JSON.stringify({
      occurrences: context.occurrences,
      sourceCatalog: context.sourceCatalog || null
    })}\n`)
    return
  }
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

function getBuildReplacementContext(root) {
  const resolved = resolveRoot(root)
  const memory = contexts.get(resolved)
  if (memory && Array.isArray(memory.occurrences)) return memory
  const file = contextFile(resolved)
  if (!fs.existsSync(file)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed || !Array.isArray(parsed.occurrences)) return null
    return parsed
  } catch (error) {
    return null
  }
}

function clearBuildReplacementContext(root) {
  const resolved = resolveRoot(root)
  contexts.delete(resolved)
  const file = contextFile(resolved)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

module.exports = {
  clearBuildReplacementContext,
  getBuildReplacementContext,
  setBuildReplacementContext
}
