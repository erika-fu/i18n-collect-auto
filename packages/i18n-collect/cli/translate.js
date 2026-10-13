const fs = require('fs')
const path = require('path')
const { catalogFormat } = require('../mycommon/catalog-format')
const { catalogFiles, loadConfig, translationSettings } = require('../mycommon/config')
const { applyDrafts, needsReview, planTranslation, serializeState } = require('../mycommon/translate')

const EXIT = {
  ok: 0,
  configuration: 1,
  translation: 4
}
const REVIEW_NAME = 'translation-state.json'

function commandError(kind, message) {
  const error = new Error(message)
  error.kind = kind
  return error
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function outcome(code, stdout, stderr) {
  return { code, stdout, stderr }
}

function failure(error, json) {
  const kind = error && EXIT[error.kind] ? error.kind : 'translation'
  const message = error && error.message ? error.message : String(error)
  const stdout = json
    ? jsonText({ command: 'translate', failure: kind, message, ok: false })
    : ''
  return outcome(EXIT[kind], stdout, `${kind}: ${message}\n`)
}

function take(args, index, flag) {
  const next = args[index + 1]
  if (next === undefined || next.startsWith('-')) throw commandError('configuration', `${flag} requires a value`)
  return next
}

function parseTranslateArgs(args) {
  const parsed = { cwd: null, failure: null, json: false, locales: null, provider: null, retranslate: false }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    const eq = arg.indexOf('=')
    const flag = eq === -1 ? arg : arg.slice(0, eq)
    const inline = eq === -1 ? null : arg.slice(eq + 1)
    const value = name => {
      if (inline !== null) {
        if (!inline) throw commandError('configuration', `${name} requires a value`)
        return inline
      }
      const next = take(args, index, name)
      index += 1
      return next
    }
    if (flag === '--json') {
      if (inline !== null) throw commandError('configuration', 'unknown option "--json"')
      parsed.json = true
    } else if (flag === '--cwd') parsed.cwd = value('--cwd')
    else if (flag === '--provider') parsed.provider = value('--provider')
    else if (flag === '--locale') {
      if (!parsed.locales) parsed.locales = []
      parsed.locales.push(value('--locale'))
    } else if (flag === '--retranslate') {
      if (inline !== null) throw commandError('configuration', 'unknown option "--retranslate"')
      parsed.retranslate = true
    } else if (flag === '--failure') parsed.failure = value('--failure')
    else if (flag.startsWith('-')) throw commandError('configuration', `unknown option "${flag}"`)
    else throw commandError('configuration', `unexpected argument "${arg}"`)
  }
  return parsed
}

function localeFile(config, locale) {
  return path.posix.join(config.catalogDir, `${locale}${catalogFormat(config.catalogFormat).extension}`)
}

function reviewFile(config) {
  return path.posix.join(config.catalogDir, REVIEW_NAME)
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readMessages(root, relative, adapter, label) {
  const file = path.join(root, relative)
  if (!fs.existsSync(file)) return null
  try {
    return adapter.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw commandError('configuration', `cannot read ${label} ${relative}: ${error.message}`)
  }
}

function readState(root, relative) {
  const file = path.join(root, relative)
  if (!fs.existsSync(file)) return { version: 1, locales: {} }
  let value
  try {
    value = readJsonFile(file)
  } catch (error) {
    throw commandError('configuration', `cannot read translation state ${relative}: ${error.message}`)
  }
  if (!value || value.version !== 1 || !value.locales || typeof value.locales !== 'object' || Array.isArray(value.locales)) {
    throw commandError('configuration', `translation state ${relative} must be version 1`)
  }
  for (const [locale, entries] of Object.entries(value.locales)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      throw commandError('configuration', `translation state for "${locale}" must be an object`)
    }
    for (const [key, record] of Object.entries(entries)) {
      const review = record && record.review
      if (!record || typeof record.sourceFingerprint !== 'string' || (review !== 'current' && review !== 'needs-review')) {
        throw commandError('configuration', `translation state for "${locale}" key "${key}" is invalid`)
      }
    }
  }
  return value
}

