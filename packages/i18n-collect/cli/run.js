const { RUN_REMOVED } = require('../mycommon/legacy-contraction')

const EXIT = { configuration: 1 }

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function outcome(code, stdout, stderr) {
  return { code, stdout, stderr }
}

function run(args) {
  const json = args.includes('--json')
  const message = RUN_REMOVED
  const stdout = json
    ? jsonText({ command: 'run', failure: 'configuration', message, ok: false })
    : ''
  return outcome(EXIT.configuration, stdout, `configuration: ${message}\n`)
}

module.exports = { run }
