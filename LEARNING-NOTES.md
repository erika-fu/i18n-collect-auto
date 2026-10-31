# 学习笔记：理解 `i18n-collect`

这份笔记整理课程学习过程中涉及的 Webpack 构建对象、Loader、缓存生命周期，以及 `i18n-collect` 的收集模型。核心目标是区分两套概念：

- Webpack 的 `Compiler`、`Compilation`、`Module`、`moduleGraph`、`chunkGraph` 与缓存；
- `i18n-collect` 的 `Session`、`round`、Module metadata、`live set`、candidate 与 `committed`。

> 重要边界：Webpack 是否增量构建，和收集结果是否按资源快照替换，是两件不同的事。Webpack 可以只重新处理受影响的 Module；Plugin 仍要从当前构建上下文形成完整的收集结果。

## 1. 三种不同的 identity

项目中有三种 identity，不能混为一谈。

| 概念 | 示例 | 作用 |
|---|---|---|
| Resource identity | `src/App.vue::template[lang=html]` | 标识哪个语义资源的 snapshot 应被替换或移除 |
| 文案 hash | `md5('首页')` | 保持现有 hash 运行时词典，并对相同文案去重 |
| 本地化 key | `home.title` | 为 catalog 和替换流程命名稳定的翻译单元 |

### `src/App.vue::template[lang=html]` 表示什么？

它是内部资源 identity：

- `src/App.vue`：相对于项目根目录的路径；
- `::`：文件与语义 block 的分隔符；
- `template[lang=html]`：规范化为 HTML 的 Vue `<template>` block。

一个 Vue SFC 可以产生多个 identity：

```text
src/App.vue::script[lang=js]
src/App.vue::template[lang=html]
src/App.vue::style[index=0;lang=css]
src/App.vue::style[index=1;lang=scss]
```

这些 identity 防止 script、template 和不同 style block 相互覆盖。删除 template 中的文案时，只应移除 template 的贡献，不应移除 script 或 style 的贡献。

对于 style，`index` 是该文件中 `<style>` block 按出现顺序的索引，`index=0` 表示第一个，`index=1` 表示第二个。它不仅用于区分多个 style block，也保留了可能影响 CSS 层叠顺序的原始声明顺序；`lang` 则表示 CSS、SCSS 等语法语言。`index` 不负责计算 CSS 最终层叠结果，只是准确标识资源。

identity 不是 CSS selector，不是 source map 坐标，也不是必须暴露在公开 hash source map 中的字段。它是 Session 管理 resource snapshot 的内部 key。

## 2. 为什么公开 map 没有 `resource` 字段

内部 snapshot 可以包含 identity 和 owner 信息：

```json
{
  "identity": "src/App.vue::template[lang=html]",
  "projectPath": "src/App.vue",
  "owner": { "block": "template", "lang": "html" },
  "entries": []
}
```

公开的 `lang/zh_hash.map.json` 保持兼容的 version-1 结构：

```json
{
  "version": 1,
  "parserVersion": "babel-7",
  "configHash": "...",
  "entries": [
    {
      "key": "<md5>",
      "value": "首页",
      "locations": [
        {
          "path": "src/App.vue",
          "kind": "html-text",
          "start": { "line": 5, "column": 4 },
          "end": { "line": 5, "column": 6 }
        }
      ]
    }
  ]
}
```

两种结构服务不同对象：

- 内部 identity 回答“哪个 resource snapshot 拥有这份贡献？”；
- `locations` 回答“开发者可以在源码的什么位置找到这段文案？”

公开 map 使用 `path`、`kind` 和源码坐标做追踪，不暴露内部 snapshot identity，以免改变公开 schema 的兼容契约。

## 3. 为什么 resource snapshot 要替换，而不是追加

一个 resource snapshot 表示一个语义资源当前的**完整贡献**：

```text
旧：src/App.vue::template → 首页、欢迎回来、提交
新：src/App.vue::template → 首页、提交
```

新的完整 snapshot 替换旧 snapshot，于是“欢迎回来”会从该资源的贡献中消失。

