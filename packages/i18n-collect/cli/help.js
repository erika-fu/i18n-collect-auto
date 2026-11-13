const COLLECT_HELP = `i18n-collect collect

Run a Webpack collection compilation and atomically publish collection outputs
(source-catalog.json, analysis-report.json, and the runtime dictionary / source
map) from the live module graph. Unreachable resources are excluded. Collection
failures do not publish partial results; previous formal outputs are preserved.

Usage:
  i18n-collect collect [options]

Options:
  --cwd <dir>              Project root. Defaults to the current directory.
  --webpack-config <file>  Webpack config path. Defaults to webpack.config.js.
  --include <pattern>      Replace collection include patterns. Repeatable.
  --exclude <pattern>      Replace collection exclude patterns. Repeatable.
  --context-filter <name>  Replace collection-context filters. Repeatable.
  --watch                  Keep Webpack watch mode. Publishes after each
                           successful collection round and preserves previous
                           outputs after a failed round. Cannot be combined
                           with --replace.
  --replace                Replace eligible runtime messages in the same
                           collection loader pass and emit the configured
                           webpack bundle. Requires buildReplacement.enabled.
                           Application source files are not modified.
  --json                   Print the collection report as JSON on stdout.
  -h, --help               Show this help.

Exit codes:
  0  collection finished
  1  configuration failure
  2  collection failure
  3  webpack build failure
`

const TRANSLATE_HELP = `i18n-collect translate

Fill missing target-locale catalog entries from a project translation provider.
Existing target text stays unless --retranslate is set. Target keys absent from the current
source catalog are reported as stale and kept unless --prune is set. This command does not
rewrite application source.

Usage:
  i18n-collect translate [options]

Options:
  --cwd <dir>         Project root. Defaults to the current directory.
  --provider <path>   Project-relative provider module. Replaces translationProvider.
  --locale <tag>      Target locale. Repeat to set several. Replaces targetLocales.
  --retranslate       Replace existing target text with a new provider draft.
  --prune             Remove stale target keys and their review state.
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
  A target key absent from the current source catalog is stale: reported, kept by default, and removed from the target catalog and review state only with --prune.
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

Preview safe source replacements from the same current analysis and source-catalog keys as build.
Without --write, this command is a dry-run: it does not write source files or catalog files, does not install dependencies, and does not rewrite application bootstrap.
--write prepares every changed JavaScript, TypeScript, and Vue source file and commits that set together.
It does not write catalogs or maintain replacement bookkeeping; version control is the rollback mechanism.
A failed commit restores the original source set. Source text and ranges are revalidated immediately before writing.

Usage:
  i18n-collect replace --adapter <name> [options]

Options:
  --adapter <name>   Runtime adapter. Names: vue2, vue3, js.
  --cwd <dir>        Project root. Defaults to the current directory.
  --strict           Fail when any candidate is skipped. Nothing is written.
  --write            Commit source replacements only. Does not write catalogs or replacement metadata.
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
  Dynamic, structured, audit-only, and needs-review findings are not automatically rewritten.
  Object keys, switch cases, and other unsupported positions are skipped with a source location and a reason.
  Equal exact text shares one automatic key; an explicit i18n-key directive selects its declared key.
  Overlapping occurrence claims are skipped, and neither claim is rewritten.
  An already localized t(), $t(), or this.$t() call is left unchanged, including a legacy call whose argument is the MD5 of the collected text.
  --strict turns skipped candidates into failure. Already localized calls are not skipped.

Exit codes:
  0  finished
  1  configuration failure, including a missing runtime integration
  2  analysis failure, including a stale or missing source catalog
  6  source files could not be saved
  7  strict mode found a skipped candidate, or source changed between planning and write
`

const VERIFY_HELP = `i18n-collect verify

Removed. Use i18n-collect collect then i18n-collect check for freshness and
project localization completeness.

Usage:
  i18n-collect verify [options]

Exit codes:
  1  configuration failure with migration guidance
`

const CHECK_POLICY_HELP = `i18n-collect check-policy

Removed. Use i18n-collect check. Completeness evaluation includes complete-static-copy
baseline policy and runtime-multilingual boundary policy without writing files.

Usage:
  i18n-collect check-policy [options]

Exit codes:
  1  configuration failure with migration guidance
`

