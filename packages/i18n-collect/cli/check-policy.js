const { CHECK_POLICY_REMOVED } = require('../mycommon/legacy-contraction')

const EXIT = {
  ok: 0,
  configuration: 1,
  policy: 2
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function outcome(code, stdout, stderr) {
  return { code, stdout, stderr }
}

function checkPolicy(args) {
  const json = args.includes('--json')
  const message = CHECK_POLICY_REMOVED
  const stdout = json
    ? jsonText({ command: 'check-policy', failure: 'configuration', message, ok: false })
    : ''
  return outcome(EXIT.configuration, stdout, `configuration: ${message}\n`)
}

module.exports = { EXIT, checkPolicy }