只追加新文案只能发现新增，无法可靠发现删除：

```text
new text → add to global set
```

文案从源码删除后，仍会永久残留在输出中。Delta 方案也可以实现，但仍需要旧完整 snapshot 和新完整 snapshot：

```text
removed = oldSnapshot - currentSnapshot
added   = currentSnapshot - oldSnapshot
```

直接提交完整 snapshot 对重试、缓存恢复、事件顺序和失败构建更简单、更可靠。

这不代表每次构建都会扫描整个项目：

- Webpack 决定哪些 Module 重新处理、哪些 Module 复用；
- 被重新处理的 resource 提交一个完整替换 snapshot；
- 未变化 Module 在缓存命中并恢复 metadata 时，可以继续贡献已有 snapshot；
- Plugin 汇总当前 Module graph 中仍有效的 snapshot。

## 4. Webpack 的构建对象与增量构建

一次普通构建通常有：

```text
一个 root Compiler
一个主 Compilation
多个 Module
```

watch 模式通常复用同一个 Compiler，但每次文件变化会创建新的 Compilation：

```text
同一个 root Compiler
├── Compilation 1
├── Compilation 2
└── Compilation 3
```

一个 Compilation 会处理很多 Module；不同文件通常是同一个 Compilation 中的不同 Module，并不是“一个文件对应一个 Compilation”。

当前 Compilation 的重要结构包括：

```text
Compilation
├── modules：当前轮次的 Module 节点集合
├── moduleGraph：Module 之间的依赖关系
└── chunkGraph：Module 到 Chunk 的映射
```

Module 的边界由模块请求经过工厂解析后的身份决定，通常受以下因素共同影响：

- resource；
- loader chain；
- resource query；
- module type。

因此 Module 的边界并非简单按文件划分，也不是简单按 Loader 划分。一个 Vue SFC 可能被拆成多个模块请求：

```text
src/App.vue?vue&type=script&lang=js
src/App.vue?vue&type=template&lang=html
src/App.vue?vue&type=style&index=0&lang=css
```

改变 `<template>` 会使相关 SFC 请求重新评估，但不能绝对断言“只有一个文件”或“只有一个 block”会重建；准确的失效和缓存范围由 `vue-loader`、依赖关系和 Webpack cache 决定。

### Compiler、Session、Compilation、round 的关系

```text
root Compiler
└── CollectionSession
    ├── main Compilation 1 → round 1
    ├── main Compilation 2 → round 2
    └── committed：最近一次成功结果
```

项目用模块级 `WeakMap` 保存：

```text
root Compiler → CollectionSession
```

这个 `WeakMap` 只存在于当前 Node.js 进程，不负责跨命令持久化。进程退出后，Session、round 和内存中的 committed 都消失。watch 模式中同一个 Compiler 持续存在，因此多个 Compilation 复用同一个 Session；同一进程中的不同 Compiler 使用不同 Session。

Session 内部又用 `WeakMap` 保存：

```text
main Compilation → candidate round
```

child Compilation 会通过 `mainCompilation()` 沿 `parentCompilation` 找到主 Compilation，因此同一主构建的 child Compilation 归入主 Compilation 的 round。

## 5. 资源 snapshot 与 Webpack 增量构建

精确模型是：

```text
构建执行：Webpack 决定哪些 Module 处理或复用
资源状态：被处理的 resource 替换自己的完整 snapshot
项目输出：Plugin 汇总当前有效的 live snapshots
```

Session 中的 `round` 结构是：

```js
{
  invocations: 0,
  submissions: new Map(),
  warnings: new Set(),
  abandoned: false
}
```

- `invocations`：记录 Loader 被调用的次数，即使没有中文或资源被排除也要记录；
- `submissions`：`Map<identity, snapshot>`，同一 identity 后提交的完整 snapshot 替换前一个；
- `warnings`：本轮 warning 去重状态；
- `abandoned`：本轮是否作废。

`round` 是一次主 Compilation 的临时 candidate 容器，不是正式结果，也不是一个文件的容器。它必须与 Session 分开：一次 Compilation 失败时，当前 candidate 应该丢弃，而上一次成功的 committed 应该保留。

