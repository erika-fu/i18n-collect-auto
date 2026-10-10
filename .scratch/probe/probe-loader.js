const fs = require('fs')
function record(label, ctx, extra) {
  const recordFile = process.env.PROBE_FILE
  fs.appendFileSync(recordFile, JSON.stringify({
    label,
    resource: ctx.resourcePath + (ctx.resourceQuery || ''),
    loaders: ctx.loaders.map(loader => ({
      path: loader.path.split('node_modules/').pop(),
      pitchExecuted: loader.pitchExecuted
    })),
    ...extra
  }) + '\n')
}
module.exports = function (source) {
  const text = Buffer.isBuffer(source) ? source.toString('utf8') : source
  record('normal', this, { head: text.slice(0, 80) })
  this.callback(null, source)
}
module.exports.pitch = function () {
  record('pitch', this, {})
}
