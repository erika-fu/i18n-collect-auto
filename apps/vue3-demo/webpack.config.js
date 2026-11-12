const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const MyI18nPlugin = require('../../packages/i18n-collect/myplugin')
const collector = require.resolve('../../packages/i18n-collect/myloader')

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
        use: [collector]
      },
      { test: /\.vue$/, resourceQuery: /type=template/, enforce: 'pre', use: [collector] },
      { test: /\.vue$/, resourceQuery: /type=script/, enforce: 'pre', use: [collector] },
      {
        test: /\.css$/,
        oneOf: [
          {
            resourceQuery: /\?vue/,
            use: [
              require.resolve('style-loader'),
              require.resolve('css-loader')
            ]
          },
          {
            use: [
              require.resolve('style-loader'),
              require.resolve('css-loader'),
              collector
            ]
          }
        ]
      },
      {
        test: /\.scss$/,
        oneOf: [
          {
            resourceQuery: /\?vue/,
            use: [
              require.resolve('style-loader'),
              require.resolve('css-loader'),
              require.resolve('sass-loader')
            ]
          },
          {
            use: [
              require.resolve('style-loader'),
              require.resolve('css-loader'),
              require.resolve('sass-loader'),
              collector
            ]
          }
        ]
      },
      {
        test: /\.sass$/,
        oneOf: [
          {
            resourceQuery: /\?vue/,
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
              },
              collector
            ]
          }
        ]
      },
      {
        test: /\.less$/,
        oneOf: [
          {
            resourceQuery: /\?vue/,
            use: [
              require.resolve('style-loader'),
              require.resolve('css-loader'),
              require.resolve('less-loader')
            ]
          },
          {
            use: [
              require.resolve('style-loader'),
              require.resolve('css-loader'),
              require.resolve('less-loader'),
              collector
            ]
          }
        ]
      },
      {
        test: /\.styl(?:us)?$/,
        oneOf: [
          {
            resourceQuery: /\?vue/,
            use: [
              require.resolve('style-loader'),
              require.resolve('css-loader'),
              require.resolve('stylus-loader')
            ]
          },
          {
            use: [
              require.resolve('style-loader'),
              require.resolve('css-loader'),
              require.resolve('stylus-loader'),
              collector
            ]
          }
        ]
      }
    ]
  },
  plugins: [
    new VueLoaderPlugin(),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'public/index.html')
    }),
    new MyI18nPlugin({ publishOutputs: false })
  ]
}
