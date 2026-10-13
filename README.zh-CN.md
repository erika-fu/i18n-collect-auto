# i18n-collect：项目说明与业务使用指南

`i18n-collect` 是一个面向 **Webpack 5** 应用的构建期文案收集工具。它会在应用构建过程中，从已经进入 Webpack Loader 链的业务资源中识别静态、面向用户的中文文案，并生成：

- **运行时词典**：供应用或后续国际化流程消费；
- **来源映射（source map）**：记录每条文案来自哪个文件、什么语义位置及其精确坐标。

本仓库包含两个部分：

- `packages/i18n-collect`：实际的 Webpack Loader / Plugin 包；
- `apps/demo`：基于 Vue 2、Vue CLI、vue-loader 15 与 Vue I18n 8 的完整接入示例。

> 本工具负责“发现和汇总待国际化文案”，**不负责翻译、翻译审核、翻译平台对接、运行时语言切换或自动改写业务源码**。

---

## 目录

- [它解决什么问题](#它解决什么问题)
- [适用范围与核心边界](#适用范围与核心边界)
- [端到端工作流程](#端到端工作流程)
- [能够收集哪些文案](#能够收集哪些文案)
- [排除指令](#排除指令)
- [为什么采用这种实现](#为什么采用这种实现)
- [输出产物与业务含义](#输出产物与业务含义)
- [业务项目如何接入](#业务项目如何接入)
- [配置说明](#配置说明)
- [业务侧推荐工作流](#业务侧推荐工作流)
- [边界情况、失败语义与上线注意事项](#边界情况失败语义与上线注意事项)
- [开发、验证与相关文档](#开发验证与相关文档)

---

## 它解决什么问题

在存量前端项目中，用户可见中文往往散落在 JavaScript、Vue 模板、静态 HTML、CSS 生成内容等不同位置。仅靠人工搜索会遇到几个问题：

1. **覆盖不稳定**：不同语法、不同资源类型需要不同搜索规则；新增页面或新增资源类型后容易漏掉。
2. **无法追溯**：即使找到一句文案，也很难稳定地知道它在哪些文件、哪些位置重复出现。
3. **增量构建不可靠**：文件、导入、Vue block 或文案被删除后，旧词条可能残留在产物中。
4. **构建与运行时脱节**：词条清单、运行时字典和业务代码可能分别由不同机制维护，容易产生不一致。
5. **失败时污染产物**：如果本次收集过程只完成了一部分就覆盖旧文件，翻译或发布链路会消费不完整数据。

`i18n-collect` 的目标是把“可由静态分析确定的中文用户文案”变成一套可重复生成、可审计、可交给本地化流程处理的构建产物。

它并不要求业务代码立刻改成某一种 `t()` 调用形式。当前模型是：**源码保留原有静态中文，构建期收集候选文案，后续由业务团队决定如何使用收集结果。**

---

## 适用范围与核心边界

### 适用场景

本项目当前适合以下技术边界内的应用：

- 使用 **Webpack 5** 构建；
- 使用 JavaScript / TypeScript、Vue 单文件组件、HTML 或标准 CSS；
- 希望在构建期收集静态中文用户文案；
- 希望获得“词条值 + 全部来源位置”的稳定清单；
- 需要在 watch、增量编译、文件系统缓存及构建失败时保持收集结果可信。

仓库中的演示项目验证了 Vue 2 + Vue CLI 的接入方式，但提取器本身被设计为独立于 Vue 业务逻辑的纯模块。

### 不做什么

以下能力不属于当前版本的职责或支持范围：

- 不改写源码，也不会把中文字符串自动替换为 `$t()`、key 或其他调用；
- 不执行 JavaScript / Vue 表达式，不做变量求值、常量折叠或运行时推断；
- 不扫描整个项目目录来“补收集”；
- 不扫描最终 bundle；
- 不支持 Webpack 4、Vite 或 Rollup；
- 不解析 SCSS、Sass、Less、Stylus；
- 不提供翻译管理、翻译 API、译文审核或多语言发布工作流。

最重要的一条边界是：

> **只有真正进入 `i18n-collect/myloader` 的资源才会被收集。**
>
> Plugin 不会遍历 `src`，不会读取未参与构建的业务文件，也不会用目录扫描补偿 Loader 漏配。

这意味着“没有收集到”通常应先检查 Webpack 规则与 Loader 链，而不是假设工具会自动找到所有源码文件。

---

## 端到端工作流程

一次成功的收集轮次可以理解为以下过程：

```text
业务资源进入 Webpack Loader 链
        ↓
myloader 在源码仍具有脚本 / 模板 / 样式语义时识别资源类型
        ↓
对应 extractor 提取静态中文片段，形成该资源的完整 Resource snapshot
        ↓
snapshot 写入 Webpack module metadata，并提交到当前 collection session
        ↓
MyI18nPlugin 在成功编译后从当前 module graph 汇总有效 snapshot
        ↓
去重、稳定排序，并原子写出运行时词典和来源映射
```

其中有两个核心概念。

### Collected text（收集文案）

只要一个**静态片段**含有至少一个 Unicode Han Script 字符，就会成为候选收集文案。例如：

```js
'保存成功（2 项）'
```

会保留完整文本 `保存成功（2 项）`，而不是只截取其中的汉字。数字、标点、空格、拉丁字符和其他 Unicode 字符会保留在同一静态片段中。

纯英文、纯空白或纯标点不会触发收集。

### Resource snapshot（资源快照）

每次 Loader 处理一个资源，都会为它提交“完整替换”的快照，而不是只追加新发现的文案。即使该资源当前没有可收集文案，也会提交空快照。

这一点保证了：

- 删除一段中文后，旧词条会消失；
- 删除文件或取消导入后，旧词条会消失；
- 删除某个 Vue block 后，只有该 block 对应数据被移除；
- 更改过滤配置后，已经不在有效集合中的条目不会永久残留。

---

## 能够收集哪些文案

### 支持的来源

| 业务源码位置 | 示例 | semantic kind |
| --- | --- | --- |
| JavaScript / TypeScript 普通字符串 | `'保存成功'` | `script-string` |
| JavaScript / TypeScript 模板字面量的静态片段 | `` `第 ${index} 项` `` 中的 `第 `、` 项` | `template-literal` |
| Vue 模板文本 | `<p>欢迎使用</p>` | `html-text` |
| Vue 白名单属性 | `<input placeholder="请输入姓名">` | `html-attribute` |
| Vue 动态属性中的静态片段 | `:title="\`查看${name}资料\`"` 中的静态部分 | `html-attribute` |
| Vue 插值表达式中的静态片段 | `{{ condition ? '已启用' : '未启用' }}` | `template-expression` |
| 独立 HTML 文本 | `public/index.html` 中的文本节点 | `static-html-text` |
| 独立 HTML 白名单属性 | HTML 中的 `title`、`alt` 等 | `static-html-attribute` |
| 标准 CSS 的 `content` 字符串 | `content: "必填"` | `css-generated-content` |

同一条文案在多个文件或多个位置出现时，运行时词典中只保留一个 key；来源映射中会保留它的全部不同来源位置。

### JavaScript 与 TypeScript

支持：

```js
const message = '保存成功'
const label = `共 ${count} 项`
const nested = condition ? '已启用' : '未启用'
```

规则：

- 普通字符串作为 `script-string` 收集；
- 模板字面量按每个静态 segment 分开收集；
- 插值表达式内部出现的静态字符串仍可收集；
- `import` / `export` 的模块路径不会被当作文案；
- 不执行表达式，不推断变量值，也不会将 `'保存' + action` 合成为最终运行时文本。

### Vue 模板与 HTML

支持 Vue `<template>`、通过 HTMLWebpackPlugin 编译的独立 HTML 模板，以及允许被收集的用户可见属性。

默认属性白名单为：

```js
['title', 'placeholder', 'alt', 'aria-label', 'value']
```

例如：

```vue
<template>
  <section>
    <h1>账户设置</h1>
    <input placeholder="请输入姓名">
    <button :title="`查看${userName}的资料`">查看</button>
    <span>{{ loading ? '加载中' : '加载完成' }}</span>
  </section>
</template>
```

可收集的静态值包括：

- `账户设置`；
- `请输入姓名`；
- `查看`、`的资料`；
- `加载中`、`加载完成`。

规则与边界：

- 每个 HTML text node 独立处理，不跨标签拼接；
- 仅用于排版的首尾缩进和换行会被移除，有语义的内部空白会保留；
- 静态属性收集完整解码后的值；
- Vue 的 `:name` 和 `v-bind:name` 可收集其中可静态确定的字符串或模板片段；
- 事件、普通 directive、计算属性名、非白名单属性和内部数据属性不会收集；
- 独立 HTML 中的 EJS 占位片段不会被执行或改写。

HTML entity 的显示含义与坐标语义也被区分处理。例如：

```html
<p>保存&nbsp;成功</p>
```

词典中的值是解码后的 `保存 成功`，但来源范围仍指向源码中的 `保存&nbsp;成功`，便于在原始文件中准确定位。

### CSS 生成内容

当前仅解析标准 CSS，以及 Vue `<style>` 中未声明 `lang` 或声明 `lang="css"` 的样式块。

```css
.required::before { content: "必填"; }
.step::after { content: "第" counter(item) "项"; }
.label { content: var(--label, "默认标签"); }
```

可收集：

- `必填`；
- `第`；
- `项`；
- `默认标签`。

不会收集：

- CSS 注释；
- 选择器；
- 非 `content` 声明；
- custom property 的定义；
- `attr()`、`counter()`、变量引用本身；
- 空字符串、只有空白的字符串、`none`、`normal`。

CSS escape 与 HTML entity 一样：词典和哈希使用解码后的最终文本，source map 仍锚定原始拼写的位置。

---

## 排除指令

语法合法、去掉首尾空白后文本恰好是 `no-i18n-auto` 的注释，是一条排除指令。比较区分大小写。多写文字、拼写不同或大小写不同的注释都不是指令。指令是控制元数据，自身不会被收集。普通注释，包括含有中文的注释，也不会被收集，并且不会排除旁边的文案。

指令只关联紧跟在它后面、中间只有空白的那个可收集构造，并且只去掉该构造的下一处已收集片段。同一构造里更后面的片段，以及相邻构造，都会保留。写在构造后面的注释不会向前生效。被保留片段的源码坐标、资源快照和失败轮次语义不变。

脚本：

- 字符串字面量是构造，指令去掉这一个字符串；
- 模板字面量是构造，指令只去掉其中第一段含有汉字的静态片段；
- `// no-i18n-auto` 写在 `const label = "文案"` 上一行时，中间隔着代码，不会关联。注释需要紧挨在字面量前面。

Vue 模板和静态 HTML：

- 元素是构造。指令按源码顺序去掉该元素拥有的最早一处已收集片段：白名单属性早于元素文本，插值里的前一个片段早于后一个；
- 注释紧挨在某段文本前时，这段文本自己是构造，例如 `前文<!-- no-i18n-auto -->后文`。指令只去掉这段文本的第一处已收集片段；
- 注释和后一个元素之间的空白不会打断关联。如果紧挨着的元素没有可收集片段，指令不会顺延到下一个元素；
- 插值或动态属性里的 JavaScript 注释，按脚本规则处理那段表达式。

CSS：

- 注释是 `content` 声明的前一个节点，且中间只有空白时，声明是构造。指令去掉该声明里第一处已收集字符串；
- 注释紧挨在 `content` 值里的某个字符串前时，那个字符串是构造，指令只去掉它；
- 写在规则前面的注释，不会排除规则内部的字符串。

两条指令如果选中同一片段，只去掉这一次，不会再去掉后面的片段。

---

## 为什么采用这种实现

### 1. Loader 负责识别，Plugin 负责生命周期和输出

包对外提供两个入口：

```js
require('i18n-collect/myloader')
require('i18n-collect/myplugin')
```

职责严格分离：

| 组件 | 负责内容 | 不负责内容 |
| --- | --- | --- |
| `myloader` | 识别资源类型、应用过滤规则、调用 extractor、生成资源快照、记录模块元数据 | 汇总全项目、写输出、判断整个编译是否成功 |
| extractor | 对脚本、HTML/Vue 模板或 CSS 做语义级静态提取 | 感知 Webpack 生命周期、写文件 |
| collection session | 管理候选轮次、已提交快照、缓存恢复、警告去重、提交/放弃状态 | 重新解析业务源码 |
| `myplugin` | 创建编译轮次、汇总 module graph 中的快照、处理成功/失败、发布产物 | 扫描目录、读取或解析业务源码、调用 extractor |

这样设计的原因是：Loader 运行时仍能知道一段字节是脚本、Vue 模板还是 CSS `content`；如果改成 Plugin 在构建末尾扫描目录或 bundle，就会丢失这种语义，也可能收集到根本没有参与本次构建的文件。

### 2. 在语义收集阶段提取，而不是扫描 bundle

同样是字符串，语义不同，业务意义也不同：

- JavaScript 模块路径不是用户文案；
- Vue 的 `title` 可能是辅助技术可见文案，`data-id` 通常不是；
- CSS 注释不是界面文案，`content: "必填"` 才可能展示给用户；
- 最终 bundle 中的压缩、拼接和代码生成会破坏原始来源位置。

因此，项目在语义尚未丢失的 Loader 阶段进行提取，并通过 semantic kind 将来源类型固定在 source map 中。

### 3. Resource identity 避免互相覆盖和陈旧条目

资源身份由“项目相对路径 + 语义 block”组成。例如：

```text
src/utils/message.js::script
public/index.html::html
src/App.vue::script[lang=js]
src/App.vue::template[lang=html]
src/App.vue::style[index=0;lang=css]
```

同一个 `.vue` 文件的 script、template 和多个 style block 会被独立追踪，避免互相覆盖。无关的 Vue query（如 `id`、`scoped`、`prod`）不会造成重复身份；样式 block 的序号和语言会保留，因为它们会影响收集语义。

### 4. 面向缓存、watch 和失败的事务式发布

Webpack 增量构建或文件系统缓存可能不会重新执行每个 Loader。为此，Loader 创建的可序列化快照会保存在 module metadata 中，Plugin 从当前 module graph 恢复并验证它们，而不是重新扫描源码。

一次 collection round 只有在整个 compilation 成功后才提交：

- 解析错误、元数据错误、编译错误或写出错误都会放弃本轮候选结果；
- 上一次成功的内存状态与正式 JSON 文件会被保留；
- 不会发布“只收集到一半”的词典；
- 两个输出文件作为一对更新；写入中发生同步错误时会回滚。

这使构建产物可以被业务侧视为“最近一次成功收集结果”，而不是某次不完整构建的副作用。

### 5. 保留 Vue 原始坐标

vue-loader 会将单文件组件拆成不同请求，并可能改变中间源码形态。为了让 source map 指向业务人员实际编辑的 `.vue` 原文件，Loader 在处理当前 Vue 资源时会读取该资源原始文件，按 script/template/style block 计算原始坐标。

这只是为了保持当前已处理资源的定位准确；它不意味着 Plugin 可以遍历项目，也不意味着未进入 Loader 链的文件会被补收集。

---

## 输出产物与业务含义

默认会生成一对 JSON 文件：

```text
lang/zh_hash.json
lang/zh_hash.map.json
```

### 运行时词典：`zh_hash.json`

结构为：

```json
{
  "<md5-of-value>": "<collected-value>"
}
```

示例：

```json
{
  "7c09b461bc4e059b2156e9ec965c33b5": "保存成功"
}
```

- key 是解码后文案值的 UTF-8 MD5；
- value 是用户会看到的静态文案；
- 相同文案无论在源码中出现多少次，词典中只存在一个 key；
- key、条目和位置都稳定排序；
- 如果本轮内容与磁盘字节完全一致，工具不会重写文件。

该文件可以作为词条盘点、翻译导入前数据准备，或示例应用中 Vue I18n 的 messages 来源。

### 来源映射：`zh_hash.map.json`

结构概念如下：

```json
{
  "version": 1,
  "parserVersion": "babel-7",
  "configHash": "<md5>",
  "entries": [
    {
      "key": "<md5>",
      "value": "保存成功",
      "locations": [
        {
          "path": "src/pages/OrderPage.vue",
          "kind": "html-text",
          "start": { "line": 12, "column": 8 },
          "end": { "line": 12, "column": 12 }
        }
      ]
    }
  ]
}
```

它的业务价值是可追溯性：本地化、产品或研发人员可以回答“这句文案在哪里使用”“同一文案是否出现在多个页面”“修改或下线一条词条会影响哪里”。

注意：`parserVersion: "babel-7"` 是为了兼容既有 collection schema 而保留的历史 JavaScript parser 标记，**不表示 HTML 与 CSS 都由 Babel 解析**。

### 坐标约定

所有来源位置遵循同一约定：

- 路径相对项目根目录，分隔符统一为 `/`；
- 行号从 **1** 开始；
- 列号从 **0** 开始；
- 列以 UTF-16 code unit 计数；
- 范围是半开区间：`start` 包含、`end` 不包含。

历史 JavaScript 的范围会保留既有行为，包含字符串定界符；HTML 属性与 CSS 字符串的范围只覆盖实际片段，不包含属性名、等号、HTML/CSS 引号等语法定界符。

---

## 业务项目如何接入

### 1. 前置条件

包声明 Webpack 5 为 peer dependency。业务项目需要：

- 使用 Webpack 5；
- 将 `i18n-collect` 作为项目依赖接入；
- 确认希望收集的资源会进入 Webpack；
- 为每一种需要收集的资源形态配置同一个 Loader。

仓库根目录可以运行：

```bash
npm install
npm run serve
npm run build
npm test
```

其中 `apps/demo` 是实际可运行的参考实现。

### 2. 注册 Plugin

在 Webpack 配置中实例化 Plugin：

```js
const MyI18nPlugin = require('i18n-collect/myplugin')

module.exports = {
  plugins: [
    new MyI18nPlugin()
  ]
}
```

Plugin 负责按照当前 root compiler 管理 collection session，在成功编译后汇总 Loader 已提交的快照并写出正式文件。

### 3. 把 Loader 接入所有需要收集的语义入口

参考 [apps/demo/vue.config.js](apps/demo/vue.config.js)，业务项目至少应考虑以下入口：

| 资源类型 | 接入要求 |
| --- | --- |
| 普通 JS / TS 模块 | 接入 `myloader`；若使用 `thread-loader`，收集 Loader 必须排在它之前 |
| Vue `type=template` 请求 | 接入 `myloader` |
| Vue `type=script` 请求 | 接入 `myloader` |
| Vue `type=style` 请求 | 接入 `myloader` |
| 独立 `.css` | 放在会改变源码语义的后续 Loader 之前，使其看到原始 CSS |
| HTMLWebpackPlugin 模板 | 显式构造包含 `myloader` 的模板请求 |

Vue CLI 的完整参考配置已在 [apps/demo/vue.config.js](apps/demo/vue.config.js) 中落地。它除了注册 Plugin，还对 JS、Vue script/template/style、CSS 和 HTML 模板链分别插入同一个 Loader。

#### 为什么 Loader 顺序很重要

收集 Loader 的 `pitch` 阶段会读取原始资源。它必须在源码被其他 Loader 转换、短路或移交 worker 前执行。

特别是：

- 它不能运行在 `thread-loader` 后面；否则会报错，提示将它放在 `thread-loader` 之前；
- Vue block 应通过相应的 `resourceQuery` 规则接入；
- CSS 应在 postcss/css 等后续转换之前接入；
- HTMLWebpackPlugin 的模板不是普通 `.html` rule 必然能覆盖的请求，需要单独处理。

#### HTMLWebpackPlugin 的特殊接入

演示项目通过如下顺序构造模板请求（Loader 按从右到左运行）：

```text
html-webpack-plugin/lib/loader.js?force=true
  ! i18n-collect/myloader
  ! public/index.html
```

`force=true` 必不可少：当请求中已有其他 Loader 时，HTMLWebpackPlugin 自己的 Loader 可能跳过处理。该选项保证收集器看到原始 HTML，同时 HTMLWebpackPlugin 仍会处理 EJS 标记并注入构建资源。

### 4. 消费生成的运行时词典

演示项目使用 Vue I18n，示例位于 [apps/demo/src/lang/index.js](apps/demo/src/lang/index.js)：

```js
import Vue from 'vue'
import VueI18n from 'vue-i18n'

Vue.use(VueI18n)

const locale = 'zh'

export default new VueI18n({
  locale,
  messages: {
    [locale]: require(`/lang/${locale}_hash.json`)
  }
})
```

这段代码仅展示“如何把生成 JSON 作为 Vue I18n messages 的输入”。实际业务可以：

- 将 `zh_hash.json` 送入翻译管理平台作为候选词条；
- 用 `zh_hash.map.json` 建立页面、模块和词条责任人的追溯关系；
- 在 CI 中比对词典变化，形成新增/删除文案的审核环节；
- 按团队自己的 key 设计、译文管理和多语言资源发布方式进行二次处理。

本项目不规定这些后续流程，也不会自动将源码中的中文替换成 MD5 key。

---

## 配置说明

### 项目级配置文件

可选配置文件位于项目根目录：

```text
i18n-collect.config.js
```

默认配置为：

```js
module.exports = {
  styleExtensions: ['.css'],
  include: [],
  exclude: [],
  attributeAllowlist: ['title', 'placeholder', 'alt', 'aria-label', 'value'],
  outputPath: 'lang/zh_hash.json',
  sourceMapFilename: 'lang/zh_hash.map.json'
}
```

该文件会被 Loader 登记为 Webpack dependency（不存在时登记为 missing dependency），因此在 watch 模式下新增或修改配置会触发正确失效。

### 配置字段的职责归属

| 字段 | 归属 | 用途 |
| --- | --- | --- |
| `include` | Loader | 允许收集的项目内文件或目录前缀 |
| `exclude` | Loader | 拒绝收集的项目内文件或目录前缀 |
| `attributeAllowlist` | Loader | 允许收集的 HTML 用户可见属性名 |
| `styleExtensions` | Loader | 被当作样式资源识别的扩展名 |
| `outputPath` | Plugin | 运行时词典输出路径 |
| `sourceMapFilename` | Plugin | 来源映射输出路径 |

显式 Loader options 只能覆盖 Loader 字段；显式 Plugin options 只能覆盖 Plugin 字段。将字段传给错误的一侧，或配置未知字段，都会报错。

### `include` 与 `exclude`

这两个字段是**项目相对路径的文件或目录前缀**，不是 glob。

```js
module.exports = {
  include: ['src', 'public/index.html'],
  exclude: ['src/legacy']
}
```

匹配规则：

- `include: []` 表示允许所有已进入 Loader 的资源；
- 非空 `include` 时，资源至少要命中一个前缀；
- `exclude` 在 `include` 之后执行，拥有最终否决权；
- `src/foo` 匹配 `src/foo` 和 `src/foo/**`，不匹配 `src/foobar`；
- 不接受绝对路径、越过项目根目录的 `..`、空或项目根目录本身作为模式；
- 不会对 query string 匹配；
- Plugin 不会再次应用过滤规则。

完整安装与配置参考可见 [README.md](README.md)。

---

## 业务侧推荐工作流

下面是一套适合团队协作的使用方式。

### 1. 工程侧完成一次性接入

前端团队应确保：

1. 业务构建使用 Webpack 5；
2. `MyI18nPlugin` 已注册；
3. 所有要纳入盘点范围的 JS、Vue block、CSS、HTML 模板都经过 `myloader`；
4. Loader 顺序符合“先收集原始资源、再进行转换”的要求；
5. `include`、`exclude` 与属性白名单符合业务范围。

建议直接以 [apps/demo/vue.config.js](apps/demo/vue.config.js) 作为 Vue CLI 接入基线，并针对项目自身的 rule 结构调整。

### 2. 业务代码保持可静态识别

产品与前端协作时，应优先把用户可见的固定部分写成静态文本。例如：

```vue
<!-- 推荐：固定部分可收集 -->
<span :title="`查看${userName}的资料`">查看</span>

<!-- 不会推断 message 的运行时值 -->
<span>{{ message }}</span>
```

若需要国际化盘点，动态数据应由业务模型或翻译系统另行管理；收集器只对无需执行程序就能确定的片段负责。

### 3. 将输出视为“候选词条清单 + 追溯索引”

成功构建后：

- `zh_hash.json` 适合提供给词条盘点、导入或运行时示例；
- `zh_hash.map.json` 适合用于定位来源、判断同文案影响范围、分配模块负责人和审计删除原因。

翻译平台或运营系统可以在本工具之外，将这些数据转换为自己的词条 ID、审批状态、语言版本和发布记录。

### 4. 在 CI 或发布前审查变化

推荐将词典变化作为业务文案变更的一部分：

1. 构建生成最新收集结果；
2. 检查新增、修改和删除的词条；
3. 对照 source map 判断影响模块与页面；
4. 完成产品、翻译或研发审核；
5. 再按团队的发布策略更新多语言资源。

演示项目中，以下命令是刷新已提交示例词典和映射的唯一既定流程：

```bash
npm run update-demo-collection
```

普通测试不会重写 `apps/demo/lang` 中的文件。

---

## 边界情况、失败语义与上线注意事项

### 不支持的样式方言

SCSS、Sass、Less 和 Stylus 当前没有对应 parser。遇到 Vue 非 CSS `lang` 或配置中出现但尚未实现 parser 的样式扩展名时：

- 每个 Resource identity 每轮最多产生一个清晰 warning；
- 该资源提交空 snapshot；
- 不会尝试用标准 CSS parser 侥幸解析；
- 不会因为这一项直接使构建失败。

这意味着“构建成功”不等于这些方言中的中文已经被收集。若业务依赖这类样式中的生成文案，应在接入评估中明确补充 parser 的需求。

### 解析失败与正式输出保护

下列情况会使当前 collection round 失败：

- Babel 解析 JavaScript、TypeScript、Vue 插值或动态绑定表达式失败；
- 标准 CSS 解析失败；
- 无法安全恢复的 HTML 解析诊断；
- Loader metadata 校验失败；
- 输出准备或成对写入失败；
- 本轮既没有 Loader 调用证据，也没有可验证的缓存 metadata。

失败时的行为是：

- Webpack 保持失败；
- 当前候选快照被放弃；
- 上一次成功提交的快照不变；
- 两个正式 JSON 文件保持上一次成功版本；
- 不发布部分收集结果。

解析错误会尽力包含项目相对路径、语义 block、适用时的 style index / lang、1-based 行、0-based UTF-16 列以及底层错误原因。

### “词典为空”与“Loader 未接入”不同

如果资源经过 Loader，但没有任何含 Han 字符的可收集片段，空结果是正常的；被过滤资源与不支持的样式方言也会留下 Loader 已接入的证据。

相反，如果整个 compilation 中既没有真实 Loader 调用，也没有来自 Webpack 缓存的有效 metadata，Plugin 会使构建失败并提示检查：

- 普通 module rules；
- Vue script/template/style rules；
- HTMLWebpackPlugin 模板 Loader 链。

这样可以避免“配置漏了一段 Loader，但生成了看似成功的空词典”。

### watch 模式的额外编译

若应用本身导入生成的 JSON，词典写入会形成一个构建闭环：

```text
编译业务模块 → 收集文案 → 写词典
      ↑                       ↓
      └──── 应用又导入词典 ────┘
```

因此：

- 字典发生真实变化时，watch 模式可能额外编译一次，让应用把新 JSON 纳入下一轮 bundle；
- 随后的编译发现输出字节未变，不再写文件，watch 会安静下来；
- 对一次真实字典变化，最多会多出这一次后续编译。

### 单次生产构建的时序限制

Plugin 只有在 Loader 完成模块处理后，才能得到完整的本轮 collection result；但应用可能在构建开始时就已经导入了旧字典。因此：

> 一次性生产构建写到磁盘的词典是最新收集结果，但同一次构建输出的 bundle 仍可能内嵌构建开始时的上一版词典。

当前项目不会通过二次编译或双阶段构建强行消除这一限制。业务发布流程若要求“本轮 bundle 与本轮新增词典强一致”，应在本工具之外设计相应的预生成或多阶段构建方案。

### 缓存、删除与 child compilation

项目针对以下情况进行了明确处理：

- Webpack filesystem cache 恢复的 metadata 只有在 schema、root compiler 与配置哈希匹配时才可复用；
- 被删除的文件、导入、Vue block、旧 style identity 会在成功轮次中从 live set 淘汰；
- HTMLWebpackPlugin child compilation 中缓存的 HTML 快照只会在模板仍被配置、仍存在、仍为依赖且仍满足过滤规则时保留；
- 新提交的空 HTML snapshot 会明确清除旧结果。

这些机制的共同目标是：不因缓存保留陈旧文案，也不因未重新运行所有 Loader 而错误丢失仍然有效的文案。

---

## 开发、验证与相关文档

### 常用命令

```bash
# 安装工作区依赖
npm install

# 启动 Vue 演示项目
npm run serve

# 构建演示项目
npm run build

# 运行 i18n-collect 包测试
npm test

# 检查演示项目代码风格
npm run lint
```

文档或接入修改后，建议至少执行：

```bash
npm test
npm run build
git diff --check
```

`npm run update-demo-collection` 会更新演示项目提交的词典与来源映射；只有在有意刷新这些示例产物时才应运行它。

### 相关文档

- [README.md](README.md)：英文快速参考，涵盖安装、集成、配置、输出和限制；
- [docs/collection.md](docs/collection.md)：收集行为排障，包括 watch、失败轮次、未收集问题和坐标说明；
- [docs/collection-architecture.md](docs/collection-architecture.md)：中文架构设计记录，说明 Loader/Plugin 分工、资源身份、session 生命周期和设计取舍；
- [CONTEXT.md](CONTEXT.md)：项目领域词汇与 collection schema 的术语定义；
- [apps/demo/vue.config.js](apps/demo/vue.config.js)：Vue CLI 的可运行 Webpack 接入示例；
- [apps/demo/src/lang/index.js](apps/demo/src/lang/index.js)：演示项目消费生成词典的方式；
- [packages/i18n-collect/test/](packages/i18n-collect/test/)：脚本、HTML、CSS、资源身份、缓存、watch、失败回滚和真实 Webpack 集成的测试覆盖。
