const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  fingerprintOf,
  REPRESENTATION_LOCALIZED_CALL,
  REPRESENTATION_SOURCE_TEXT
} = require('../mycommon/catalog')
const { loadConfig } = require('../mycommon/config')
const { json } = require('../mycommon/output')
const { analyzeProject, buildSourceCatalog } = require('../mycommon/project-analysis')
const { listProjectSources } = require('../mycommon/project-sources')
const { SOURCE_CATALOG_FILE, sourceCatalogMessages } = require('../mycommon/source-catalog-freshness')
const { keyFor } = require('../mycommon/store')

function occurrenceId(location) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(location))
    .digest('hex')
    .slice(0, 16)
}

function appendOccurrence(entries, key, source, location, representation, origin) {
  if (!entries[key]) {
    entries[key] = {
      source,
      fingerprint: fingerprintOf(source),
      origin,
      representation,
      status: 'active',
      locations: [],
      occurrences: []
    }
  }
  entries[key].locations.push(location)
  entries[key].occurrences.push({
    id: occurrenceId(location),
    semanticHost: location.path,
    childRole: location.kind,
    localContext: `${location.start.line}:${location.start.column}`,
    origin,
    representation,
    location
  })
  if (representation === REPRESENTATION_LOCALIZED_CALL) {
    entries[key].representation = REPRESENTATION_LOCALIZED_CALL
  }
}

function metadataFromAnalysis(analysis, catalog) {
  const messages = sourceCatalogMessages(catalog || {})
  const entries = {}
  for (const finding of analysis.runtimeMessages || []) {
    const key = finding.key || keyFor(finding.text)
    const location = {
      path: finding.location.path,
      kind: finding.semanticRole,
      start: finding.location.start,
      end: finding.location.end
    }
    const origin = finding.key && finding.key !== keyFor(finding.text) ? 'explicit' : 'derived'
    appendOccurrence(entries, key, finding.text, location, REPRESENTATION_SOURCE_TEXT, origin)
  }
  for (const finding of analysis.localizedCallFindings || []) {
    if (!finding.key) continue
    const source = finding.source != null ? finding.source : messages[finding.key]
    if (source == null) continue
    const location = {
      path: finding.location.path,
      kind: finding.semanticRole || 'script-string',
      start: finding.location.start,
      end: finding.location.end
    }
    appendOccurrence(
      entries,
      finding.key,
      source,
      location,
      REPRESENTATION_LOCALIZED_CALL,
      'derived'
    )
  }
  return {
    version: 3,
    sourceLocale: 'zh',
    format: 'json',
    entries
  }
}

function seedSourceCatalog(root, options = {}) {
  const writeLocaleCatalog = options.writeLocaleCatalog === true
  const config = loadConfig({ root })
  const catalogDir = path.join(root, config.catalogDir)
  const sourceCatalogFile = path.join(catalogDir, SOURCE_CATALOG_FILE)
  const sources = listProjectSources(config.root, config)
  const analysis = analyzeProject({ files: sources, config })
  const catalog = buildSourceCatalog(analysis)
  fs.mkdirSync(catalogDir, { recursive: true })
  fs.writeFileSync(sourceCatalogFile, json(catalog))
  if (writeLocaleCatalog) {
    fs.writeFileSync(path.join(catalogDir, `${config.sourceLocale}.json`), json(catalog.messages))
  }
  return catalog
}

function writeSourceCatalog(root, catalog) {
  const config = loadConfig({ root })
  const file = path.join(root, config.catalogDir, SOURCE_CATALOG_FILE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, json(catalog))
  return file
}

function readSourceCatalog(root) {
  const config = loadConfig({ root })
  const file = path.join(root, config.catalogDir, SOURCE_CATALOG_FILE)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function sourceCatalogBuffer(root) {
  const config = loadConfig({ root })
  return fs.readFileSync(path.join(root, config.catalogDir, SOURCE_CATALOG_FILE))
}

function keyForSource(root, sourceText) {
  const catalog = sourceCatalogMessages(readSourceCatalog(root))
  const key = Object.keys(catalog).find(name => catalog[name] === sourceText)
  assert.ok(key, `missing source catalog key for ${sourceText}`)
  return key
}

function snapshotLangTree(root) {
  const langRoot = path.join(root, 'lang')
  const out = new Map()
  if (!fs.existsSync(langRoot)) return out
  const visit = directory => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name)
      const stat = fs.statSync(file)
      if (stat.isDirectory()) visit(file)
      else out.set(path.relative(root, file).split(path.sep).join('/'), fs.readFileSync(file))
    }
  }
  visit(langRoot)
  return out
}

function assertLangUnchanged(before, root) {
  const after = snapshotLangTree(root)
  assert.deepStrictEqual([...after.keys()].sort(), [...before.keys()].sort())
  for (const [file, content] of before) {
    assert.ok(after.has(file), `missing ${file}`)
    assert.deepStrictEqual(after.get(file), content, `changed ${file}`)
  }
}

module.exports = {
  assertLangUnchanged,
  keyForSource,
  readSourceCatalog,
  seedSourceCatalog,
  snapshotLangTree,
  sourceCatalogBuffer,
  writeSourceCatalog
}
