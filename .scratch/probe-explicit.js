const { analyzeProject } = require('../packages/i18n-collect/mycommon/project-analysis')
const source = 'const m = `你好${name}世界`\n'
const a = analyzeProject({ files: [{ path: 'src/a.js', source }] })
console.log(JSON.stringify({
  runtime: a.runtimeMessages.map(x => ({ text: x.text, capability: x.capability, key: x.key, role: x.semanticRole })),
  explicit: a.explicitRequiredFindings,
  coverage: a.coverage
}, null, 2))
