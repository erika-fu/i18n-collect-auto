const loaderPath = require.resolve('i18n-collect/myloader')
const MyI18nPlugin = require('i18n-collect/myplugin')

module.exports = {
  transpileDependencies: true,

  configureWebpack: () => {
    const config = {
      devtool: 'source-map'
    }

    config.plugins = [...(config.plugins || []), new MyI18nPlugin()]

    return config
  },

  // Loader 在 pitch 阶段读取原始文件。thread-loader 会把排在它后面的 loader
  // 放进 worker，所以收集 loader 必须排在 thread-loader 之前。
  chainWebpack: config => {
    config.module
      .rule('js')
      .use('i18n-auto-loader')
        .loader(loaderPath)
        .before('thread-loader')
        .end()

    config.module
      .rule('vue-template')
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
}
