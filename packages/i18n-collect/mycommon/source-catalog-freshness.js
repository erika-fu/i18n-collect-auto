const fs = require('fs')
const path = require('path')
const {
  analyzeProject,
  buildSourceCatalog
} = require('./project-analysis')
const {
  SOURCE_CATALOG_FILE,
  parseSourceCatalogDocument,
  sourceCatalogMessages,
  sourceCatalogPath
} = require('./formal-outputs')
const { occurrencesForReplacement } = require('./build-replacement-findings')
const { listProjectSources } = require('./project-sources')
const { keyFor } = require('./store')

function commandError(kind, stage, message) {
  const error = new Error(message)
  error.kind = kind
  error.stage = stage
  return error
}

function readCommittedSourceCatalogDocument(root, config) {
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
  try {
    return parseSourceCatalogDocument(parsed)
  } catch (error) {
    throw commandError(
      'configuration',
      'configuration',
      error && error.message ? error.message : String(error)
    )
  }
}

function readCommittedSourceCatalog(root, config) {
  return readCommittedSourceCatalogDocument(root, config).messages
}

function catalogEqual(left, right) {
  const leftMessages = sourceCatalogMessages(left)
  const rightMessages = sourceCatalogMessages(right)
  const leftKeys = Object.keys(leftMessages).sort()
  const rightKeys = Object.keys(rightMessages).sort()
  if (leftKeys.length !== rightKeys.length) return false
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index]
    if (key !== rightKeys[index]) return false
    if (leftMessages[key] !== rightMessages[key]) return false
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
      'source analysis no longer matches the committed source catalog; run collect before build'
    )
  }
  return {
    analysis,
    sourceCatalog: committed,
    occurrences: occurrencesFromAnalysis(analysis),
    sourceCatalogPath: sourceCatalogPath(config)
  }
}

/**
 * Verify the committed source catalog against a compilation analysis result.
 * Does not walk the project filesystem or reanalyze application sources.
 */
function verifyCommittedCatalogAgainstCompilation(root, config, compilationResult = {}) {
  const committedDocument = readCommittedSourceCatalogDocument(root, config)
  const committed = sourceCatalogMessages(committedDocument)
  let current = compilationResult.sourceCatalog
  if (!current) {
    if (!compilationResult.analysis) {
      throw commandError(
        'collection',
        'analysis',
        'compilation result is missing a source catalog'
      )
    }
    try {
      current = buildSourceCatalog(compilationResult.analysis)
    } catch (error) {
      throw commandError(
        'collection',
        'analysis',
        error && error.message ? error.message : String(error)
      )
    }
  }
  if (!catalogEqual(current, committed)) {
    throw commandError(
      'collection',
      'analysis',
      'compilation result differs from the committed source catalog; run collect before build'
    )
  }
  const analysis = compilationResult.analysis || null
  return {
    analysis,
    sourceCatalog: committed,
    occurrences: analysis
      ? occurrencesForReplacement(analysis)
      : (compilationResult.occurrences || []),
    sourceCatalogPath: sourceCatalogPath(config)
  }
}

// Source replacement shares build's current analysis and catalog keys, but does not
// require the committed source catalog to equal buildSourceCatalog after a write:
// already-localized calls keep catalog keys without regenerating source text rows.
function prepareSourceReplacement(root, config) {
  const committed = readCommittedSourceCatalog(root, config)
  const sources = listProjectSources(config.root || root, config)
  let analysis
  try {
    analysis = analyzeProject({ files: sources, config })
  } catch (error) {
    throw commandError(
      'collection',
      'analysis',
      error && error.message ? error.message : String(error)
    )
  }
  for (const finding of analysis.runtimeMessages || []) {
    if (!finding || !finding.location || typeof finding.text !== 'string') continue
    const key = finding.key || keyFor(finding.text)
    const catalogText = committed[key]
    if (catalogText == null) {
      throw commandError(
        'collection',
        'analysis',
        'source analysis no longer matches the committed source catalog; run collect before replace'
      )
    }
    if (catalogText !== finding.text) {
      throw commandError(
        'collection',
        'analysis',
        `source catalog key "${key}" no longer matches source text; run collect before replace`
      )
    }
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
  prepareSourceReplacement,
  readCommittedSourceCatalog,
  readCommittedSourceCatalogDocument,
  sourceCatalogMessages,
  sourceCatalogPath,
  verifyCommittedCatalogAgainstCompilation
}
