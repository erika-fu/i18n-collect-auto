module.exports = {
  styleExtensions: ['.css', '.scss', '.sass', '.less', '.styl', '.stylus'],
  include: ['public', 'src'],
  exclude: ['fixtures/**'],
  targetLocales: ['en'],
  buildReplacement: {
    enabled: true,
    adapter: 'vue2',
    runtimeModule: 'src/i18n-runtime.js',
    runtimeExport: 't'
  }
}
