const fs = require('fs')
const path = require('path')
const {
  comparePolicyBaseline,
  readPolicyBaseline,
  scanCompleteStaticCopyPolicy
} = require('../mycommon/complete-static-copy-policy')
const {
  readRuntimeMultilingualBoundaries,
  scanRuntimeMultilingualPolicy
} = require('../mycommon/runtime-multilingual-policy')
const { identityFiles, loadConfig, setCollectionOverrides, clearCollectionOverrides } = require('../mycommon/config')
const { isResourceIncluded } = require('../myloader/resource')

const EXIT = {
  ok: 0,
  configuration: 1,
  policy: 2
}

const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.html', '.htm', '.css'
])

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.cache'
])

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
  const kind = error && EXIT[error.kind] != null ? error.kind : 'configuration'
  const message = error && error.message ? error.message : String(error)
  const stdout = json
    ? jsonText({ command: 'check-policy', failure: kind, message, ok: false })
    : ''
  return outcome(EXIT[kind], stdout, `${kind}: ${message}\n`)
}

function take(args, index, flag) {
  const next = args[index + 1]
  if (next === undefined || next.startsWith('-')) throw commandError('configuration', `${flag} requires a value`)
  return next
}

function parseArgs(args) {
  const parsed = {
    cwd: null,
    exclude: undefined,
    include: undefined,
    json: false
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
    else if (flag === '--include') {
      if (!parsed.include) parsed.include = []
      parsed.include.push(value('--include'))
    } else if (flag === '--exclude') {
      if (!parsed.exclude) parsed.exclude = []
      parsed.exclude.push(value('--exclude'))
    } else if (flag.startsWith('-')) throw commandError('configuration', `unknown option "${flag}"`)
    else throw commandError('configuration', `unexpected argument "${arg}"`)
  }
  return parsed
}

function listSourceFiles(root, config) {
  const files = []
  const visit = directory => {
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      return
    }
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        visit(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const projectPath = path.relative(root, absolute).split(path.sep).join('/')
      const extension = path.posix.extname(projectPath).toLowerCase()
      if (!SOURCE_EXTENSIONS.has(extension)) continue
      if (!isResourceIncluded(projectPath, config)) continue
      files.push({ absolute, projectPath })
    }
  }
  visit(root)
  return files.sort((left, right) => left.projectPath.localeCompare(right.projectPath))
}

function formatViolation(item) {
  const where = `${item.path}:${item.start.line}:${item.start.column}`
  return `${where} [${item.reason}] ${JSON.stringify(item.text)}`
}

function policyFailureMessage(comparison, multilingualViolations = []) {
  const lines = []
  if (comparison.newViolations.length || comparison.modifiedViolations.length) {
    lines.push('policy: complete-static-copy violations require migration or baseline update')
    for (const item of comparison.newViolations) {
      lines.push(`new: ${formatViolation(item)}`)
    }
    for (const item of comparison.modifiedViolations) {
      lines.push(`modified: ${formatViolation(item.current)}`)
    }
    const structured = [...comparison.newViolations, ...comparison.modifiedViolations.map(item => item.current)]
      .some(item => item.reason === 'structured-fragmentation')
    if (structured) {
      lines.push(
        'hint: structured messages with links, emphasis, controls, or slots must use explicit localization (declare the message in explicit-messages.json and render through a static localized call with named placeholders)'
      )
    }
  }
  if (multilingualViolations.length) {
    lines.push(
      'policy: runtime-multilingual boundaries reject direct user-facing source text; use explicit localization'
    )
    for (const item of multilingualViolations) {
      const boundary = item.boundaryId ? ` boundary=${item.boundaryId}` : ''
      lines.push(`runtime-multilingual: ${formatViolation(item)}${boundary}`)
    }
    lines.push(
      'hint: declare messages in explicit-messages.json and render them with static t()/$t()/this.$t() calls inside the boundary'
    )
  }
  return `${lines.join('\n')}\n`
}

function checkPolicy(args) {
  let parsed
  try {
    parsed = parseArgs(args)
  } catch (error) {
    return failure(error, false)
  }
  const root = path.resolve(parsed.cwd || process.cwd())
  try {
    if (parsed.include || parsed.exclude) {
      setCollectionOverrides({
        include: parsed.include,
        exclude: parsed.exclude
      })
    }
    const config = loadConfig({ root })
    const identities = identityFiles(config)
    const baselinePath = path.join(config.root, identities.completeStaticCopyBaseline)
    const boundariesPath = path.join(config.root, identities.runtimeMultilingualBoundaries)
    const sources = listSourceFiles(config.root, config).map(file => ({
      path: file.projectPath,
      absolutePath: file.absolute,
      source: fs.readFileSync(file.absolute, 'utf8')
    }))
    const policyOptions = {
      root: config.root,
      vueVersion: config.vueVersion
    }
    const violations = scanCompleteStaticCopyPolicy(sources, policyOptions)
    const baseline = readPolicyBaseline(baselinePath)
    const comparison = comparePolicyBaseline(violations, baseline)
    const boundaries = readRuntimeMultilingualBoundaries(boundariesPath, config.root)
    const multilingualViolations = scanRuntimeMultilingualPolicy(sources, boundaries, {
      ...policyOptions,
      attributeAllowlist: config.attributeAllowlist
    })
    const completeStaticFailing = [
      ...comparison.newViolations,
      ...comparison.modifiedViolations.map(item => item.current)
    ]
    const failing = completeStaticFailing.length > 0 || multilingualViolations.length > 0
    const report = {
      command: 'check-policy',
      ok: !failing,
      baseline: identities.completeStaticCopyBaseline,
      runtimeMultilingualBoundaries: identities.runtimeMultilingualBoundaries,
      scannedFiles: sources.length,
      violations: violations.length,
      grandfathered: comparison.grandfathered.length,
      newViolations: comparison.newViolations,
      modifiedViolations: comparison.modifiedViolations.map(item => item.current),
      runtimeMultilingualViolations: multilingualViolations
    }
    if (parsed.json) {
      return outcome(
        failing ? EXIT.policy : EXIT.ok,
        jsonText(report),
        failing
          ? (
            multilingualViolations.length && !completeStaticFailing.length
              ? 'policy: runtime-multilingual boundaries reject direct user-facing source text\n'
              : 'policy: complete-static-copy violations require migration or baseline update\n'
          )
          : ''
      )
    }
    if (!failing) {
      return outcome(
        EXIT.ok,
        `check-policy: ${violations.length} violation(s), ${comparison.grandfathered.length} grandfathered, 0 new or modified; ${multilingualViolations.length} runtime-multilingual\n`,
        ''
      )
    }
    return outcome(EXIT.policy, '', policyFailureMessage(comparison, multilingualViolations))
  } catch (error) {
    return failure(error, parsed.json)
  } finally {
    clearCollectionOverrides()
  }
}

module.exports = { EXIT, checkPolicy }
