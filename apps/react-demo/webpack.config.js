const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const MyI18nPlugin = require('i18n-collect/myplugin')

const loaderPath = require.resolve('i18n-collect/myloader')
const htmlLoader = require.resolve('html-webpack-plugin/lib/loader.js')
const template = path.resolve(__dirname, 'public/index.html')

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
          loaderPath,
          {
            loader: require.resolve('babel-loader'),
            options: {
              presets: [
                [require.resolve('@babel/preset-env'), { targets: 'defaults' }],
                [require.resolve('@babel/preset-react'), { runtime: 'automatic' }]
              ]
            }
          }
        ]
      },
      {
        test: /\.css$/,
        use: [
          require.resolve('style-loader'),
          require.resolve('css-loader'),
          loaderPath
        ]
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: `!!${htmlLoader}?${JSON.stringify({ force: true })}!${loaderPath}!${template}`,
      title: 'React 文案收集示例'
    }),
    new MyI18nPlugin()
  ]
}
