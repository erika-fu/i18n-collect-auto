# i18n-auto-webpack-demo

这里是一个vue2 + vue-cli + vue-i18n v8 的自动国际化工程演示demo 。 vue-cli 使用的 vue-loader 是v15

> 请注意，若你是vue2的项目，请使用vue-i18n v8版本，而不是v9, v9是搭配vue3的

仓库是 monorepo，demo 和收集用的 loader/plugin 分开：

- `packages/i18n-collect`：webpack loader 与 plugin（`myloader`、`myplugin`，以及它们共用的 `mycommon`）
- `apps/demo`：Vue demo，依赖 `i18n-collect` 接入 loader 和 plugin

需要留意的文件有

- `apps/demo/vue.config.js`，这里设置了webpack的loader和plugin，实现收集代码和生成词条配置文件。 可看文件中的注释
- `apps/demo/lang`文件夹，就是生成的词条配置文件所在目录
- `apps/demo/src/lang`目录下，就是使用`vue-i18n`实现的国际化转换函数的基本设置，当然你也可以用其他类库来实现国际化转换，或自己写。

## Project setup
```
npm install
```

### Compiles and hot-reloads for development
```
npm run serve
```

### Compiles and minifies for production
```
npm run build
```

### Tests for the loader and plugin
```
npm test
```

### Customize configuration
See [Configuration Reference](https://cli.vuejs.org/config/).
