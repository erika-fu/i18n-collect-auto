const { extractScript } = require('../packages/i18n-collect/myloader/extract-script')
const source = "const text = t('items.deleted', { count })\n"
const entries = extractScript({
  source,
  resource: { projectPath: 'src/a.js', absolutePath: '/x/src/a.js', block: 'script', identity: 'src/a.js::script' },
  config: {}
})
console.log(JSON.stringify(entries, null, 2))