const REVIEW_HELP = `i18n-collect review

List unresolved dynamic message candidates and record auditable translate,
intentionally-ignore, or defer decisions. Translate decisions atomically update
dynamic-message-decisions.json and explicit-messages.json together; explicit-messages.json
remains the authority for explicit keys, canonical Chinese source text, and placeholder
contracts.

After a Translate decision, --write previews a source diff and, only after confirmation,
migrates proven-safe concatenation and template-literal expressions to explicit
localization calls. Expressions outside that proven-safe boundary are refused rather than
guessed. --write is the only source-write flag; the legacy apply flag is not accepted.

Usage:
  i18n-collect review [candidate-id] [options]

Options:
  --cwd <dir>          Project root. Defaults to the current directory.
  --status <name>      Filter listed candidates. Names: needs-review,
                       intentionally-ignored, translation-approved, migrated.
                       Defaults to needs-review when listing.
  --translate          Record a Translate decision. Requires --key and --source.
  --ignore             Record an intentionally-ignore decision. Requires --reason.
  --defer              Record a defer decision. Optional --reason.
  --key <id>           Explicit localization key for --translate.
  --source <text>      Canonical Chinese source text for --translate.
  --reason <text>      Non-empty reason for --ignore, optional for --defer.
  --write              Preview and write a proven-safe source migration for a
                       translation-approved candidate. Requires --adapter and
                       confirmation (--yes non-interactively). May combine with
                       --translate to decide and write in one confirmed step.
  --adapter <name>     Replacement call shape for --write: js, vue2, or vue3.
  --bulk               Apply the decision to every unresolved candidate compatible
                       with the given candidate id. Persists one decision per occurrence.
  --prune              Remove eligible migrated terminal decisions only. Never removes
                       active translate, ignore, or defer decisions.
  --yes                Confirm a mutating decision, prune, or --write non-interactively.
  --json               Print the review report as JSON on stdout.
  -h, --help           Show this help.

Exit codes:
  0  review finished
  1  configuration failure, missing confirmation, validation failure, or refused write
  2  analysis failure
  6  decision, explicit-message, or source files could not be saved
`

const ROOT_HELP = `i18n-collect

Primary workflow: collect, review, translate, build, replace, and check.

Usage:
  i18n-collect <command> [options]

Commands:
  collect       Webpack collection; atomically publishes source-catalog.json, analysis-report.json, and dictionary outputs.
  translate     Fill target-locale catalogs and translation-state.json only. Independent of Webpack; no network during compilation.
  build         Verify collection outputs by default; rewrite in-memory modules and the formal webpack bundle only.
  replace       Preview source replacements, or write application source with --write.
  check         Read-only project localization completeness (audits, dynamic candidates, hybrid policy).
  review        List and decide dynamic message candidates; optional proven-safe --write for source migrations.
  migrate-keys  One-shot migration of per-occurrence automatic keys to text-hash keys.
  scan          Filesystem analysis; writes source-catalog.json and analysis-report.json only (non-Webpack / legacy path).
  verify        Removed; use collect then check.
  run           Removed; use collect, translate, replace, build, and check directly.
  check-policy  Removed; use check.

Run i18n-collect <command> --help for command options and write ownership.
`

const RUN_HELP = `i18n-collect run

Removed. Use i18n-collect collect, translate, replace, build, and check directly.

Usage:
  i18n-collect run [options]

Exit codes:
  1  configuration failure with migration guidance
`

const MIGRATE_KEYS_HELP = `i18n-collect migrate-keys

Migrate a per-occurrence automatic-key catalog to deterministic exact-text hash keys.
Equal exact source text shares one automatic key. Explicit keys stay unchanged.
When every old automatic key for one source text has the same target translation, that
translation is reused under the new hash key. Conflicting historical translations stop the
command with a report and write nothing; assign explicit keys, then retry.
Successful runs rewrite the source-locale catalog, target catalogs, and source-catalog.json
without occurrence identities. This command does not rewrite application source.

Usage:
  i18n-collect migrate-keys [options]

Options:
  --cwd <dir>     Project root. Defaults to the current directory.
  --locale <tag>  Target locale to migrate. Repeat to set several. Defaults to targetLocales.
  --json          Print the migration report as JSON on stdout.
  -h, --help      Show this help.

Exit codes:
  0  migration finished
  1  configuration failure
  2  migration conflict or hash collision
  6  catalogs could not be saved
`

const SCAN_HELP = `i18n-collect scan

Analyze JavaScript, TypeScript, Vue, standalone HTML, and style sources without webpack.
Classify complete static copy as automatically runtime-localizable, existing static
t/$t/this.$t calls as already localized, and Chinese on audit surfaces (standalone HTML,
proven CSS generated content, and conservative SCSS/Sass/Less/Stylus review items) as
Chinese source audit findings that never receive keys or enter catalogs.
Writes only the source catalog (source-catalog.json) and the analysis report
(analysis-report.json). Adjacent comments of the form i18n-ignore: <reason> mark an
associated audit finding as intentionally ignored. This command does not rewrite application source,
target catalogs, translation state, or the source-locale runtime catalog, and it does not make
network requests.

Usage:
  i18n-collect scan [options]

Options:
  --cwd <dir>               Project root. Defaults to the current directory.
  --include <pattern>       Replace the configured include scope. Repeat to set several patterns.
  --exclude <pattern>       Replace the configured exclude scope. Repeat to set several patterns.
  --context-filter <name>   Replace configured context filters. Repeat to select several.
                            Names: logging, tests, analytics.
  --json                    Print the scan report as JSON on stdout.
  -h, --help                Show this help.

Exit codes:
  0  scan finished
  1  configuration failure
  2  collection failure, including a malformed directive or incompatible source catalog key
`

