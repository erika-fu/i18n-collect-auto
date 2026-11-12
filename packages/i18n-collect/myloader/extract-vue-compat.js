const { extractScript } = require('./extract-script')
const { scriptIdentity } = require('./resource')

function attributeValue(attrs, name) {
  if (!attrs) return null
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  if (!match) return null
  return match[1] || match[2] || match[3] || ''
}

function hasBooleanAttribute(attrs, name) {
  if (!attrs) return false
  return new RegExp(`\\b${name}(?:\\s|=|>|$)`, 'i').test(attrs)
}

function vueScriptBlocks(source) {
  const blocks = []
  const pattern = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi
  let match = pattern.exec(source)
  while (match) {
    const attrs = match[1] || ''
    const openTag = match[0].slice(0, match[0].length - match[2].length - '</script>'.length)
    const innerStart = match.index + openTag.length
    const inner = match[2]
    const lang = (attributeValue(attrs, 'lang') || 'js').toLowerCase()
    blocks.push({
      setup: hasBooleanAttribute(attrs, 'setup'),
      lang,
      innerStart,
      innerEnd: innerStart + inner.length,
      inner
    })
    match = pattern.exec(source)
  }
  return blocks
}

function paddedScriptSource(source, block) {
  return `${source.slice(0, block.innerStart).replace(/[^\n]/g, ' ')}${block.inner}`
}

function extractVueScriptBlocks({ source, resource, config }) {
  return vueScriptBlocks(source).map(block => {
    const blockResource = {
      ...resource,
      block: 'script',
      lang: block.lang,
      setup: block.setup,
      identity: scriptIdentity(resource.projectPath, block)
    }
    return {
      resource: blockResource,
      entries: extractScript({
        source: paddedScriptSource(source, block),
        resource: blockResource,
        config
      })
    }
  })
}

function extractVueScript(input) {
  return extractVueScriptBlocks(input).flatMap(item => item.entries)
}

module.exports = {
  extractVueScript,
  extractVueScriptBlocks,
  vueScriptBlocks,
  paddedScriptSource
}