## 6. `i18n-key` 是什么

`i18n-key` 是显式命名本地化 key 的注释指令。它命名的是翻译单元，不是 Webpack resource，也不会排除文案。

Vue template：

```vue
<!-- i18n-key: home.title -->
<h1>首页</h1>
```

JavaScript：

```js
/* i18n-key: order.submit */
const label = '提交'
```

没有显式 key 时，项目根据项目相对路径、语义 kind 和源码文本派生 key。派生 key 有意不包含行列号，因此只在文件中移动同一文案不会仅因坐标变化而生成新的翻译单元。

合法 key 以字母开头，使用点分隔的 segments；每个 segment 可以包含字母、数字、`_` 和 `-`：

```text
home.title
order.submit-button
account.profile_name
```

`i18n-key` 与 `no-i18n-auto` 不同：

- `i18n-key` 命名片段；
- `no-i18n-auto` 排除下一个关联片段。

格式错误的 `i18n-key`，或者同一片段被两个不同 key 命名，会使本轮失败，而不是静默猜测。

## 7. Han 门槛

Han 门槛是 extractor 已经识别出语义静态片段后应用的最低内容条件：

```js
function containsHan(value) {
  return typeof value === 'string' && /\p{Script=Han}/u.test(value)
}
```

规则是：只要静态片段中至少包含一个 Unicode Han 字符，就收集整段；完全不含 Han，就跳过。

| 片段 | 结果 | 原因 |
|---|---|---|
| `保存成功（2 项）` | 收集完整片段 | 含 Han，数字、标点和空格仍属于同一文案 |
| `Hello，保存成功！` | 收集完整片段 | 含 Han，英文不会阻止收集 |
| `Hello world` | 跳过 | 不含 Han |
| `class-name` | 跳过 | 通常是技术标识，且不含 Han |

它不是“只截取汉字”，也不是完整语言识别器，而是对已经处于正确语义位置的候选片段进行噪声过滤。JavaScript 中的纯英文字符串不会仅因为是字符串而被收集；不支持的技术位置也不会因为出现中文就变成文案。

## 8. Loader 的 `pitch`

Loader 可以有普通函数和 `pitch` 函数：

```js
function loader(source) {
  // normal phase
}

loader.pitch = function pitch() {
  // pitch phase
}
```

简化的链：

```text
Loader A → myloader → Loader B
```

Webpack 大致按以下方向运行：

```text
pitch：  A.pitch → myloader.pitch → B.pitch
normal： B(source) → myloader(source) → A(source)
```

本项目的 pitch 不返回转换后的源码，而是调用 `runCollect()` 记录观察结果，然后让普通处理继续。这样收集器可以在其他 Loader 改变源码形状前看到原始语义和坐标；Vue block 可能被 `vue-loader` 缩进、补行或以其他方式转换，因此这个时机很重要。

```js
loader.pitch = function pitch() {
  runCollect(this, fs.readFileSync(this.resourcePath, 'utf8'))
  if (this.data) this.data.collected = true
}
```

读取的原始内容只用于分析，不作为模块输出返回。

## 9. 为什么 Loader 是 observer 而不是 transformer

转换型 Loader 会改变模块源码：

```text
TypeScript → JavaScript
```

`myloader` 有两条路径：

```text
主路径：source → myloader → 原样 source → 其他 Loader → bundle
旁路径：提取 entries → snapshot → session/metadata → Plugin 输出
```

普通 Loader 结束时：

```js
this.callback(null, source, sourceMap, meta)
```

因此它：

- 不报 Loader 错误；
- 继续传递原始 source；
- 继续传递 source map；
- 继续传递 meta。

收集器不插入 `$t(...)`，不翻译文案，也不改变应用 bundle。替换属于后续工作流。

## 10. LoaderContext、Module 和 metadata

Webpack 在每次 Loader 调用时把 Loader Context 绑定为函数的 `this`：

```js
loader.call(loaderContext, source, sourceMap, meta)
```

