module.exports = {
  styleExtensions: ['.css', '.scss', '.sass', '.less', '.styl', '.stylus'],
  targetLocales: ['en'],
  pruneOrphaned: true,
  buildReplacement: {
    enabled: true,
    adapter: 'vue3',
    runtimeModule: 'src/i18n.js',
    runtimeExport: 't'
  }
}
