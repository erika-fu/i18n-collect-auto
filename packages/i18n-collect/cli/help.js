const COLLECT_HELP = `i18n-collect collect

Run collection once through the project's existing webpack integration.
The webpack configuration must already use i18n-collect/myloader and i18n-collect/myplugin.
This command does not translate, does not rewrite application source, and does not make network requests.
It writes the hash dictionary, its source map, and the keyed source-locale catalog with its metadata,
then reports which localization keys were added, removed, changed, or unchanged.

Usage:
  i18n-collect collect [options]

Options:
  --cwd <dir>               Project root. Defaults to the current directory.
  --webpack-config <path>   Webpack configuration to run. Defaults to webpack.config.js.
  --include <pattern>       Replace the configured include scope. Repeat to set several patterns.
  --exclude <pattern>       Replace the configured exclude scope. Repeat to set several patterns.
  --context-filter <name>   Replace configured context filters. Repeat to select several.
                            Names: logging, tests, analytics.
  --json                    Print the collection report as JSON on stdout.
  -h, --help                Show this help.

Exit codes:
  0  collection finished
  1  configuration failure
  2  collection failure, including a malformed i18n-key directive or a localization key conflict
  3  build failure
`

const ROOT_HELP = `i18n-collect

Automation-friendly commands for this workspace.

Usage:
  i18n-collect <command> [options]

Commands:
  collect   Collect Chinese user-facing copy through the project's webpack integration.

Run i18n-collect collect --help for collection options.
`

function helpFor(command) {
  if (command === 'collect') return COLLECT_HELP
  return ROOT_HELP
}

module.exports = { COLLECT_HELP, ROOT_HELP, helpFor }
