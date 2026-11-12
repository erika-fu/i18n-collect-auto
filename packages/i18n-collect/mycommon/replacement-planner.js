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
      helperName: this.runtime.helperName || 't',
      helperAvailable: Boolean(this.runtime.helperAvailable)
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

/**
 * Plan safe in-memory edits for one module using adapter call shapes.
 * Does not invent runtime imports or helpers; callers must already have t / $t.
 */
function planReplacementForModule({
  adapter,
  projectPath,
  source,
  occurrences = [],
  styleExtensions = [],
  runtime = {},
  template = null
} = {}) {
  if (!ADAPTERS.has(adapter)) throw new Error(`unknown replacement adapter "${adapter}"`)
  const relevant = occurrences.filter(item => item && item.location && item.location.path === projectPath)
  const resource = template ? { source, template } : source
  const planned = new ReplacementPlanner({
    adapter,
    styleExtensions,
    runtime: {
      ...runtime,
      helperName: runtime.helperName || 't',
      // Never pretend a helper is globally available for injection. Scope-local
      // t / $t detection inside the planner remains the authority.
      helperAvailable: false
    }
  }).plan({
    occurrences: relevant,
    resources: new Map([[projectPath, resource]])
  })
  return {
    ...planned,
    projectPath,
    injected: false
  }
}

function applyModuleReplacement({ source, planned }) {
  if (typeof source !== 'string' || !planned || !Array.isArray(planned.edits) || planned.edits.length === 0) {
    return { code: source, changed: false, planned: planned || null }
  }
  const projectPath = planned.projectPath
  const fileEdits = planned.edits
    .filter(edit => !projectPath || edit.path === projectPath)
    .map(({ start, end, text }) => ({ start, end, text }))
    .sort((left, right) => right.start - left.start)
  if (fileEdits.length === 0) {
    return { code: source, changed: false, planned }
  }
  let code = source
  for (const edit of fileEdits) {
    code = code.slice(0, edit.start) + edit.text + code.slice(edit.end)
  }
  return { code, changed: code !== source, planned }
}

module.exports = {
  ADAPTERS,
  ReplacementPlanner,
  applyModuleReplacement,
  planReplacement,
  planReplacementForModule
}
