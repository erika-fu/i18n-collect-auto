const { defineConfig } = require('@vue/cli-service')

const loaderPath = require.resolve('i18n-collect/myloader')
const MyI18nPlugin = require('i18n-collect/myplugin')

module.exports = defineConfig({
  transpileDependencies: true,

  // 插件必须写在这里（正确位置）
  configureWebpack: () => {
    const config = {
      devtool: 'source-map'
    }

    config.plugins = [...(config.plugins || []), new MyI18nPlugin()]

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
        .loader(loaderPath) // 绝对路径
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
        .loader(loaderPath)
        .end()

    config.module
      .rule('vue-script-i18n-collect')
      .test(/\.vue$/)
      .resourceQuery(/type=script/)
      .use('i18n-auto-loader')
        .loader(loaderPath)
        .end()
  }
})
