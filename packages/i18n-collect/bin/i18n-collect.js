#!/usr/bin/env node
const { main } = require('../cli/main')

main(process.argv.slice(2)).then(code => {
  process.exitCode = code
}).catch(error => {
  process.stderr.write(`build: ${error && error.message ? error.message : error}\n`)
  process.exitCode = 3
})