const CHECK_HELP = `i18n-collect check

Evaluate project localization completeness without writing files.
Check analyzes sources in memory, compares them with the committed source catalog from
collect (or scan), and reports runtime localization coverage, Chinese source audit
disposition, dynamic message candidate dispositions, target-locale coverage,
complete-static-copy baseline policy, and runtime-multilingual boundary policy.
Completeness fails for a stale or missing source catalog, dynamic candidates still
needs-review or still translation-approved (awaiting verified source migration), deferred
dynamic candidates when deferredDynamicCandidates is "error" (the default), unresolved or
needs-review audit findings, missing translations, needs-review translations, new or
modified complete-static-copy violations, or runtime-multilingual boundary violations.
Configure deferredDynamicCandidates to "warn" to report deferred candidates without failing
while still blocking never-reviewed candidates. Stale target keys and grandfathered baseline
entries are reported but do not fail completeness. Intentionally ignored audit findings
and intentionally ignored dynamic candidates stay visible with their reason and count as
disposed. This command never rewrites project files.

Usage:
  i18n-collect check [options]

Options:
  --cwd <dir>               Project root. Defaults to the current directory.
  --include <pattern>       Replace the configured include scope. Repeat to set several patterns.
  --exclude <pattern>       Replace the configured exclude scope. Repeat to set several patterns.
  --context-filter <name>   Replace configured context filters. Repeat to select several.
                            Names: logging, tests, analytics.
  --json                    Print the completeness report as JSON on stdout.
  -h, --help                Show this help.

Exit codes:
  0  project localization completeness passed
  1  configuration failure
  2  incomplete localization, analysis failure, or malformed localization artifacts
`

const BUILD_HELP = `i18n-collect build

Run Build replacement through the project's existing webpack integration.
Phase 1 runs a Webpack collection compilation and verifies the result against the
committed source catalog (source-catalog.json) by default. Phase 2 rewrites matching
JavaScript, TypeScript, and Vue SFC modules in memory and emits the formal bundle.
By default build does not create, update, restore, or delete source catalog, audit,
target catalog, or translation-state files. Application source files are not modified.
Requires buildReplacement.enabled in i18n-collect.config.js with adapter js, vue2, or vue3.
Build replacement is fail-closed: unsupported, stale, mismatched, or otherwise unsafe
runtime-localizable positions abort the build with structured diagnostics. HTML and style
audit findings are not passed to the replacement planner. A failed analysis keeps the
previous formal bundle. A failed replacement keeps the previous formal bundle and leaves
no staging leftovers. Unlike source replace, there is no skipped mode.

Usage:
  i18n-collect build [options]

Options:
  --cwd <dir>               Project root. Defaults to the current directory.
  --webpack-config <path>   Webpack configuration to run. Defaults to webpack.config.js.
  --include <pattern>       Replace the configured include scope. Repeat to set several patterns.
  --exclude <pattern>       Replace the configured exclude scope. Repeat to set several patterns.
  --context-filter <name>   Replace configured context filters. Repeat to select several.
                            Names: logging, tests, analytics.
  --write-collection        Explicit development build-write mode. Allows this build to
                            publish collection outputs from the analysis compilation.
                            Without this flag, build only verifies committed outputs.
  --watch                   Keep a serial analyze-then-replace loop. Each cycle verifies the
                            committed source catalog (unless --write-collection), then
                            publishes the formal bundle. Invalidations are coalesced; at most
                            one coordinated cycle runs at a time. Watch does not start an
                            implicit collect without --write-collection.
  --json                    Print the build report as JSON on stdout.
  -h, --help                Show this help.

Exit codes:
  0  build finished
  1  configuration failure
  2  analysis failure, including a stale source catalog, malformed directive, or localization key conflict
  3  build / replacement failure, including unsafe runtime-localizable positions
`

function helpFor(command) {
  if (command === 'scan') return SCAN_HELP
  if (command === 'migrate-keys') return MIGRATE_KEYS_HELP
  if (command === 'collect') return COLLECT_HELP
  if (command === 'translate') return TRANSLATE_HELP
  if (command === 'replace') return REPLACE_HELP
  if (command === 'review') return REVIEW_HELP
  if (command === 'build') return BUILD_HELP
  if (command === 'run') return RUN_HELP
  if (command === 'check') return CHECK_HELP
  if (command === 'check-policy') return CHECK_POLICY_HELP
  if (command === 'verify') return VERIFY_HELP
  return ROOT_HELP
}

module.exports = {
  BUILD_HELP,
  CHECK_HELP,
  CHECK_POLICY_HELP,
  COLLECT_HELP,
  MIGRATE_KEYS_HELP,
  REPLACE_HELP,
  REVIEW_HELP,
  ROOT_HELP,
  RUN_HELP,
  SCAN_HELP,
  TRANSLATE_HELP,
  VERIFY_HELP,
  helpFor
}
