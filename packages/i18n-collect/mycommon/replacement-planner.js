const { planPreview } = require('./replace-preview')

const ADAPTERS = new Set(['vue2', 'vue3', 'js'])

function resourceMaps(resources) {
  const entries = resources instanceof Map
    ? [...resources]
    : resources && typeof resources === 'object' && !Array.isArray(resources)
      ? Object.entries(resources)
      : []
  const sources = new Map()
  const templates = new Map()
  for (const [projectPath, resource] of entries) {
    if (typeof resource === 'string' || resource == null) {
      sources.set(projectPath, resource)
      continue
    }
    sources.set(projectPath, typeof resource.source === 'string' || resource.source === null ? resource.source : null)
    if (resource.template) templates.set(projectPath, resource.template)
  }
  return { sources, templates }
}

/**
 * Pure replacement planning boundary.
 *
 * The planner consumes catalog occurrences, immutable resource snapshots, and
 * already-verified runtime capabilities. It does not load project files,
 * configuration, catalogs, or webpack objects, and it never writes output.
 */
class ReplacementPlanner {
  constructor({ adapter, styleExtensions = [], runtime = {} } = {}) {
    if (!ADAPTERS.has(adapter)) throw new Error(`unknown replacement adapter "${adapter}"`)
    this.adapter = adapter
    this.styleExtensions = new Set(styleExtensions.map(extension => String(extension).toLowerCase()))
    this.runtime = runtime
  }

  plan({ occurrences = [], resources = new Map() } = {}) {
    const snapshots = resourceMaps(resources)
    const planned = planPreview({
      adapter: this.adapter,
      items: occurrences,
      sources: snapshots.sources,
      templates: snapshots.templates,
      styleExtensions: this.styleExtensions,
    })
    return {
      ...planned,
      failure: null,
      runtime: this.runtime
    }
  }
}

function planReplacement(options) {
  const { adapter, styleExtensions, runtime, occurrences, resources } = options || {}
  return new ReplacementPlanner({ adapter, styleExtensions, runtime })
    .plan({ occurrences, resources })
}

module.exports = {
  ADAPTERS,
  ReplacementPlanner,
  planReplacement
}
