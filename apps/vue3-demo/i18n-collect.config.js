module.exports = {
  styleExtensions: ['.css', '.scss', '.sass', '.less', '.styl', '.stylus'],
  include: ['public', 'src'],
  exclude: ['fixtures/**'],
  targetLocales: ['en'],
  translationProvider: 'i18n/provider.js',
  vueVersion: 3,
  staticAudit: {
    include: ['public/**/*.html', 'src/base.css']
  },
  buildReplacement: {
    enabled: true,
    adapter: 'vue3',
    runtimeModule: 'src/i18n.js',
    runtimeExport: 't'
  }
}