function alignedEntries(messages, metadata, metadataFile) {
  const entries = metadata && metadata.version === 1 && metadata.entries
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw commandError('configuration', `catalog metadata ${metadataFile} must be version 1`)
  }
  const messageKeys = Object.keys(messages).sort()
  const entryKeys = Object.keys(entries).sort()
  if (messageKeys.join('\0') !== entryKeys.join('\0')) {
    throw commandError('configuration', 'source catalog and catalog metadata name different keys')
  }
  for (const key of entryKeys) {
    const entry = entries[key]
    if (!entry || messages[key] !== entry.source) {
      throw commandError('configuration', `source catalog and catalog metadata disagree on "${key}"`)
    }
    if (typeof entry.fingerprint !== 'string' || entry.fingerprint.length === 0) {
      throw commandError('configuration', `catalog metadata entry "${key}" has no source fingerprint`)
    }
  }
  return entries
}

function loadProvider(root, specifier) {
  const file = path.resolve(root, specifier)
  if (!file.startsWith(root + path.sep) && file !== root) {
    throw commandError('configuration', `translation provider must stay inside the project root`)
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw commandError('configuration', `missing translation provider: ${specifier}`)
  }
  let loaded
  try {
    delete require.cache[require.resolve(file)]
    loaded = require(file)
  } catch (error) {
    throw commandError('configuration', `cannot load translation provider: ${error.message}`)
  }
  const translate = typeof loaded === 'function' ? loaded : loaded && loaded.translate
  if (typeof translate !== 'function') {
    throw commandError('configuration', 'translation provider must export a translate function')
  }
  return translate
}

function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
}

function humanReport(report) {
  const lines = [
    `Created ${report.created.length}, replaced ${report.replaced.length}, kept ${report.kept.length}, marked ${report.needsReview.length} for review, failed ${report.failures.length}.`,
    `Retranslate: ${report.retranslate ? 'yes' : 'no'}`,
    `Policy: ${report.policy}`,
    `Applied: ${report.applied ? 'yes' : 'no'}`,
    `Locales: ${report.locales.join(', ')}`,
    `Catalogs: ${report.catalogs.join(', ')}`,
    `Review: ${report.review}`
  ]
  const list = (label, pairs) => {
    if (pairs.length === 0) return
    lines.push(`${label}:`)
    for (const pair of pairs) lines.push(`  ${pair.key} [${pair.locale}]`)
  }
  list('Created', report.created)
  list('Replaced', report.replaced)
  list('Kept', report.kept)
  list('Needs review', report.needsReview)
  if (!report.applied) lines.push('Catalogs were left unchanged.')
  list('Withheld', report.withheld)
  if (report.failures.length > 0) {
    lines.push('Failed:')
    for (const failure of report.failures) lines.push(`  ${failure.key} [${failure.locale}]: ${failure.message}`)
  }
  lines.push('')
  return lines.join('\n')
}

