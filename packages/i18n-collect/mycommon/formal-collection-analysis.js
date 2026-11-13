const {
  analysisReport,
  analyzeProject,
  analyzeSnapshots,
  buildSourceCatalog
} = require('./project-analysis')

function analyzeFormalCollection(input = {}) {
  const hasFiles = Object.prototype.hasOwnProperty.call(input, 'files')
  const hasSnapshots = Object.prototype.hasOwnProperty.call(input, 'snapshots')
  if (hasFiles === hasSnapshots) {
    throw new TypeError('formal collection analysis requires exactly one source adapter')
  }

  const {
    config = {},
    files,
    snapshots,
    policyFiles,
    ...analysisInput
  } = input
  const analysis = hasFiles
    ? analyzeProject({ ...analysisInput, files, config })
    : analyzeSnapshots(snapshots, config, {
      ...analysisInput,
      ...(policyFiles ? { files: policyFiles } : {})
    })

  return {
    analysis,
    sourceCatalog: buildSourceCatalog(analysis),
    report: analysisReport(analysis)
  }
}

module.exports = {
  analyzeFormalCollection
}
