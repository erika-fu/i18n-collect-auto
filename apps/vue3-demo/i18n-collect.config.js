module.exports = {
  styleExtensions: ['.css', '.scss', '.sass', '.less', '.styl', '.stylus'],
  include: ['public', 'src'],
  exclude: ['fixtures/**'],
  targetLocales: ['en'],
  buildReplacement: {
    enabled: true,
    adapter: 'vue3',
    runtimeModule: 'src/i18n.js',
    runtimeExport: 't'
  }
}
