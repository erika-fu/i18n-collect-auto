const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const { VueLoaderPlugin } = require('vue-loader')
const MyI18nPlugin = require('i18n-collect/myplugin')

const collector = require.resolve('i18n-collect/myloader')

module.exports = {
  context: __dirname,
  mode: 'production',
  entry: './src/main.js',
  output: {
    clean: true,
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: ''
  },
  resolve: {
    extensions: ['.js', '.vue']
  },
  module: {
    rules: [
      {
        test: /\.vue$/,
        loader: require.resolve('vue-loader')
      },
      {
        test: /\.m?js$/,
        exclude: /node_modules/,
        use: [collector]
      },
      // These rules run in vue-loader's block requests. The collector pitch
      // reads the owning SFC before template, script, or style transforms.
      {
        test: /\.vue$/,
        resourceQuery: /type=template/,
        use: [collector]
      },
      {
        test: /\.vue$/,
        resourceQuery: /type=script/,
        use: [collector]
      },
      {
        test: /\.vue$/,
        resourceQuery: /type=style/,
        use: [collector]
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
    new VueLoaderPlugin(),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'public/index.html')
    }),
    new MyI18nPlugin()
  ]
}
