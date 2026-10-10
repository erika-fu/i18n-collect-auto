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

    config.module
      .rule('vue-style-i18n-collect')
      .resourceQuery(/type=style/)
      .use('i18n-auto-loader')
        .loader(loaderPath)
        .end()

    const cssRule = config.module.rule('css')
    for (const name of ['normal-modules', 'normal']) {
      if (!cssRule.oneOfs.has(name)) continue
      const oneOf = cssRule.oneOf(name)
      const use = oneOf.use('i18n-auto-loader').loader(loaderPath)
      if (oneOf.uses.has('postcss-loader')) use.after('postcss-loader')
      else use.after('css-loader')
    }

    // Webpack runs normal loaders from right to left. The collector must see
    // the raw template, then HTMLWebpackPlugin's own loader must still run.
    const htmlLoader = require.resolve('html-webpack-plugin/lib/loader.js')
    const htmlNames = []
    config.plugins.store.forEach((plugin, name) => htmlNames.push(name))
    for (const name of htmlNames) {
      if (name !== 'html' && !String(name).startsWith('html-')) continue
      config.plugin(name).tap(args => {
        const options = args[0]
        if (!options || typeof options.template !== 'string' || options.template.includes('!')) return args
        const template = `!!${htmlLoader}?${JSON.stringify({ force: true })}!${loaderPath}!${options.template}`
        return [{ ...options, template }, ...args.slice(1)]
      })
    }
  }
}
