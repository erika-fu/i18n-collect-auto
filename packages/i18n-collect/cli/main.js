const { collect, EXIT } = require('./collect')
const { helpFor } = require('./help')
const { translate } = require('./translate')

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
  if (command !== 'collect' && command !== 'translate') {
    write(process.stderr, `configuration: unknown command "${command}"`)
    write(process.stdout, helpFor())
    return EXIT.configuration
  }
  const commandArgs = args.slice(1)
  if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
    write(process.stdout, helpFor(command))
    return EXIT.ok
  }
  const outcome = command === 'collect' ? await collect(commandArgs) : await translate(commandArgs)
  write(process.stdout, outcome.stdout)
  write(process.stderr, outcome.stderr)
  return outcome.code
}

module.exports = { EXIT, main }
