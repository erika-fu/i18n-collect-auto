const fs = require('fs')
const path = require('path')
const webpack = require('webpack')
const { VueLoaderPlugin } = require('@vue/vue-loader-v15')
const pitcher = require('@vue/vue-loader-v15/lib/loaders/pitcher')
const originalPitch = pitcher.pitch
pitcher.pitch = function () {
  fs.appendFileSync(process.env.PROBE_FILE, JSON.stringify({
    label: 'vue-pitcher',
    resource: this.resourceQuery,
    loaders: this.loaders.map(loader => ({
      path: loader.path.split('node_modules/').pop(),
      pitchExecuted: loader.pitchExecuted
    }))
  }) + '\n')
  return originalPitch.apply(this, arguments)
}

const root = __dirname
const record = path.join(root, 'seen.jsonl')
fs.writeFileSync(record, '')
process.env.PROBE_FILE = record

const compiler = webpack({
  context: root,
  mode: 'development',
  entry: path.join(root, 'src/App.vue'),
  output: { path: path.join(root, 'dist'), filename: 'bundle.js' },
  infrastructureLogging: { level: 'error' },
  resolve: { alias: { vue$: 'vue/dist/vue.esm.js' } },
  module: {
    rules: [
      { resourceQuery: /vue/, loader: path.join(root, "debug-pitch.js") },
      {
        test: /\.vue$/,
        loader: require.resolve('@vue/vue-loader-v15')
      },
      {
        test: /\.m?jsx?$/,
        loader: 'babel-loader'
      },
      {
        test: /\.vue$/,
        resourceQuery: /type=template/,
        loader: path.join(root, 'probe-loader.js')
      },
      {
        test: /\.vue$/,
        resourceQuery: /type=script/,
        loader: path.join(root, 'probe-loader.js')
      },
      {
        test: /\.js$/,
        loader: path.join(root, 'probe-loader.js')
      }
    ]
  },
  plugins: [new VueLoaderPlugin()]
})

compiler.run((err, stats) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  const info = stats.toJson()
  if (stats.hasErrors()) {
    console.error(info.errors.map(e => e.message).join('\n\n'))
  }
  console.log('---SEEN---')
  console.log(fs.readFileSync(record, 'utf8'))
  compiler.close(() => {})
})
