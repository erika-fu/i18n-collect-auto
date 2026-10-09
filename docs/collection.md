# 收集过程中的两次故障

在 demo 的 watch 构建里发现。用语与 `CONTEXT.md` 一致。

## 词条内容没变也会再次触发 watch

`npm run serve` 和 `vue-cli-service build --watch` 在一次成功构建之后会立刻再编。产物哈希不变，也没有人改过源码。

`apps/demo/src/lang/index.js` 引用了运行时词条：

```js
require(`/lang/${locale}_hash.json`)
```

Webpack 把它解析成 `apps/demo/lang/zh_hash.json`，因此这个词条文件和它的父目录 `lang/` 都在监听范围内。`MyI18nPlugin` 在 `compiler.hooks.done` 写出收集结果。原先的 `writeOutputs` 每次编译都会先写临时文件，再 `rename` 到目标路径，字节已经相同也会这样做。

这次目录写入就足以排下一轮编译：

| 写入了什么 | watch 报告的变更 | 结果 |
| --- | --- | --- |
| 两份输出，字节未变 | `lang/zh_hash.json` 和 `lang` | 持续重编 |
| 什么都不写 | 无变更 | 只编一次 |
| 字节相同则跳过 | 无变更 | 只编一次 |
| 只写词条 | `lang/zh_hash.json` 和 `lang` | 持续重编 |
| 只写 source map | `lang` | 持续重编 |

每次构建都会重写 `dist/`。停掉词条写入后循环停止，说明触发源是 `lang/` 里的写入。

`writeOutputs` 现在会先比较字节。两份输出都已经是将要写入的内容时，在创建临时文件之前直接返回。收集结果真有变化时仍会写盘，watch 再编一轮把新词条打进包，下一次 `done` 看到字节相同后停止。

回归测试：`packages/i18n-collect/test/watch-loop.test.js`。

## 模板插值里的静态片段被丢掉

`apps/demo/src/App.vue` 里的 `` {{ `这是${a}的名字呀` }} `` 没有把「这是」和「的名字呀」写入收集结果。脚本里的「我不好」在结果中。`${a}` 是插值表达式，不进入结果。

收集结果就是 `MyI18nPlugin` 在 `done` 时提交的那一份。对 Vue 文件，它原先只读 `<script>`，并用这些条目替换该文件的资源快照。模板块没有进入收集。把同一段模板字符串放进脚本后，两段静态片段都能收到，说明解析本身没有问题。

如果脚本扫描保持原样，后面两步仍会丢掉这些片段：

- loader 会忽略 query 里带 `type=template` 的模块，因此 vue-loader 交来的模板块不会收集它们。
- `replaceSnapshot` 替换整个资源。`src/App.vue` 若只剩脚本快照，同一路径上先收进来的模板条目会被清掉。

插件现在会解析 `<template>` 里的每个 `{{ }}`，把其中的静态中文记为 `template-expression`，并和脚本条目放进同一次资源快照。位置使用原文件坐标：当前 demo 里，「这是」在第 6 行第 13 列，「的名字呀」在第 6 行第 19 列。

已经跑着的 `npm run serve` 用的是启动时加载的插件。这次修改之后需要重启，收集结果才会重新写盘。

回归测试：`packages/i18n-collect/test/template-fragment.test.js`。
