module.exports = {
  styleExtensions: ['.css'],
  include: ['public', 'src'],
  targetLocales: ['en'],
  staticAudit: {
    include: ['public/**/*.html', 'src/base.css']
  }
}