async function execute(parsed) {
  const root = path.resolve(parsed.cwd || process.cwd())
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw commandError('configuration', `project root is not a directory: ${root}`)
  }
  let config
  try {
    config = loadConfig({ root })
  } catch (error) {
    throw commandError('configuration', error.message)
  }
  const overrides = {}
  if (parsed.provider !== null) overrides.translationProvider = parsed.provider
  if (parsed.locales) overrides.targetLocales = parsed.locales
  if (parsed.failure !== null) overrides.translationFailure = parsed.failure
  if (Object.keys(overrides).length > 0) {
    try {
      config = translationSettings(config, overrides)
    } catch (error) {
      throw commandError('configuration', error.message.replace(/^Invalid i18n-collect\.config\.js:/, 'Invalid translate options:'))
    }
  }
  if (!config.translationProvider) throw commandError('configuration', 'translate requires a translation provider')
  if (config.targetLocales.length === 0) throw commandError('configuration', 'translate requires at least one target locale')

  const adapter = catalogFormat(config.catalogFormat)
  const files = catalogFiles(config)
  const messages = readMessages(root, files.messages, adapter, 'source catalog')
  if (!messages) throw commandError('configuration', `missing source catalog: ${files.messages}`)
  const metadataFile = path.join(root, files.metadata)
  if (!fs.existsSync(metadataFile)) throw commandError('configuration', `missing catalog metadata: ${files.metadata}`)
  let metadata
  try {
    metadata = readJsonFile(metadataFile)
  } catch (error) {
    throw commandError('configuration', `cannot read catalog metadata ${files.metadata}: ${error.message}`)
  }
  const entries = alignedEntries(messages, metadata, files.metadata)
  const targets = {}
  for (const locale of config.targetLocales) {
    const relative = localeFile(config, locale)
    targets[locale] = readMessages(root, relative, adapter, 'target catalog') || {}
  }
  const stateRelative = reviewFile(config)
  const state = readState(root, stateRelative)
  const plan = planTranslation({
    entries,
    targets,
    state,
    locales: config.targetLocales,
    retranslate: parsed.retranslate
  })
  const provider = loadProvider(root, config.translationProvider)
  let created = []
  let replaced = []
  let failures = []
  if (plan.items.length > 0) {
    let result
    try {
      result = await provider({
        sourceLocale: config.sourceLocale,
        locales: config.targetLocales,
        items: plan.items
      })
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      failures = plan.pending.map(pair => ({ key: pair.key, locale: pair.locale, message }))
    }
    if (failures.length === 0) {
      try {
        const applied = applyDrafts(plan, result)
        created = applied.created
        replaced = applied.replaced
        failures = applied.failures
      } catch (error) {
        failures = plan.pending.map(pair => ({
          key: pair.key,
          locale: pair.locale,
          message: error.message
        }))
      }
    }
  }
  const blocked = config.translationFailure === 'strict' && failures.length > 0
  if (!blocked) writeTranslation(root, config, adapter, plan)
  const withheld = blocked
    ? created.concat(replaced).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0))
    : []
  const report = {
    applied: !blocked,
    catalogs: config.targetLocales.map(locale => localeFile(config, locale)),
    command: 'translate',
    created: blocked ? [] : created,
    failures,
    kept: plan.kept,
    locales: config.targetLocales,
    needsReview: needsReview(blocked ? state : plan.nextState, entries, config.targetLocales),
    ok: failures.length === 0,
    policy: config.translationFailure,
    replaced: blocked ? [] : replaced,
    retranslate: parsed.retranslate,
    review: stateRelative,
    sourceLocale: config.sourceLocale,
    withheld
  }
  const stdout = parsed.json ? jsonText(report) : humanReport(report)
  if (failures.length > 0) {
    const message = failures.map(item => `${item.key} [${item.locale}]: ${item.message}`).join('; ')
    return outcome(EXIT.translation, stdout, `translation: ${message}\n`)
  }
  return outcome(EXIT.ok, stdout, '')
}

function hasRecords(state) {
  return Object.values(state.locales).some(entries => Object.keys(entries).length > 0)
}

function writeTranslation(root, config, adapter, plan) {
  for (const locale of config.targetLocales) {
    const catalog = plan.nextTargets[locale]
    const file = path.join(root, localeFile(config, locale))
    if (!fs.existsSync(file) && Object.keys(catalog).length === 0) continue
    writeIfChanged(file, adapter.serialize(catalog))
  }
  const stateFile = path.join(root, reviewFile(config))
  if (!fs.existsSync(stateFile) && !hasRecords(plan.nextState)) return
  writeIfChanged(stateFile, serializeState(plan.nextState))
}

async function translate(args) {
  const json = args.includes('--json')
  let parsed
  try {
    parsed = parseTranslateArgs(args)
  } catch (error) {
    return failure(error, json)
  }
  try {
    return await execute(parsed)
  } catch (error) {
    return failure(error, parsed.json)
  }
}

module.exports = { EXIT, translate }
