const path = require('path')
const { checkPolicy, EXIT: POLICY_EXIT } = require('./check-policy')
const { collect, EXIT: COLLECT_EXIT } = require('./collect')
const {
  changedFormalOutputs,
  loadFormalOutputPaths,
  restoreFormalOutputs,
  snapshotFormalOutputs
} = require('../mycommon/formal-outputs')

const EXIT = {
  ok: 0,
  configuration: 1,
  collection: 2,
  build: 3,
  policy: 8,
  stale: 9
}

function commandError(kind, message) {
  const error = new Error(message)
  error.kind = kind
  return error
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function outcome(code, stdout, stderr) {
  return { code, stdout, stderr }
}

function take(args, index, flag) {
  const next = args[index + 1]
  if (next === undefined || next.startsWith('-')) {
    throw commandError('configuration', `${flag} requires a value`)
  }
  return next
}

function parseVerifyArgs(args) {
  const forwarded = []
  const parsed = {
    cwd: null,
    json: false,
    forwarded
  }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    const eq = arg.indexOf('=')
    const flag = eq === -1 ? arg : arg.slice(0, eq)
    const inline = eq === -1 ? null : arg.slice(eq + 1)
    const value = name => {
      if (inline !== null) {
        if (!inline) throw commandError('configuration', `${name} requires a value`)
        return inline
      }
      const next = take(args, index, name)
      index += 1
      return next
    }
    if (flag === '--json') {
      if (inline !== null) throw commandError('configuration', 'unknown option "--json"')
      parsed.json = true
      forwarded.push('--json')
    } else if (flag === '--cwd') {
      parsed.cwd = value('--cwd')
      forwarded.push('--cwd', parsed.cwd)
    } else if (
      flag === '--webpack-config'
      || flag === '--include'
      || flag === '--exclude'
      || flag === '--context-filter'
    ) {
      const next = value(flag)
      forwarded.push(flag, next)
    } else if (flag.startsWith('-')) {
      throw commandError('configuration', `unknown option "${flag}"`)
    } else {
      throw commandError('configuration', `unexpected argument "${arg}"`)
    }
  }
  return parsed
}

function configurationFailure(message, json) {
  return outcome(
    EXIT.configuration,
    json ? jsonText({ command: 'verify', failure: 'configuration', message, ok: false }) : '',
    `configuration: ${message}\n`
  )
}

function mapCollectFailure(collectOutcome, json) {
  let failure = 'build'
  if (collectOutcome.code === COLLECT_EXIT.configuration) failure = 'configuration'
  else if (collectOutcome.code === COLLECT_EXIT.collection) failure = 'collection'
  else if (collectOutcome.code === COLLECT_EXIT.build) failure = 'build'
  if (!json) {
    return outcome(collectOutcome.code, collectOutcome.stdout, collectOutcome.stderr)
  }
  let message = collectOutcome.stderr.trim()
  try {
    const parsed = JSON.parse(collectOutcome.stdout)
    if (parsed && parsed.message) message = parsed.message
    if (parsed && parsed.failure) failure = parsed.failure
  } catch (error) {
    // Keep stderr-derived message.
  }
  return outcome(
    collectOutcome.code,
    jsonText({ command: 'verify', failure, message, ok: false }),
    collectOutcome.stderr
  )
}

function staleFailure(changed, json) {
  const message = 'formal collection outputs differ from committed artifacts'
  const lines = [
    `stale: ${message}`,
    ...changed.map(file => `changed: ${file}`),
    'hint: run collection (or the project production build that writes formal outputs) and commit the updated dictionary, source map, source-locale catalog, and catalog metadata'
  ]
  return outcome(
    EXIT.stale,
    json ? jsonText({ command: 'verify', failure: 'stale', message, changed, ok: false }) : '',
    `${lines.join('\n')}\n`
  )
}

function mapPolicyFailure(policyOutcome, json) {
  if (policyOutcome.code === POLICY_EXIT.ok) return null
  if (policyOutcome.code === POLICY_EXIT.configuration) {
    let message = policyOutcome.stderr.trim()
    if (json) {
      try {
        const parsed = JSON.parse(policyOutcome.stdout)
        if (parsed && parsed.message) message = parsed.message
      } catch (error) {
        // Keep stderr-derived message.
      }
      return configurationFailure(message.replace(/^configuration:\s*/, ''), true)
    }
    return outcome(EXIT.configuration, policyOutcome.stdout, policyOutcome.stderr)
  }
  if (!json) {
    return outcome(EXIT.policy, policyOutcome.stdout, policyOutcome.stderr)
  }
  let report
  try {
    report = JSON.parse(policyOutcome.stdout)
  } catch (error) {
    report = { message: policyOutcome.stderr.trim() }
  }
  return outcome(
    EXIT.policy,
    jsonText({
      command: 'verify',
      failure: 'policy',
      message: 'hybrid localization policy violations require migration or baseline update',
      ok: false,
      policy: report
    }),
    policyOutcome.stderr || 'policy: hybrid localization policy violations require migration or baseline update\n'
  )
}

async function verify(args) {
  const json = args.includes('--json')
  const { VERIFY_REMOVED } = require('../mycommon/legacy-contraction')
  return configurationFailure(VERIFY_REMOVED, json)
  let parsed
  try {
    parsed = parseVerifyArgs(args)
  } catch (error) {
    return configurationFailure(error.message, args.includes('--json'))
  }
  const root = path.resolve(parsed.cwd || process.cwd())
  let snapshot
  try {
    snapshot = snapshotFormalOutputs(root, loadFormalOutputPaths(root))
  } catch (error) {
    return configurationFailure(error.message, parsed.json)
  }

  const collectOutcome = await collect(parsed.forwarded)
  if (collectOutcome.code !== COLLECT_EXIT.ok) {
    return mapCollectFailure(collectOutcome, parsed.json)
  }

  const changed = changedFormalOutputs(root, snapshot)
  if (changed.length > 0) {
    restoreFormalOutputs(root, snapshot)
    return staleFailure(changed, parsed.json)
  }

  const policyArgs = []
  if (parsed.cwd) policyArgs.push('--cwd', parsed.cwd)
  if (parsed.json) policyArgs.push('--json')
  const policyOutcome = checkPolicy(policyArgs)
  const policyFailure = mapPolicyFailure(policyOutcome, parsed.json)
  if (policyFailure) return policyFailure

  if (parsed.json) {
    let collection
    let policy
    try {
      collection = JSON.parse(collectOutcome.stdout)
    } catch (error) {
      collection = { ok: true }
    }
    try {
      policy = JSON.parse(policyOutcome.stdout)
    } catch (error) {
      policy = { ok: true }
    }
    return outcome(
      EXIT.ok,
      jsonText({
        command: 'verify',
        ok: true,
        collection,
        policy
      }),
      ''
    )
  }

  const policyLine = (policyOutcome.stdout || '').trim()
  const lines = [
    'verify: formal collection outputs are current',
    policyLine || 'check-policy: ok',
    ''
  ]
  return outcome(EXIT.ok, lines.join('\n'), '')
}

module.exports = { EXIT, verify }
