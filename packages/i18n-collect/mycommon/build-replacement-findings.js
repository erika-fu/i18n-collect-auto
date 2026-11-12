const { keyFor } = require('./store')

const EXCLUDED_KINDS = new Set([
  'static-html-text',
  'static-html-attribute',
  'css-generated-content',
  'css-preprocessor-candidate'
])

function occurrencesForReplacement(analysis) {
  const items = []
  for (const finding of (analysis && analysis.runtimeMessages) || []) {
    if (!finding || !finding.location || typeof finding.text !== 'string') continue
    const kind = finding.semanticRole
    if (EXCLUDED_KINDS.has(kind)) continue
    items.push({
      key: finding.key || keyFor(finding.text),
      source: finding.text,
      location: {
        path: finding.location.path,
        kind,
        start: finding.location.start,
        end: finding.location.end
      },
      status: 'active',
      reportedAmbiguity: false
    })
  }
  return items
}

function scriptEntriesFromSource(source, projectPath, config = {}) {
  const { extractScript } = require('../myloader/extract-script')
  return extractScript({
    source,
    resource: { projectPath },
    config
  })
}

function vueEntriesFromSource(source, projectPath, config = {}) {
  const { extractScript } = require('../myloader/extract-script')
  const { extractHtml } = require('../myloader/extract-html')
  const entries = []
  const pattern = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi
  let match = pattern.exec(source)
  while (match) {
    const openTag = match[0].slice(0, match[0].length - match[2].length - '</script>'.length)
    const innerStart = match.index + openTag.length
    const padded = `${source.slice(0, innerStart).replace(/[^\n]/g, ' ')}${match[2]}`
    entries.push(...extractScript({
      source: padded,
      resource: { projectPath },
      config
    }))
    match = pattern.exec(source)
  }
  if (/<template[\s>]/i.test(source)) {
    entries.push(...extractHtml({
      source,
      resource: {
        projectPath,
        block: 'template',
        lang: 'html',
        query: '?vue&type=template',
        identity: `${projectPath}::template[lang=html]`
      },
      config
    }).entries)
  }
  return entries
}

/**
 * Derive replacement occurrences from one in-memory module source.
 * Uses the current compilation buffer, not a filesystem reanalysis, and does
 * not run project-wide explicit-message or catalog reference validation.
 */
function occurrencesFromModuleSource({ source, projectPath, config = {} }) {
  if (typeof source !== 'string' || !projectPath) return []
  const path = require('path')
  const { REPRESENTATION_LOCALIZED_CALL } = require('./catalog')
  const extension = path.posix.extname(projectPath).toLowerCase()
  const entries = extension === '.vue'
    ? vueEntriesFromSource(source, projectPath, config)
    : scriptEntriesFromSource(source, projectPath, config)
  const items = []
  for (const entry of entries) {
    if (!entry || entry.representation === REPRESENTATION_LOCALIZED_CALL) continue
    if (typeof entry.value !== 'string' || !entry.value) continue
    const location = entry.locations && entry.locations[0]
    if (!location || EXCLUDED_KINDS.has(location.kind)) continue
    items.push({
      key: entry.key || keyFor(entry.value),
      source: entry.value,
      location: {
        path: location.path || projectPath,
        kind: location.kind,
        start: location.start,
        end: location.end
      },
      status: 'active',
      reportedAmbiguity: false
    })
  }
  return items
}

/**
 * Verify the committed catalog against a compilation analysis and publish
 * replacement occurrences into the loader context. No filesystem source reanalysis.
 */
function prepareCompilationBuildReplacement(root, config, compilationResult = {}) {
  const { buildSourceCatalog } = require('./project-analysis')
  const { verifyCommittedCatalogAgainstCompilation } = require('./source-catalog-freshness')
  const { prepareBuildReplacementContext } = require('./build-replacement-context')
  const analysis = compilationResult.analysis || null
  const sourceCatalog = compilationResult.sourceCatalog
    || (analysis ? buildSourceCatalog(analysis) : null)
  const verified = verifyCommittedCatalogAgainstCompilation(root, config, {
    analysis,
    sourceCatalog,
    occurrences: compilationResult.occurrences
  })
  const context = prepareBuildReplacementContext(root, {
    analysis: verified.analysis || analysis,
    sourceCatalog: verified.sourceCatalog,
    occurrences: verified.occurrences
  })
  return {
    ...verified,
    occurrences: context.occurrences,
    sourceCatalog: context.sourceCatalog,
    snapshots: compilationResult.snapshots || null
  }
}

module.exports = {
  EXCLUDED_KINDS,
  occurrencesForReplacement,
  occurrencesFromModuleSource,
  prepareCompilationBuildReplacement
}
