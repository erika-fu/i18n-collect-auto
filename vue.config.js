const { defineConfig } = require('@vue/cli-service')
const { resolve } = require('path')

module.exports = defineConfig({
  transpileDependencies: true,

  // 插件必须写在这里（正确位置）
  configureWebpack: () => {
    const config = {
      devtool: 'source-map'
    }

    // 仅开发环境启用插件
    if (process.env.NODE_ENV === 'development') {
      config.plugins = [
        ...(config.plugins || []),
        new (require('./myplugin'))({
          output: {
            path: resolve(__dirname, './lang'),
            filename: 'zh_hash.json'
          }
        })
      ]
    }

    return config
  },

  // Loader 正确写法
  chainWebpack: config => {
    // ==========================================
    // 1. 处理 .js 文件 + Vue <script> 里的 JS
    // ==========================================
    config.module
      .rule('js')
      .test(/\.js$/)
      .use('i18n-auto-loader')
        .loader(resolve(__dirname, './myloader')) // 绝对路径
        .before('babel-loader') // 优先于 babel 执行
        .end()

    // ==========================================
    // 2. 处理 Vue template 中的中文
    // ==========================================
    config.module
      .rule('vue-template')
      .test(/\.vue$/)
      .resourceQuery(/type=template/)
      .use('i18n-auto-loader')
        .loader(resolve(__dirname, './myloader'))
        .end()
  }
})