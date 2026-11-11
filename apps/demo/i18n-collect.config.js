module.exports = {
  styleExtensions: ['.css', '.scss', '.sass', '.less', '.styl', '.stylus'],
  targetLocales: ['en'],
  pruneOrphaned: true,
  buildReplacement: {
    enabled: true,
    adapter: 'vue2',
    runtimeModule: 'src/i18n-runtime.js',
    runtimeExport: 't'
  }
}
