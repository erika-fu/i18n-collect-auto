const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const MyI18nPlugin = require('../../packages/i18n-collect/myplugin')
const collector = require.resolve('../../packages/i18n-collect/myloader')

module.exports = {
  context: __dirname,
  entry: './src/main.jsx',
  output: {
    clean: true,
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist')
  },
  resolve: {
    extensions: ['.js', '.jsx']
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: require.resolve('babel-loader'),
            options: {
              presets: [
                [require.resolve('@babel/preset-env'), { targets: 'defaults' }],
                [require.resolve('@babel/preset-react'), { runtime: 'automatic' }]
              ]
            }
          },
          collector
        ]
      },
      {
        test: /\.css$/,
        use: [
          require.resolve('style-loader'),
          require.resolve('css-loader'),
          collector
        ]
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'public/index.html'),
      title: 'React 文案收集示例'
    }),
    new MyI18nPlugin({ publishOutputs: false })
  ]
}
