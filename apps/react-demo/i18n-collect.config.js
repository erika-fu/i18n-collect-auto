module.exports = {
  styleExtensions: ['.css'],
  include: ['public', 'src'],
  targetLocales: ['en'],
  translationProvider: 'i18n/provider.js',
  staticAudit: {
    include: ['public/**/*.html', 'src/base.css']
  }
}