LoaderContext 是一次 Loader 调用的运行时上下文，不应当作为跨 Compilation 的业务存储。项目使用的字段包括：

| Context 成员 | 作用 |
|---|---|
| `this.resourcePath` | 当前资源的物理绝对路径 |
| `this.resourceQuery` | 当前模块请求的 query，用于识别 Vue block |
| `this.rootContext` | Webpack 项目根目录的 fallback |
| `this.data` | pitch 与 normal 阶段之间共享的临时对象 |
| `this._module` | 当前 Webpack Module 的内部引用 |
| `this._compilation` | 当前 Compilation，用于提交到 Session |
| `this._compiler` | 当前 Compiler，用于获取 Session |
| `this.getOptions()` | 读取 Loader 配置 |
| `this.addDependency()` | 注册配置文件依赖 |
| `this.callback()` | 结束 Loader 并透明传递输出 |

`_module`、`_compiler`、`_compilation` 是 Webpack 内部上下文引用，不是本项目创建的公开 Loader API。项目没有把 metadata 存入 LoaderContext，而是通过：

```js
const mod = loaderContext._module
mod.buildInfo.i18nCollect = metadata
```

这里的 `buildInfo` 属于 Module，不属于 LoaderContext。

### metadata 的准确缓存语义

metadata 是普通、可序列化的 Module 构建状态 envelope：

```js
module.buildInfo.i18nCollect = {
  schemaVersion: 1,
  root,
  fileConfigHash,
  invoked: true,
  included,
  snapshot
}
```

旧 LoaderContext 不会跨 Compilation 保存，旧 Module 对象也不能被本项目假定为必然跨 Compilation 保存。准确的缓存链路是：

```text
第一次构建
  loaderContext → 当前 Module.buildInfo.i18nCollect
                  ↓ Webpack cache 序列化
第二次构建命中缓存
  当前 Compilation 的 Module
  └── 可能带有恢复后的 buildInfo.i18nCollect
```

memory cache 只在当前进程和适用的 Compiler/cache 生命周期内可能复用模块状态；filesystem cache 在实际命中并成功反序列化时，可能跨进程恢复可序列化的 Module 构建状态。缓存没有命中、状态没有恢复或模块重新构建时，metadata 不会凭空出现，Loader 必须在当前构建中重新执行。

因此 metadata 的作用不是让未变化 Module 重新打包，而是：

> 当 Webpack 复用一个未变化 Module、Loader 本轮没有重新执行时，如果该 Module 的 metadata 被缓存恢复，Plugin 仍可读取该 Module 对全量文案结果的贡献。

`round.abandon()` 不负责回滚 Module metadata；Session、round、Map、WeakMap、LoaderContext 和任意运行时对象也不是跨进程的业务持久化机制。

## 11. 资源分发到 extractor

分发分为两步。

### 第一步：分类 request

`describeResource` 组合 `resourcePath` 和 `resourceQuery`：

```text
/project/src/App.vue
?vue&type=template&lang=html
```

生成规范化信息：

```js
{
  projectPath: 'src/App.vue',
  block: 'template',
  lang: 'html',
  identity: 'src/App.vue::template[lang=html]'
}
```

| Request | block | Extractor |
|---|---|---|
| `src/message.js` | `script` | `extractScript` |
| `src/page.html` | `html` | `extractHtml` |
| `src/base.css` | `style` | `extractCss` |
| `App.vue?vue&type=script&lang=js` | `script` | `extractVueScript` |
| `App.vue?vue&type=template&lang=html` | `template` | `extractHtml` |
| `App.vue?vue&type=style&index=0&lang=css` | `style` | `extractCss` |

### 第二步：按 block 分发

```text
Vue + script → extractVueScript → extractScript
template/html → extractHtml
ordinary script → extractScript
style → extractCss
otherwise → no extractor
```

Vue script 有单独的适配器，因为它要定位原始 `<script>`、遮罩 SFC 其他内容并保留坐标，然后复用 `extractScript` 的 JavaScript 解析能力。Vue template 和 Vue style 的 SFC 定位已经内置在 `extractHtml` 和 `extractCss` 中，不需要各自再包一层。

