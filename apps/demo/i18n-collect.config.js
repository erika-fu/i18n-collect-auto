module.exports = {
  styleExtensions: ['.css', '.scss', '.sass', '.less', '.styl', '.stylus'],
  include: ['public', 'src'],
  exclude: ['fixtures/**'],
  targetLocales: ['en'],
  vueVersion: 2,
  staticAudit: {
    include: ['public/**/*.html', 'src/base.css']
  },
  buildReplacement: {
    enabled: true,
    adapter: 'vue2',
    runtimeModule: 'src/i18n-runtime.js',
    runtimeExport: 't'
  }
}
