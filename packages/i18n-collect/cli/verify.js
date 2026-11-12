const { VERIFY_REMOVED } = require('../mycommon/legacy-contraction')

const EXIT = { configuration: 1 }

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function outcome(code, stdout, stderr) {
  return { code, stdout, stderr }
}

function configurationFailure(message, json) {
  return outcome(
    EXIT.configuration,
    json ? jsonText({ command: 'verify', failure: 'configuration', message, ok: false }) : '',
    `configuration: ${message}\n`
  )
}

async function verify(args) {
  const json = args.includes('--json')
  return configurationFailure(VERIFY_REMOVED, json)
}

module.exports = { EXIT, verify }
