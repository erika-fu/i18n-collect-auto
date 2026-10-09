const { extractScript } = require('./extract-script')

function labeled(entries, kind) {
  return entries.map(entry => ({
    value: entry.value,
    locations: entry.locations.map(location => ({ ...location, kind }))
  }))
}

function paddedRegion(source, start, end) {
  return source.slice(0, start).replace(/[^\n]/g, ' ') + source.slice(start, end)
}

function extractVueScript({ source, resource }) {
  const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  if (!script) return []
  const code = `${source.slice(0, script.index).replace(/[^\n]/g, ' ')}${script[1]}`
  return extractScript({ source: code, resource })
}

function extractTemplateExpressions({ source, resource }) {
  const template = source.match(/<template[^>]*>([\s\S]*?)<\/template>/)
  if (!template) return []
  const innerStart = template.index + template[0].indexOf(template[1])
  const pattern = /\{\{([\s\S]*?)\}\}/g
  const entries = []
  let match
  while ((match = pattern.exec(template[1]))) {
    const start = innerStart + match.index + 2
    const end = start + match[1].length
    entries.push(...labeled(
      extractScript({ source: paddedRegion(source, start, end), resource }),
      'template-expression'
    ))
  }
  return entries
}

module.exports = { extractVueScript, extractTemplateExpressions }
