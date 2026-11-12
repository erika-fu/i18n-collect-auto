const { analyzeProject } = require('../packages/i18n-collect/mycommon/project-analysis')
const { extractScript } = require('../packages/i18n-collect/myloader/extract-script')
const sources = [
  '// i18n-key: home.title\nconst message = "你好"\n',
  '/* i18n-key: home.title */\nconst message = "你好"\n',
  'const message = /* i18n-key: home.title */ "你好"\n'
]
for (const source of sources) {
  const entries = extractScript({
    source,
    resource: { projectPath: 'src/a.js', absolutePath: '/x/src/a.js', block: 'script', identity: 'src/a.js::script' },
    config: {}
  })
  console.log(JSON.stringify({ source: source.slice(0,40), entries: entries.map(e => ({ value: e.value, key: e.key })) }))
}
