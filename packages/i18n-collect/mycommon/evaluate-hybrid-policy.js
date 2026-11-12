const path = require('path')
const {
  comparePolicyBaseline,
  readPolicyBaseline,
  scanCompleteStaticCopyPolicy
} = require('./complete-static-copy-policy')
const {
  readRuntimeMultilingualBoundaries,
  scanRuntimeMultilingualPolicy
} = require('./runtime-multilingual-policy')
const { identityFiles } = require('./config')

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
  return lines.join('\n')
}

function evaluateHybridPolicy({ sources, config }) {
  const identities = identityFiles(config)
  const baselinePath = path.join(config.root, identities.completeStaticCopyBaseline)
  const boundariesPath = path.join(config.root, identities.runtimeMultilingualBoundaries)
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
  const ok = completeStaticFailing.length === 0 && multilingualViolations.length === 0
  return {
    ok,
    baseline: identities.completeStaticCopyBaseline,
    runtimeMultilingualBoundaries: identities.runtimeMultilingualBoundaries,
    violations: violations.length,
    grandfathered: comparison.grandfathered.length,
    newViolations: comparison.newViolations,
    modifiedViolations: comparison.modifiedViolations.map(item => item.current),
    runtimeMultilingualViolations: multilingualViolations,
    message: ok ? null : policyFailureMessage(comparison, multilingualViolations)
  }
}

module.exports = {
  evaluateHybridPolicy,
  formatViolation,
  policyFailureMessage
}
