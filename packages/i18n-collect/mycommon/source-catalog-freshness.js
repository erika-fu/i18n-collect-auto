const fs = require('fs')
const path = require('path')
const {
  analyzeProject,
  buildSourceCatalog
} = require('./project-analysis')
const { listProjectSources } = require('./project-sources')
const { keyFor } = require('./store')

const SOURCE_CATALOG_FILE = 'source-catalog.json'

function commandError(kind, stage, message) {
  const error = new Error(message)
  error.kind = kind
  error.stage = stage
  return error
}

function sourceCatalogPath(config) {
  return path.posix.join(config.catalogDir, SOURCE_CATALOG_FILE)
}

function readCommittedSourceCatalog(root, config) {
  const relative = sourceCatalogPath(config)
  const file = path.join(root, relative)
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw commandError(
      'configuration',
      'configuration',
      `missing source catalog: ${relative}`
    )
  }
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw commandError(
      'configuration',
      'configuration',
      `source catalog could not be read: ${relative}`
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw commandError(
      'configuration',
      'configuration',
      `source catalog must be a JSON object: ${relative}`
    )
  }
  for (const key of Object.keys(parsed)) {
    if (typeof parsed[key] !== 'string') {
      throw commandError(
        'configuration',
        'configuration',
        `source catalog key "${key}" must be a string`
      )
    }
  }
  return parsed
}

function catalogEqual(left, right) {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.length !== rightKeys.length) return false
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index]
    if (key !== rightKeys[index]) return false
    if (left[key] !== right[key]) return false
  }
  return true
}

function occurrencesFromAnalysis(analysis) {
  const items = []
  for (const finding of analysis.runtimeMessages || []) {
    if (!finding || !finding.location || typeof finding.text !== 'string') continue
    items.push({
      key: finding.key || keyFor(finding.text),
      source: finding.text,
      location: {
        path: finding.location.path,
        kind: finding.semanticRole,
        start: finding.location.start,
        end: finding.location.end
      },
      status: 'active',
      reportedAmbiguity: false
    })
  }
  return items
}

function assertSourceCatalogFresh(root, config) {
  const committed = readCommittedSourceCatalog(root, config)
  const sources = listProjectSources(config.root || root, config)
  const analysis = analyzeProject({ files: sources, config })
  let expected
  try {
    expected = buildSourceCatalog(analysis)
  } catch (error) {
    const failure = commandError(
      'collection',
      'analysis',
      error && error.message ? error.message : String(error)
    )
    throw failure
  }
  if (!catalogEqual(expected, committed)) {
    throw commandError(
      'collection',
      'analysis',
      'source analysis no longer matches the committed source catalog; run scan before build'
    )
  }
  return {
    analysis,
    sourceCatalog: committed,
    occurrences: occurrencesFromAnalysis(analysis),
    sourceCatalogPath: sourceCatalogPath(config)
  }
}

module.exports = {
  SOURCE_CATALOG_FILE,
  assertSourceCatalogFresh,
  catalogEqual,
  occurrencesFromAnalysis,
  readCommittedSourceCatalog,
  sourceCatalogPath
}
