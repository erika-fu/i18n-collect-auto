const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')

// vue-loader is hoisted beside the Vue 2 demo in this workspace, so bind it
// to this project's Vue 3 compiler before vue-loader captures the parse API.
const vueLoaderCompiler = require('vue-loader/dist/compiler')
vueLoaderCompiler.compiler = require('@vue/compiler-sfc')

const { VueLoaderPlugin } = require('vue-loader')
const MyI18nPlugin = require('i18n-collect/myplugin')

const collector = require.resolve('i18n-collect/myloader')
const htmlLoader = require.resolve('html-webpack-plugin/lib/loader.js')
const htmlTemplate = path.resolve(__dirname, 'public/index.html')

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
      template: `!!${htmlLoader}?${JSON.stringify({ force: true })}!${collector}!${htmlTemplate}`
    }),
    new MyI18nPlugin()
  ]
}
