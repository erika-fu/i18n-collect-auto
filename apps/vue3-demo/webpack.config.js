const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')

// vue-loader is hoisted beside the Vue 2 demo in this workspace, so bind it
// to this project's Vue 3 compiler before vue-loader captures the parse API.
const vueLoaderCompiler = require('vue-loader/dist/compiler')
vueLoaderCompiler.compiler = require('@vue/compiler-sfc')

const { VueLoaderPlugin } = require('vue-loader')

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
        use: []
      },
      {
        test: /\.css$/,
        use: [
          require.resolve('style-loader'),
          require.resolve('css-loader')
        ]
      },
      {
        test: /\.scss$/,
        use: [
          require.resolve('style-loader'),
          require.resolve('css-loader'),
          require.resolve('sass-loader')
        ]
      },
      {
        test: /\.sass$/,
        use: [
          require.resolve('style-loader'),
          require.resolve('css-loader'),
          {
            loader: require.resolve('sass-loader'),
            options: {
              sassOptions: {
                indentedSyntax: true
              }
            }
          }
        ]
      },
      {
        test: /\.less$/,
        use: [
          require.resolve('style-loader'),
          require.resolve('css-loader'),
          require.resolve('less-loader')
        ]
      },
      {
        test: /\.styl(?:us)?$/,
        use: [
          require.resolve('style-loader'),
          require.resolve('css-loader'),
          require.resolve('stylus-loader')
        ]
      }
    ]
  },
  plugins: [
    new VueLoaderPlugin(),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'public/index.html')
    })
  ]
}
