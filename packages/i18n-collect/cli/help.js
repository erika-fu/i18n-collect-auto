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

const TRANSLATE_HELP = `i18n-collect translate

Fill missing target-locale catalog entries from a project translation provider.
Existing target text stays unless --retranslate is set. This command does not rewrite application source.

Usage:
  i18n-collect translate [options]

Options:
  --cwd <dir>         Project root. Defaults to the current directory.
  --provider <path>   Project-relative provider module. Replaces translationProvider.
  --locale <tag>      Target locale. Repeat to set several. Replaces targetLocales.
  --retranslate       Replace existing target text with a new provider draft.
  --failure <policy>  Replace translationFailure. Policies: partial, strict.
  --allow-network     Allow a network provider to send source text outside the project.
  --json              Print the translation report as JSON on stdout.
  -h, --help          Show this help.

Provider contract:
  The module exports translate(request) or is that function.
  request is { sourceLocale, locales, items }.
  locales are the target locales requested for this run.
  items are { key, source, locales } for each source text selected for a draft.
  Selection: a missing target entry is always selected. An existing entry is selected only with --retranslate.
  A successful draft creates a missing entry or replaces a selected existing entry, and records the current source fingerprint with review "current".
  An existing entry whose recorded source fingerprint differs from the current source is kept and marked "needs-review". --retranslate may replace it; a successful draft then clears the mark.
  Failure policy: partial, the default, writes successful drafts and review marks, then exits 4 and lists failed pairs. strict writes nothing when any pair fails, so the catalogs stay as they were.
  Return { drafts: [{ key, locale, text }], failures?: [{ key, locale, message }] }.
  A failure for a pair suppresses its draft. A requested pair with neither is a failure.
  Set network: true on the exported function, or beside translate, when the provider can send source text outside the project.
  Interactive use asks for confirmation before that provider is called. Non-interactive and CI use do not ask; pass --allow-network.
  Without that authorization the provider is not called, catalogs stay unchanged, and the command exits 5.
  A local provider omits network. It does not need credentials, a vendor SDK, or network access.
  Target catalogs and review state are prepared together and replaced as one set. A failed or interrupted replacement restores the previous files. A caught write failure exits 6. A journal that is still there is restored the next time translate runs, before it reads catalogs.

Exit codes:
  0  translation finished
  1  configuration failure
  4  translation failure
  5  network translation was not authorized
  6  translation catalogs could not be saved
`

const ROOT_HELP = `i18n-collect

Automation-friendly commands for this workspace.

Usage:
  i18n-collect <command> [options]

Commands:
  collect    Collect Chinese user-facing copy through the project's webpack integration.
  translate  Fill target-locale catalogs through a project translation provider.

Run i18n-collect <command> --help for command options.
`

function helpFor(command) {
  if (command === 'collect') return COLLECT_HELP
  if (command === 'translate') return TRANSLATE_HELP
  return ROOT_HELP
}

module.exports = { COLLECT_HELP, ROOT_HELP, TRANSLATE_HELP, helpFor }
