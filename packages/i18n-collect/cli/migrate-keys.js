const fs = require('fs')
const path = require('path')
const { catalogFormat } = require('../mycommon/catalog-format')
const { catalogFiles, loadConfig } = require('../mycommon/config')
const { migrateToTextHashKeys } = require('../mycommon/migrate-text-hash-keys')
const { SOURCE_CATALOG_VERSION } = require('../mycommon/project-analysis')
const { SOURCE_CATALOG_FILE } = require('../mycommon/formal-outputs')
const { commitFiles, json, recoverCommits } = require('../mycommon/output')

const EXIT = {
  ok: 0,
  configuration: 1,
  migration: 2,
  storage: 6
}

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

function failure(error, jsonMode) {
  const kind = error && EXIT[error.kind] != null ? error.kind : 'configuration'
  const message = error && error.message ? error.message : String(error)
  const stdout = jsonMode
    ? jsonText({ command: 'migrate-keys', failure: kind, message, ok: false })
    : ''
  return outcome(EXIT[kind], stdout, `${kind}: ${message}\n`)
}

function take(args, index, flag) {
  const next = args[index + 1]
  if (next === undefined || next.startsWith('-')) throw commandError('configuration', `${flag} requires a value`)
  return next
}

function parseMigrateKeysArgs(args) {
  const parsed = {
    cwd: null,
    json: false,
    locales: null
  }
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
    else if (flag === '--locale') {
      if (!parsed.locales) parsed.locales = []
      parsed.locales.push(value('--locale'))
    } else if (flag.startsWith('-')) throw commandError('configuration', `unknown option "${flag}"`)
    else throw commandError('configuration', `unexpected argument "${arg}"`)
  }
  return parsed
}

function localeFile(config, locale) {
  return path.posix.join(config.catalogDir, `${locale}${catalogFormat(config.catalogFormat).extension}`)
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw commandError('configuration', `cannot read ${label}: ${error.message}`)
  }
}

function migrateKeys(args) {
  let parsed
  try {
    parsed = parseMigrateKeysArgs(args)
  } catch (error) {
    return failure(error, false)
  }
  const root = path.resolve(parsed.cwd || process.cwd())
  try {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw commandError('configuration', `project root is not a directory: ${root}`)
    }
    const config = loadConfig({ root })
    const files = catalogFiles(config)
    const sourcePath = path.join(root, files.messages)
    const metadataPath = path.join(root, files.metadata)
    if (!fs.existsSync(sourcePath)) {
      throw commandError('configuration', `missing source catalog: ${files.messages}`)
    }
    if (!fs.existsSync(metadataPath)) {
      throw commandError('configuration', `missing catalog metadata: ${files.metadata}`)
    }

    const adapter = catalogFormat(config.catalogFormat)
    let sourceCatalog
    try {
      sourceCatalog = adapter.parse(fs.readFileSync(sourcePath, 'utf8'))
    } catch (error) {
      throw commandError('configuration', `cannot read source catalog ${files.messages}: ${error.message}`)
    }
    const metadata = readJson(metadataPath, files.metadata)
    const locales = parsed.locales && parsed.locales.length
      ? parsed.locales
      : config.targetLocales.slice()
    if (locales.length === 0) {
      throw commandError('configuration', 'migrate-keys requires at least one target locale via config or --locale')
    }

    recoverCommits(path.join(root, config.catalogDir))

    const targets = {}
    const targetPaths = {}
    for (const locale of locales) {
      const relative = localeFile(config, locale)
      const absolute = path.join(root, relative)
      targetPaths[locale] = { relative, absolute }
      if (!fs.existsSync(absolute)) {
        targets[locale] = {}
        continue
      }
      try {
        targets[locale] = adapter.parse(fs.readFileSync(absolute, 'utf8'))
      } catch (error) {
        throw commandError('configuration', `cannot read target catalog ${relative}: ${error.message}`)
      }
    }

    const result = migrateToTextHashKeys({ sourceCatalog, metadata, targets })
    if (!result.ok) {
      throw commandError('migration', result.report)
    }

    const sourceCatalogRelative = path.posix.join(config.catalogDir, SOURCE_CATALOG_FILE)
    const writeTargets = [
      {
        file: path.resolve(root, sourceCatalogRelative),
        content: json({
          version: SOURCE_CATALOG_VERSION,
          messages: result.sourceCatalog
        })
      },
      {
        file: sourcePath,
        content: adapter.serialize(result.sourceCatalog)
      }
    ]
    for (const locale of locales) {
      writeTargets.push({
        file: targetPaths[locale].absolute,
        content: adapter.serialize(result.targets[locale] || {})
      })
    }

    try {
      commitFiles(writeTargets)
    } catch (error) {
      throw commandError('storage', error.message)
    }

    const summary = {
      command: 'migrate-keys',
      ok: true,
      sourceCatalog: sourceCatalogRelative,
      sourceLocaleCatalog: files.messages,
      targets: locales.map(locale => targetPaths[locale].relative),
      mappedKeys: Object.keys(result.keyMapping).length
    }
    if (parsed.json) return outcome(EXIT.ok, jsonText(summary), '')
    return outcome(
      EXIT.ok,
      `migrate-keys: remapped ${summary.mappedKeys} key(s); wrote ${sourceCatalogRelative} and ${locales.length} target catalog(s)\n`,
      ''
    )
  } catch (error) {
    return failure(error, parsed.json)
  }
}

module.exports = {
  EXIT,
  migrateKeys,
  parseMigrateKeysArgs
}