extractor 是纯模块：只返回 entries 和 warnings，不访问 Webpack hooks、Session 或输出文件。Loader 把 entries 包装成 resource snapshot 并记录。

## 12. 一个 snapshot 何时可以进入 Plugin 的最终结果

Plugin 不负责从源码提取文案；它接收 Loader 创建的 snapshot，并决定哪些合法 snapshot 属于当前构建、可以发布。判断链是：

```text
资源进入当前 Module graph
    ↓
实际经过 i18n-collect Loader，或有合法恢复的 metadata
    ↓
include/exclude 通过
    ↓
extractor 在正确语义位置找到候选
    ↓
候选片段含 Han
    ↓
未被 no-i18n-auto 排除
    ↓
生成合法完整 snapshot
    ↓
identity、metadata schema/root/fileConfigHash 校验通过
    ↓
当前资源仍属于有效 Module graph
    ↓
同 identity 去重
    ↓
catalog 无 key conflict
    ↓
Compilation 与输出事务成功
    ↓
进入 committed 并写出正式产物
```

需要区分：

- Loader 被调用但没有中文，是合法的空结果，不是接入失败；
- 被 include/exclude 排除仍是 Loader 接入证据，但不贡献 snapshot；
- 不支持的 style 语言会产生 warning、提交空 snapshot，但通常不使本轮失败；
- 没有 Loader invocation，且没有合法恢复 metadata，才是集成失败；
- metadata schema、root 或 `fileConfigHash` 不匹配时，snapshot 不进入 live set，并使本轮产生诊断；
- snapshot 合法不等于已经发布，整个 Compilation、catalog 和输出写入都成功才算正式结果。

## 13. Plugin 的完整收集流程

Plugin 入口是 [packages/i18n-collect/myplugin/index.js](packages/i18n-collect/myplugin/index.js)。

### 13.1 `apply(compiler)`

Webpack 调用 `apply()`。Plugin 先取 root Compiler，再通过 `getSession()` 获取或创建该 Compiler 对应的 `CollectionSession`，然后注册 `thisCompilation`、`afterSeal` 和 `done` hooks。

### 13.2 `thisCompilation`

```text
thisCompilation
  → session.begin(compilation)
  → mainCompilation(compilation)
  → 建立本轮 round
```

### 13.3 Loader 执行

```text
runCollect()
  → loadConfig()
  → describeResource()
  → collectedFor()
  → extractor
  → publishWarnings()
  → record()
       ├── Module metadata
       └── round submission/invocation
```

### 13.4 `afterSeal`

Plugin 调用 `snapshotsForRelease()`：

```text
separatedModules()
  ├── main modules
  └── child modules

assembleLiveSet(main, context)  → live
assembleLiveSet(child, context) → recovered
session.candidateSnapshots()    → submitted
```

`assembleLiveSet(modules, context)` 会遍历传入的 Module，读取 `module.buildInfo.i18nCollect`，调用 `interpretMetadata()` 做 schema、root、配置 hash 和 snapshot 结构校验，按 identity 去重，并返回：

```js
{
  snapshots,
  integrated,
  diagnostics
}
```

- `live` 是主 Compilation 当前 Module graph 中的有效 snapshot；
- `recovered` 是 child Compilation 中恢复出的 snapshot，主要服务静态 HTML；
- `submitted` 是当前 round 中 Loader 主动提交的 candidate。

`afterSeal` 主要提前检查 metadata diagnostics 和 Loader 集成证据。没有 diagnostics 且有真实 invocation 或有效缓存 metadata，才允许继续；否则 abandon 当前 round 并把错误加入 Compilation。

### 13.5 `done`

`done` 阶段先检查 Webpack 是否有错误、Session 是否已经 abandoned。失败则不发布，保留上一轮 committed。

成功时再次调用 `snapshotsForRelease()`，读取包含 Plugin options 的最终配置，然后：

