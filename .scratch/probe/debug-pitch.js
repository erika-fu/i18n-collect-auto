const fs = require('fs')
module.exports = function (source) { return source }
module.exports.pitch = function () {
  fs.appendFileSync(process.env.PROBE_FILE, JSON.stringify({
    label: 'debug-pitch',
    resource: this.resourcePath + (this.resourceQuery || ''),
    loaders: this.loaders.map(loader => ({
      path: loader.path.split('node_modules/').pop(),
      pitchExecuted: loader.pitchExecuted
    }))
  }) + '\n')
}
