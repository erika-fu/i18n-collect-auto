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

function storeFromSnapshots(snapshots) {
  const store = new CollectionStore()
  for (const snapshot of snapshots || []) {
    store.replaceSnapshot(snapshot.identity, snapshot.entries || [])
  }
  return store
}

class CollectionSession {
  constructor() {
    this.rounds = new WeakMap()
    this.committed = new CollectionStore()
  }

  begin(compilation) {
    this.rounds.set(mainCompilation(compilation), freshRound())
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

  abandon(compilation) {
    const round = this.round(compilation)
    round.abandoned = true
    round.submissions.clear()
  }

  commit(compilation, snapshots) {
    const round = this.round(compilation)
    if (round.abandoned) return this.committed
    this.committed = storeFromSnapshots(snapshots)
    round.submissions.clear()
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
  storeFromSnapshots
}
