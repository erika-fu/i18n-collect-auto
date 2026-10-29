const path = require('path')

module.exports = {
  root: true,
  env: {
    node: true
  },
  extends: [
    'plugin:vue/essential',
    'eslint:recommended'
  ],
  ignorePatterns: [
    'output.js'
  ],
  parserOptions: {
    parser: '@babel/eslint-parser',
    babelOptions: {
      cwd: __dirname,
      root: __dirname
    }
  },
  rules: {}
}
