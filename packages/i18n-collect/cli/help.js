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
  2  collection failure, including a malformed i18n-key directive, a localization key conflict, or an occurrence identity ambiguity
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

const REPLACE_HELP = `i18n-collect replace

Preview safe source replacements backed by the keyed catalog.
Without --write, this command is a dry-run: it does not write source files or catalog files, does not install dependencies, and does not rewrite application bootstrap.
--write prepares every changed source file, the keyed catalogs, and replacement metadata, then commits that set together. A failed commit restores those files.

Usage:
  i18n-collect replace --adapter <name> [options]

Options:
  --adapter <name>   Runtime adapter. Names: vue2, vue3, js.
  --cwd <dir>        Project root. Defaults to the current directory.
  --strict           Fail when any candidate is skipped. Nothing is written.
  --write            Commit source replacements, keyed catalogs, and replacement metadata.
  --json             Print the replacement report as JSON on stdout.
  -h, --help         Show this help.

Adapters:
  vue2  Vue 2 templates and Options API instance methods.
        Template text becomes {{ $t('key') }}.
        A static allowlisted attribute becomes :name="$t('key')".
        A template expression or dynamic attribute string becomes $t('key').
        A string in an Options API instance method becomes this.$t('key').
        Requires vue-i18n 8 and an existing Vue.use(VueI18n) or new VueI18n(...) call.
  vue3  Vue 3 templates, script setup, and Options API instance methods.
        Templates use the same $t calls as vue2.
        script setup uses t('key') where t is already in scope.
        Options API instance methods use this.$t('key').
        Requires vue-i18n 9 or newer and an existing createI18n(...) call.
  js    Framework-neutral JavaScript and TypeScript.
        A supported expression string or template literal becomes t('key') where t is already in scope.
        Requires an existing module that exports a function named t.
        This command does not insert imports.

Supported script positions:
  variable initializers, assignments, returns, throws, call and constructor arguments,
  array elements, object values, conditionals, logical and binary operands,
  sequence expressions, expression statements, arrow function bodies, default exports,
  and template literals in those positions.

Skipped:
  React JSX, standalone HTML, and CSS generated content are outside replacement scope.
  Object keys, switch cases, and other unsupported positions are skipped with a source location and a reason.
  An already localized t(), $t(), or this.$t() call is left unchanged, so a repeated run does not nest it.
  --strict turns skipped candidates into failure. Already localized calls are not skipped.

Exit codes:
  0  finished
  1  configuration failure, including a missing runtime integration
  6  replacement files could not be saved
  7  strict mode found a skipped candidate
`

const ROOT_HELP = `i18n-collect

Automation-friendly commands for this workspace.

Usage:
  i18n-collect <command> [options]

Commands:
  collect    Collect Chinese user-facing copy through the project's webpack integration.
  translate  Fill target-locale catalogs through a project translation provider.
  replace    Preview safe source replacements, or commit them with --write.
  run        Run selected collect, translate, and replace stages.

Run i18n-collect <command> --help for command options.
`

const RUN_HELP = `i18n-collect run

Compose collection, translation, and replacement into one non-interactive workflow.
Selected stages always run in this order: collect, then translate, then replace.
A failing stage stops the workflow and keeps that stage's exit code and diagnostic.
Replacement stays a dry-run unless --write is set. --allow-network and --strict mean the same thing here as they do on translate and replace.

Workflows:
  --collect                         Collect only.
  --translate                       Translate only.
  --collect --translate             Collect, then translate.
  --collect --replace --adapter js  Collect, then preview replacements.
  --collect --translate --replace --adapter js --write
                                    Collect, translate, and commit replacements.

Usage:
  i18n-collect run (--collect | --translate | --replace)... [options]

Options:
  --collect                 Run collection.
  --translate               Run translation.
  --replace                 Run replacement. Requires --adapter.
  --cwd <dir>               Project root. Defaults to the current directory.
  --webpack-config <path>   Collect: webpack configuration. Defaults to webpack.config.js.
  --include <pattern>       Collect: replace the configured include scope. Repeatable.
  --exclude <pattern>       Collect: replace the configured exclude scope. Repeatable.
  --context-filter <name>   Collect: replace configured context filters. Repeatable.
  --provider <path>         Translate: project-relative provider module.
  --locale <tag>            Translate: target locale. Repeatable.
  --retranslate             Translate: replace existing target text.
  --failure <policy>        Translate: partial or strict.
  --allow-network           Translate: allow a network provider to send source text.
  --adapter <name>          Replace: vue2, vue3, or js.
  --strict                  Replace: fail when any candidate is skipped. Nothing is written.
  --write                   Replace: commit source files, keyed catalogs, and replacement metadata.
  --json                    Print the workflow report as JSON on stdout.
  -h, --help                Show this help.

Exit codes are the exit code of the stage that finished the workflow:
  0  every selected stage finished
  1  configuration failure
  2  collection failure
  3  build failure
  4  translation failure
  5  network translation was not authorized
  6  catalogs or replacement files could not be saved
  7  strict mode found a skipped candidate
`

function helpFor(command) {
  if (command === 'collect') return COLLECT_HELP
  if (command === 'translate') return TRANSLATE_HELP
  if (command === 'replace') return REPLACE_HELP
  if (command === 'run') return RUN_HELP
  return ROOT_HELP
}

module.exports = { COLLECT_HELP, REPLACE_HELP, ROOT_HELP, RUN_HELP, TRANSLATE_HELP, helpFor }
