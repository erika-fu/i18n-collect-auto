const { collect } = require('./collect')
const { replace } = require('./replace')
const { translate } = require('./translate')

const EXIT = { configuration: 1 }
const STAGE_ORDER = ['collect', 'translate', 'replace']
const VALUE_FLAGS = {
  collect: new Set(['--webpack-config', '--include', '--exclude', '--context-filter']),
  translate: new Set(['--provider', '--locale', '--failure']),
  replace: new Set(['--adapter'])
}
const BOOL_FLAGS = {
  translate: new Set(['--retranslate', '--allow-network']),
  replace: new Set(['--strict', '--write'])
}

function commandError(message) {
  const error = new Error(message)
  error.kind = 'configuration'
  return error
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function outcome(code, stdout, stderr) {
  return { code, stdout, stderr }
}

function failure(error, json) {
  const message = error && error.message ? error.message : String(error)
  const stdout = json ? jsonText({ command: 'run', failure: 'configuration', message, ok: false }) : ''
  return outcome(EXIT.configuration, stdout, `configuration: ${message}\n`)
}

function take(args, index, flag) {
  const next = args[index + 1]
  if (next === undefined || next.startsWith('-')) throw commandError(`${flag} requires a value`)
  return next
}

function stageFor(flag) {
  for (const stage of STAGE_ORDER) {
    if (VALUE_FLAGS[stage].has(flag) || (BOOL_FLAGS[stage] && BOOL_FLAGS[stage].has(flag))) return stage
  }
  return null
}

function parseRunArgs(args) {
  const stages = { collect: false, translate: false, replace: false }
  const forwarded = { collect: [], translate: [], replace: [] }
  const parsed = { cwd: null, json: false, stages, forwarded }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const eq = arg.indexOf('=')
    const flag = eq === -1 ? arg : arg.slice(0, eq)
    const inline = eq === -1 ? null : arg.slice(eq + 1)
    const value = name => {
      if (inline !== null) {
        if (!inline) throw commandError(`${name} requires a value`)
        return inline
      }
      const next = take(args, index, name)
      index += 1
      return next
    }
    if (flag === '--collect' || flag === '--translate' || flag === '--replace') {
      if (inline !== null) throw commandError(`unknown option "${flag}"`)
      stages[flag.slice(2)] = true
    } else if (flag === '--json') {
      if (inline !== null) throw commandError('unknown option "--json"')
      parsed.json = true
    } else if (flag === '--cwd') parsed.cwd = value('--cwd')
    else if (VALUE_FLAGS.collect.has(flag) || VALUE_FLAGS.translate.has(flag) || VALUE_FLAGS.replace.has(flag)) {
      forwarded[stageFor(flag)].push(flag, value(flag))
    } else if (BOOL_FLAGS.translate.has(flag) || BOOL_FLAGS.replace.has(flag)) {
      if (inline !== null) throw commandError(`unknown option "${flag}"`)
      forwarded[stageFor(flag)].push(flag)
    } else if (flag.startsWith('-')) throw commandError(`unknown option "${flag}"`)
    else throw commandError(`unexpected argument "${arg}"`)
  }
  for (const stage of STAGE_ORDER) {
    if (!stages[stage] && forwarded[stage].length > 0) {
      throw commandError(`${forwarded[stage][0]} requires --${stage}`)
    }
  }
  const selected = STAGE_ORDER.filter(stage => stages[stage])
  if (selected.length === 0) throw commandError('run requires --collect, --translate, or --replace')
  return { ...parsed, selected }
}

function stageArgs(parsed, stage) {
  const args = [...parsed.forwarded[stage]]
  if (parsed.cwd) args.push('--cwd', parsed.cwd)
  if (parsed.json) args.push('--json')
  return args
}

function invoke(stage, args) {
  if (stage === 'collect') return collect(args)
  if (stage === 'translate') return translate(args)
  return replace(args)
}

function section(stage, stdout) {
  const body = stdout ? stdout.replace(/\s+$/, '') : ''
  return body ? `[${stage}]\n${body}\n` : `[${stage}]\n`
}

function diagnostic(stderr) {
  const match = /^([a-z]+): ([\s\S]*)$/.exec(stderr || '')
  if (!match) return { failure: 'configuration', message: String(stderr || '').trim() }
  return { failure: match[1], message: match[2].trim() }
}

function stageReport(stdout) {
  try {
    return JSON.parse(stdout)
  } catch (error) {
    return { command: 'run', ok: false, message: stdout }
  }
}

async function run(args) {
  const json = args.includes('--json')
  let parsed
  try {
    parsed = parseRunArgs(args)
  } catch (error) {
    return failure(error, json)
  }
  const results = []
  const sections = []
  try {
    for (const stage of parsed.selected) {
      const stageOutcome = await invoke(stage, stageArgs(parsed, stage))
      if (parsed.json) results.push(stageReport(stageOutcome.stdout))
      else sections.push(section(stage, stageOutcome.stdout))
      if (stageOutcome.code !== 0) {
        if (!parsed.json) {
          return outcome(stageOutcome.code, sections.join('\n'), stageOutcome.stderr)
        }
        const problem = diagnostic(stageOutcome.stderr)
        return outcome(stageOutcome.code, jsonText({
          command: 'run',
          ok: false,
          stages: parsed.selected,
          failure: problem.failure,
          message: problem.message,
          results
        }), stageOutcome.stderr)
      }
    }
  } catch (error) {
    return failure(error, parsed.json)
  }
  if (!parsed.json) return outcome(0, sections.join('\n'), '')
  return outcome(0, jsonText({
    command: 'run',
    ok: true,
    stages: parsed.selected,
    results
  }), '')
}

module.exports = { run }