```text
activeHtmlTemplates()
  → 找到当前真正作为依赖的 HTML 模板

retainStaticHtmlSnapshots()
  → 处理 child HTML 的 live/submitted/committed 保留规则

buildCatalog()
  → 构建文案目录、hash dictionary、source map 所需聚合结果

检查 key conflict
  → 有冲突则 abandon，不写文件

session.release()
  → checkpoint → commit → writeOutputs
```

普通资源主要依据当前 Module graph 的 live；child compilation 的 HTML 只有在模板仍 active、文件存在、仍是依赖、scope 通过且没有新 snapshot 覆盖时才可恢复。Plugin 不读取业务源码，也不调用 extractor。

## 14. candidate、live、recovered、submitted、committed 的区别

```text
candidate / submitted
  当前 round 中 Loader 主动提交的 snapshot

metadata
  当前 Module 上的可序列化构建状态；缓存命中时可能被 Webpack 恢复

live
  当前主 Compilation 的 Module graph 中，由合法 metadata 组装出的临时集合

recovered
  child Compilation 的 Module metadata 组装结果，主要供静态 HTML 特殊恢复

committed
  最近一次完整成功发布的规范化结果
```

因此不是“先看 round，失败了再看 metadata”：Plugin 同时读取这些不同来源，并按资源和缓存场景组装最终候选。

第二次构建只重新执行 B，而 A、C 命中 filesystem cache 时，理想流程是：

```text
round.submissions → B 的新 snapshot
当前 Module metadata → A、B、C 的合法状态
live set → A、B、C
最终结果 → A + 新 B + C
```

如果 C 已经不在当前 Module graph，即使上一轮 committed 有 C，普通资源也不会无条件保留 C；成功轮次会淘汰 C。

## 15. `release`、失败和输出事务

一次收集只有在以下条件全部满足时才正式提交：

- Compilation 没有错误；
- Loader 接入证据完整；
- metadata diagnostics 为空；
- catalog 没有 key conflict；
- 多文件输出可以成功成组写入。

`release()` 的顺序是：

```text
保存旧 committed 的 checkpoint
    ↓
commit 当前 snapshots 到内存
    ↓
调用 writeOutputs()
    ├── 成功：新 committed 保留
    └── 失败：rollback 旧 committed，并 abandon 当前 round
```

失败 round 不能发布部分结果：

- 当前 round 作废；
- 上一次成功的 committed 保留；
- dictionary、source map、source catalog、catalog metadata 保持旧版本；
- 下一次构建再基于当前 graph 产生候选。

[packages/i18n-collect/mycommon/output.js](packages/i18n-collect/mycommon/output.js) 对多文件写入使用 journal：先写记录，再写临时文件、备份旧文件、逐个 rename；全部成功后删除 journal，任一步失败则按 journal 恢复。进程中途退出时，下一次提交先恢复残留 journal，避免多文件出现半新半旧。

## 16. 量的生命周期边界总表

| 量 | 创建/更新时机 | 生命周期边界 |
|---|---|---|
| `loaderContext` | 每次 Loader 调用由 Webpack 创建 | 一次 Loader 调用；不作为跨 Compilation 状态 |
| `Session` | 第一次看到 root Compiler 时由 `getSession()` 创建 | 当前 Node.js 进程中的 root Compiler 生命周期 |
| `round` | `thisCompilation → session.begin()` | 一次 main Compilation；成功 commit 或失败 abandon |
| `module metadata` | Loader 的 `record()` 写入当前 Module；Webpack cache 命中时可能恢复 | Module 构建状态；不由 round 自动回滚 |
| `submitted` | `session.submit()` 写入 round | 当前 round；同 identity 后提交覆盖前提交 |
| `live` | `assembleLiveSet()` 每次临时计算 | 当前 Compilation 的 Module graph |
| `recovered` | `assembleLiveSet(child)` 每次临时计算 | 当前 child Compilation 的 Module 集合 |
| `committed` | `release()` 成功写出后更新；写失败时 rollback | Session 中最近一次整体成功结果 |
| `dictionary/catalog` | `writeOutputs()` 成功后更新 | 磁盘上的持久化产物 |

