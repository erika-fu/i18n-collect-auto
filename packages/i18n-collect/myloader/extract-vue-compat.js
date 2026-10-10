const { extractScript } = require('./extract-script')

function extractVueScript({ source, resource }) {
  const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  if (!script) return []
  const code = `${source.slice(0, script.index).replace(/[^\n]/g, ' ')}${script[1]}`
  return extractScript({ source: code, resource })
}

module.exports = { extractVueScript }
