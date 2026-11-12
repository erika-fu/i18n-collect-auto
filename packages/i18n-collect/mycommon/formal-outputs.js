const fs = require('fs')
const path = require('path')
const { catalogFiles, loadConfig } = require('./config')
const { SOURCE_CATALOG_VERSION } = require('./project-analysis')
const { commitFiles, json, unchanged } = require('./output')

const SOURCE_CATALOG_FILE = 'source-catalog.json'
const ANALYSIS_REPORT_FILE = 'analysis-report.json'

function sourceCatalogPath(config) {
  return path.posix.join(config.catalogDir, SOURCE_CATALOG_FILE)
}

function analysisReportPath(config) {
  return path.posix.join(config.catalogDir, ANALYSIS_REPORT_FILE)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertStringMessages(messages, label) {
  if (!isPlainObject(messages)) {
    throw new Error(`${label} must be a JSON object`)
  }
  for (const key of Object.keys(messages)) {
    if (typeof messages[key] !== 'string') {
      throw new Error(`${label} key "${key}" must be a string`)
    }
  }
  return messages
}

function parseSourceCatalogDocument(parsed) {
  if (!isPlainObject(parsed)) {
    throw new Error('source catalog must be a JSON object')
  }
  if (
    Object.prototype.hasOwnProperty.call(parsed, 'version')
    || Object.prototype.hasOwnProperty.call(parsed, 'messages')
  ) {
    if (parsed.version !== SOURCE_CATALOG_VERSION) {
      throw new Error(
        `source catalog version ${parsed.version} is unsupported; use version ${SOURCE_CATALOG_VERSION}`
      )
    }
    return {
      version: SOURCE_CATALOG_VERSION,
      messages: assertStringMessages(parsed.messages, 'source catalog messages')
    }
  }
  return {
    version: SOURCE_CATALOG_VERSION,
    messages: assertStringMessages(parsed, 'source catalog')
  }
}

function sourceCatalogMessages(parsed) {
  return parseSourceCatalogDocument(parsed).messages
}

function formalCollectionPaths(config) {
  return [sourceCatalogPath(config), analysisReportPath(config)]
}

function formalOutputPaths(config) {
  const files = catalogFiles(config)
  return [
    config.outputPath,
    config.sourceMapFilename,
    files.messages,
    files.metadata,
    ...formalCollectionPaths(config)
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

async function publishCollectionOutputs({
  root,
  config,
  catalog,
  report,
  dictionary,
  sourceMap,
  fsImpl = fs
} = {}) {
  const document = parseSourceCatalogDocument(catalog)
  const targets = [
    { file: path.resolve(root, sourceCatalogPath(config)), content: json(document) },
    { file: path.resolve(root, analysisReportPath(config)), content: json(report) },
    { file: path.resolve(root, config.outputPath), content: json(dictionary) },
    { file: path.resolve(root, config.sourceMapFilename), content: json(sourceMap) }
  ].filter(target => !unchanged(fsImpl, target.file, target.content))
  commitFiles(targets, fsImpl)
}

module.exports = {
  ANALYSIS_REPORT_FILE,
  SOURCE_CATALOG_FILE,
  analysisReportPath,
  changedFormalOutputs,
  formalCollectionPaths,
  formalOutputPaths,
  loadFormalOutputPaths,
  parseSourceCatalogDocument,
  publishCollectionOutputs,
  restoreFormalOutputs,
  snapshotFormalOutputs,
  sourceCatalogMessages,
  sourceCatalogPath
}
