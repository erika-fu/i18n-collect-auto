const path = require('path')
const { CollectionStore } = require('./store')

const COLLECT_METADATA = 'i18nCollect'
const SCHEMA_VERSION = 1

const sessions = new WeakMap()

function rootCompiler(compiler) {
  if (!compiler) return compiler
  return compiler.root || compiler
}

function mainCompilation(compilation) {
  let current = compilation
  const seen = new Set()
  while (
    current &&
    current.compiler &&
    current.compiler.parentCompilation &&
    !seen.has(current)
  ) {
    seen.add(current)
    current = current.compiler.parentCompilation
  }
  return current
}

function freshRound() {
  return {
    invocations: 0,
    submissions: new Map(),
    warnings: new Set(),
    abandoned: false
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function storeFromSnapshots(snapshots) {
  const store = new CollectionStore()
  for (const snapshot of snapshots || []) {
    store.replaceSnapshot(snapshot.identity, snapshot.entries || [])
  }
  return store
}

function moduleMetadata({ root, fileConfigHash, included, snapshot }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    root,
    fileConfigHash,
    invoked: true,
    included: Boolean(included),
    snapshot: snapshot || null
  }
}

function metadataPath(metadata) {
  const snapshot = metadata && metadata.snapshot
  return snapshot && snapshot.projectPath ? snapshot.projectPath : null
}

function interpretMetadata(metadata, context) {
  const projectPath = metadataPath(metadata)
  const prefix = projectPath
    ? `i18n-collect ignored metadata for ${projectPath}`
    : 'i18n-collect ignored module metadata'
  const validEnvelope = metadata &&
    typeof metadata === 'object' &&
    metadata.schemaVersion === SCHEMA_VERSION &&
    metadata.invoked === true &&
    typeof metadata.included === 'boolean' &&
    typeof metadata.root === 'string' &&
    typeof metadata.fileConfigHash === 'string'
  if (!validEnvelope) {
    return { integrated: false, snapshot: null, diagnostic: `${prefix}: schema is invalid or unsupported` }
  }
  if (metadata.root !== context.root) {
    return {
      integrated: false,
      snapshot: null,
      diagnostic: `${prefix}: metadata does not belong to the current root compiler`
    }
  }
  if (metadata.fileConfigHash !== context.fileConfigHash) {
    return {
      integrated: false,
      snapshot: null,
      diagnostic: `${prefix}: configuration does not match the current root compiler`
    }
  }
  if (!metadata.included) return { integrated: true, snapshot: null, diagnostic: null }
  const snapshot = metadata.snapshot
  if (!snapshot || typeof snapshot.identity !== 'string' || !Array.isArray(snapshot.entries)) {
    return { integrated: false, snapshot: null, diagnostic: `${prefix}: schema is invalid or unsupported` }
  }
  return { integrated: true, snapshot, diagnostic: null }
}

function fileKey(file) {
  const resolved = path.resolve(file).split(path.sep).join('/')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function staticHtmlPath(snapshot) {
  if (!snapshot || typeof snapshot.identity !== 'string' || !snapshot.identity.endsWith('::html')) return null
  if (typeof snapshot.projectPath === 'string' && snapshot.projectPath) return snapshot.projectPath.split('\\').join('/')
  return snapshot.identity.slice(0, -'::html'.length)
}

function indexStaticHtmlSnapshots(snapshots) {
  const byIdentity = new Map()
  for (const snapshot of snapshots || []) {
    const projectPath = staticHtmlPath(snapshot)
    if (projectPath) byIdentity.set(snapshot.identity, snapshot)
  }
  return byIdentity
}

function retainStaticHtmlSnapshots({ live, submitted, committed, activeTemplates }) {
  const active = new Set(activeTemplates || [])
  const liveIds = new Set()
  const byIdentity = new Map()
  for (const snapshot of live || []) {
    if (!snapshot || !snapshot.identity) continue
    liveIds.add(snapshot.identity)
    byIdentity.set(snapshot.identity, snapshot)
  }
  const submittedHtml = indexStaticHtmlSnapshots(submitted)
  const committedHtml = indexStaticHtmlSnapshots(committed)
  for (const identity of new Set([...submittedHtml.keys(), ...committedHtml.keys()])) {
    const snapshot = submittedHtml.get(identity) || committedHtml.get(identity)
    const projectPath = staticHtmlPath(snapshot)
    if (!active.has(projectPath)) {
      if (!liveIds.has(identity)) byIdentity.delete(identity)
      continue
    }
    if (submittedHtml.has(identity)) byIdentity.set(identity, submittedHtml.get(identity))
    else if (!byIdentity.has(identity)) byIdentity.set(identity, committedHtml.get(identity))
  }
  return [...byIdentity.values()]
}

function selectActiveHtmlTemplates({ root, templates, dependencies, missing, present }) {
  const depended = new Set((dependencies || []).map(fileKey))
  const missingKeys = new Set((missing || []).map(fileKey))
  const active = []
  const seen = new Set()
  for (const template of templates || []) {
    const key = fileKey(template)
    if (!depended.has(key) || missingKeys.has(key)) continue
    if (typeof present === 'function' && !present(template)) continue
    const relative = path.relative(root, path.resolve(template)).split(path.sep).join('/')
    if (!relative || relative === '..' || relative.startsWith('../')) continue
    if (seen.has(relative)) continue
    seen.add(relative)
    active.push(relative)
  }
  return active
}

function assembleLiveSet(modules, context) {
  const byIdentity = new Map()
  const diagnostics = []
  let integrated = false
  for (const mod of modules || []) {
    const metadata = mod && mod.buildInfo && mod.buildInfo[COLLECT_METADATA]
    if (!metadata) continue
    const read = interpretMetadata(metadata, context)
    if (read.diagnostic) diagnostics.push(read.diagnostic)
    if (read.integrated) integrated = true
    if (read.snapshot && read.snapshot.identity) byIdentity.set(read.snapshot.identity, read.snapshot)
  }
  return {
    snapshots: [...byIdentity.values()],
    integrated,
    diagnostics: [...new Set(diagnostics)]
  }
}

class CollectionSession {
  constructor() {
    this.rounds = new WeakMap()
    this.snapshotList = []
    this.committedConfigHash = null
    this.committed = new CollectionStore()
  }

  begin(compilation) {
    const main = mainCompilation(compilation)
    if (!this.rounds.has(main)) this.rounds.set(main, freshRound())
  }

  round(compilation) {
    const main = mainCompilation(compilation)
    let round = this.rounds.get(main)
    if (!round) {
      round = freshRound()
      this.rounds.set(main, round)
    }
    return round
  }

  noteInvocation(compilation) {
    this.round(compilation).invocations += 1
  }

  submit(compilation, module, snapshot) {
    const round = this.round(compilation)
    round.invocations += 1
    if (snapshot && snapshot.identity) round.submissions.set(snapshot.identity, snapshot)
  }

  warn(compilation, warning) {
    this.round(compilation).warnings.add(JSON.stringify(warning))
  }

  invocationCount(compilation) {
    return this.round(compilation).invocations
  }

  isAbandoned(compilation) {
    const round = this.rounds.get(mainCompilation(compilation))
    return Boolean(round && round.abandoned)
  }

  candidateSnapshots(compilation) {
    const round = this.rounds.get(mainCompilation(compilation))
    if (!round) return []
    return clone([...round.submissions.values()])
  }

  committedSnapshots() {
    return clone(this.snapshotList)
  }

  abandon(compilation) {
    const round = this.round(compilation)
    round.abandoned = true
    round.submissions.clear()
  }

  commit(compilation, snapshots, configHash) {
    const round = this.round(compilation)
    if (round.abandoned) return this.committed
    this.snapshotList = clone(snapshots || [])
    if (configHash !== undefined) this.committedConfigHash = configHash
    this.committed = storeFromSnapshots(this.snapshotList)
    this.rounds.delete(mainCompilation(compilation))
    return this.committed
  }

  checkpoint() {
    return {
      snapshots: clone(this.snapshotList),
      configHash: this.committedConfigHash
    }
  }

  rollback(saved) {
    this.snapshotList = clone(saved.snapshots)
    this.committedConfigHash = saved.configHash
    this.committed = storeFromSnapshots(this.snapshotList)
  }

  async release(compilation, snapshots, configHash, write) {
    if (this.isAbandoned(compilation)) return this.committed
    const saved = this.checkpoint()
    this.commit(compilation, snapshots, configHash)
    try {
      await write(this.committed)
    } catch (error) {
      this.rollback(saved)
      this.abandon(compilation)
      throw error
    }
    return this.committed
  }
}

function getSession(compiler) {
  const root = rootCompiler(compiler)
  let session = sessions.get(root)
  if (!session) {
    session = new CollectionSession()
    sessions.set(root, session)
  }
  return session
}

module.exports = {
  COLLECT_METADATA,
  SCHEMA_VERSION,
  CollectionSession,
  getSession,
  rootCompiler,
  mainCompilation,
  storeFromSnapshots,
  moduleMetadata,
  assembleLiveSet,
  retainStaticHtmlSnapshots,
  selectActiveHtmlTemplates
}
