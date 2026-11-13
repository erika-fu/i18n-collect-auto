const { build } = require('./build')
const { check } = require('./check')
const { checkPolicy } = require('./check-policy')
const { collect, EXIT } = require('./collect')
const { helpFor } = require('./help')
const { migrateKeys } = require('./migrate-keys')
const { replace } = require('./replace')
const { review } = require('./review')
const { run } = require('./run')
const { scan } = require('./scan')
const { translate } = require('./translate')
const { verify } = require('./verify')

function write(stream, text) {
  if (!text) return
  stream.write(text.endsWith('\n') ? text : `${text}\n`)
}

async function main(argv) {
  const args = [...argv]
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    write(process.stdout, helpFor())
    return EXIT.ok
  }
  const command = args[0]
  if (
    command !== 'scan'
    && command !== 'collect'
    && command !== 'translate'
    && command !== 'replace'
    && command !== 'review'
    && command !== 'run'
    && command !== 'check'
    && command !== 'check-policy'
    && command !== 'verify'
    && command !== 'build'
    && command !== 'migrate-keys'
  ) {
    write(process.stderr, `configuration: unknown command "${command}"`)
    write(process.stdout, helpFor())
    return EXIT.configuration
  }
  const commandArgs = args.slice(1)
  if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
    write(process.stdout, helpFor(command))
    return EXIT.ok
  }
  const outcome = command === 'scan'
    ? scan(commandArgs)
    : command === 'collect'
      ? await collect(commandArgs)
      : command === 'translate'
        ? await translate(commandArgs)
        : command === 'replace'
          ? replace(commandArgs)
          : command === 'review'
            ? await review(commandArgs)
            : command === 'check'
              ? check(commandArgs)
              : command === 'check-policy'
                ? checkPolicy(commandArgs)
                : command === 'verify'
                  ? await verify(commandArgs)
                  : command === 'build'
                    ? await build(commandArgs)
                    : command === 'migrate-keys'
                      ? migrateKeys(commandArgs)
                      : await run(commandArgs)
  write(process.stdout, outcome.stdout)
  write(process.stderr, outcome.stderr)
  if (typeof outcome.waitUntilClosed === 'function') {
    return outcome.waitUntilClosed()
  }
  return outcome.code
}

module.exports = { EXIT, main }