## 17. 完整心智模型

调试收集时按下面顺序走：

```text
Webpack 创建 Compiler / Compilation / Module
  → loaderContext.resourcePath + resourceQuery
  → describeResource
  → include/exclude
  → collectedFor
  → semantic extractor
  → Han 门槛与 directives
  → entries、坐标、可选本地化 key
  → 完整 resource snapshot
  → Module metadata + current round submission
  → Plugin assembleLiveSet(main/child)
  → live / recovered / submitted
  → 静态 HTML 保留规则
  → buildCatalog
  → key conflict 检查
  → session.release
  → dictionary、source map、catalog 输出
```

遇到问题时不要跨层诊断：

- 没有 Loader invocation 是接入问题，不是 extractor 返回空结果；
- 空 snapshot 可能是合法结果，不代表 Loader 没有运行；
- metadata 缺失表示当前 Module 上没有可恢复状态，不能等同于源码没有文案；
- key conflict 是跨资源 catalog 问题，不是单个 parser 问题；
- stale replacement range 是 replacement 校验问题，不是 collection 问题。

## 18. 这份笔记回答的问题

1. `src/App.vue::template[lang=html]` 是什么？
2. 为什么 resource identity 要包含 Vue block、style index 和 lang？
3. 为什么公开 source map 没有 resource identity？
4. 为什么 snapshot 要完整替换而不是追加？
5. Webpack 增量构建与 snapshot 替换为什么不矛盾？
6. Webpack 是按文件还是按 Module 构建？
7. Compiler、Compilation、Module、moduleGraph 和 chunkGraph 分别是什么边界？
8. Session 与 round 的边界是什么？
9. LoaderContext、Module 和 `buildInfo` 的关系是什么？
10. metadata 为什么需要写到 Module 上？什么时候可能被 cache 恢复？
11. 为什么 memory cache 与 filesystem cache 的边界不同？
12. `live`、`recovered`、`submitted`、`committed` 分别是什么？
13. Plugin 如何从 Loader 和当前 Module graph 构建最终结果？
14. 为什么失败时必须保留上一轮 committed？
15. `pitch` 为什么要在源码转换前观察资源？
16. 为什么 Loader 是 observer 而不是 transformer？
17. Han 门槛、`i18n-key` 和 `no-i18n-auto` 分别做什么？
18. 为什么多文件输出需要 journal？

## 19. 主要源码索引

- [Loader 实现](packages/i18n-collect/myloader/index.js)
- [资源分类](packages/i18n-collect/myloader/resource.js)
- [Session、round 与 metadata](packages/i18n-collect/mycommon/session.js)
- [Plugin 实现](packages/i18n-collect/myplugin/index.js)
- [Catalog 构建](packages/i18n-collect/mycommon/catalog.js)
- [输出与 journal](packages/i18n-collect/mycommon/output.js)
- [收集架构](docs/collection-architecture.md)
- [项目中文 README](README.zh-CN.md)
- [第三课：提取语义](lessons/0003-extraction-semantics.html)
- [第五课：Session、Plugin 与输出](lessons/0005-session-plugin-output.html)

## 20. 最终总结

```text
Compiler 决定一个长期 Webpack 构建会话的边界
Compilation 决定一次构建轮次的边界
Module 是当前构建中的模块节点
Module metadata 是可随 Webpack cache 恢复的、附着在 Module 上的可序列化收集状态
Session 管理当前进程中一个 root Compiler 的多个 round 和 committed
round 保存本次 Compilation 的候选
live set 从当前 Module graph 临时组装有效 snapshot
Plugin 汇总并校验这些状态
只有完整 Compilation、catalog 和输出事务都成功，candidate 才成为 committed
```

最关键的一句话是：

> **Webpack 负责决定哪些 Module 重新处理或从 cache 恢复；Loader 负责为处理过的 resource 创建完整 snapshot；metadata 为 cache 恢复提供模块级数据载体；Plugin 从当前 Module graph 组装 live set，并通过 Session 的 round 与 committed 完成安全发布。**
