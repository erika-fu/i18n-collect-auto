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

### 示例：订单页中的三种 identity

同一个文件中的 template、script、style 是不同的语义资源，因此会有不同 identity：

```text
src/pages/Order.vue::template[lang=html]
src/pages/Order.vue::script[lang=js]
src/pages/Order.vue::style[index=0;lang=css]
```

例如，删除 `<h1>订单详情</h1>` 时，只应更新 template 的 snapshot；`const submitLabel = '提交订单'` 和 CSS 的 `暂无订单` 不能因此消失。

对 `<h1>订单详情</h1>` 而言，三种标识分别回答不同问题：

```text
resource identity：src/pages/Order.vue::template[lang=html]
  → 哪个语义资源提供了它？

文案 hash：md5('订单详情')
  → 运行时旧版 hash 字典怎样按文本查到它？

localization key：order.title
  → 翻译 catalog 和后续替换代码使用什么稳定名称？
```

若另一个页面也写了“订单详情”，两处可以有相同的文本 hash，却仍可因为各自的 `i18n-key` 而使用不同翻译单元，例如 `order.title` 与 `history.order-title`。所以不能把“文本相同”误解为“业务语义一定相同”。

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

### 示例：删除属性文案时的 snapshot 替换

第一次构建时，template 的完整贡献可能是：

```text
旧 snapshot：订单详情、保存订单、保存
```

开发者随后删除了 `title="保存订单"`。第二次收集到的完整 snapshot 是：

```text
新 snapshot：订单详情、保存
```

Plugin 用新 snapshot 覆盖旧 snapshot 后，`保存订单` 才会从输出 catalog 中移除。

如果只做“发现一个词就 add”的追加逻辑，第二次构建没有发现 `保存订单` 并不等于主动删除它，旧词会错误地永久留在语言包中。这就是完整 snapshot 的价值。

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

### 示例：只修改 script 时如何保留页面的完整贡献

Vue SFC 不必只对应一个 Webpack Module。该文件可能产生类似请求：

```text
src/pages/Order.vue?vue&type=template&lang=html
src/pages/Order.vue?vue&type=script&lang=js
src/pages/Order.vue?vue&type=style&index=0&lang=css
```

当只修改 `const submitLabel = '提交订单'` 为 `const submitLabel = '确认提交'` 时，Webpack 可能重新处理 script 模块，而 template 和 style 模块命中缓存。此时：

```text
本轮 Loader submission：script 的新 snapshot
缓存恢复的 Module metadata：template、style 的旧但仍有效 snapshot
最终 live set：template + 新 script + style
```

因此，“只改了一行 JS”不等于 Plugin 的最终输出只含 JS 文案；Plugin 仍要从当前 Module graph 汇总整个页面乃至整个项目的有效贡献。

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

### 示例：显式 key、自动 key 与排除指令

`i18n-key` 是对“下一段文案”的命名：

```vue
<!-- i18n-key: order.title -->
<h1>订单详情</h1>
```

其结果类似：

```json
{
  "key": "order.title",
  "source": "订单详情",
  "location": {
    "path": "src/pages/Order.vue",
    "kind": "html-text",
    "start": { "line": 4, "column": 6 }
  }
}
```

如果没有注释，系统首次会分配一个不透明的自动 key，例如 `auto.<ULID>`。后续收集通过 semantic host、child role 与 local context 等 structural anchor，唯一匹配历史 occurrence 时复用这个 key。把 `<h1>` 从第 4 行移动到第 10 行时，坐标会变化，但它不是 key 身份本身；若 structural anchor 仍能唯一匹配，就不应仅因格式化源码生成新 key。

#### 为什么 structural anchor 只能作为候选信号

结构锚点（structural anchor）并不直接证明“新旧两个节点就是同一个 occurrence”。它回答的是一个更谨慎的问题：

> 旧 occurrence 在新 AST 中**可能**迁移到了哪些节点？

同一个 occurrence 经历常规编辑后，通常仍保留“在程序结构中扮演什么角色”的信息。比如旧代码：

```jsx
export function Header() {
  return <h1>{'欢迎'}</h1>
}
```

可以为 `'欢迎'` 记录近似如下的结构信息：

```text
module: src/Header.jsx
enclosing function: Header
ancestor path: ReturnStatement
  > JSXElement(h1)
  > JSXExpressionContainer
  > StringLiteral
role: expression of JSXExpressionContainer
```

之后即使只改了格式、加了空行，或在函数中插入不相关语句：

```jsx
export function Header() {
  logRender()

  return (
    <h1>{'欢迎'}</h1>
  )
}
```

行列号已经漂移，但这个 occurrence 仍同时满足：位于同一文件、同一个 `Header` 函数、`return` 中的 `h1`，并且仍是 `JSXExpressionContainer` 的表达式。因此，新的所有字符串 occurrence 中符合这些约束的节点，构成了合理的**候选集**。只有候选集恰好为一个，系统才有较强依据让它继承旧 occurrence 的自动 key。

它编码的是 occurrence 的**相对语义位置**，而非绝对字符位置。可以将三类信息类比为地址：

| 信息 | 地址类比 | 编辑后的稳定性 | 身份强度 |
|---|---|---|---|
| `line: 10, column: 15` | GPS 坐标 | 排版一改就漂移 | 弱 |
| `Header` 的 `return` 中 `h1` 的文本表达式 | 某栋楼的某个房间 | 小范围编辑后通常仍成立 | 候选信号 |
| 显式 `i18n-key` | 正式门牌号 | 人为维护时最明确 | 强 |

候选信号必须有足够区分度。以下代码中，两个 `'欢迎'` 的祖先路径和角色几乎相同：

```jsx
function Header() {
  return (
    <>
      <h1>{'欢迎'}</h1>
      <h1>{'欢迎'}</h1>
    </>
  )
}
```

此时 structural anchor 只能判断“这两个新节点都像旧节点”，不能判断“哪一个是旧 occurrence”。候选集大小为 2，身份恢复必须失败、保守地分配新自动 key，或要求维护者提供显式 `i18n-key`；绝不能任意挑选其中一个。

因此 structural anchor 能作为候选信号，不是因为 AST 天然携带身份，而是因为：

1. 同一节点经过常见编辑时，结构特征常能保留；
2. 不同节点通常具有不同的父节点链、属性角色或语义宿主；
3. 这些特征可将“全文件所有文本”缩小为少量可能继承旧身份的节点；
4. 仅当过滤结果唯一时，系统才有资格继续把它视为同一 occurrence。

与之相反，下面的 `no-i18n-auto` 表示跳过关联片段：

```js
/* no-i18n-auto */
const protocolLabel = '内部订单状态'
```

这里不会产生翻译条目；它不是“给条目命名”，而是明确告诉收集器该字符串不应自动本地化。

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

### 示例：在转换前观察原始源码，并用 Han 门槛过滤

假设 Loader 链中有会重写 Vue 内容的 Loader。`myloader.pitch` 在转换发生前读取原始 `Order.vue`，可以记录“订单详情”位于原文件的正确行列；它只观察，不修改返回源码。

```text
原始源码 → i18n-collect 的 pitch 观察并提取 → 后续 Loader 转换 → bundle
```

Han 门槛随后过滤候选：

| 源码片段 | 是否收集 | 示例原因 |
|---|---:|---|
| `'提交订单'` | 是 | 包含 Han 字符，整段作为文案保留 |
| `'保存成功（2 项）'` | 是 | 数字和括号不影响收集 |
| `'order-submit-button'` | 否 | 没有 Han，通常是技术标识 |
| `'Hello world'` | 否 | 没有 Han，不会仅因它是字符串而收集 |

注意：`'订单号：A-1024'` 会整体收集，而不是只提取“订单号”。收集器保留完整可翻译句子，翻译者才能调整词序和标点。

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

### 示例：candidate、live 与 committed 如何在一次修改中变化

设上一次成功构建的 committed 包含：

```text
订单详情、保存、提交订单、暂无订单
```

本轮把 `提交订单` 改为 `确认提交`。流程可理解为：

```text
candidate / submitted
  = Loader 本轮刚从 script 得到的“确认提交”

live
  = 当前 Module graph 中 template 的“订单详情、保存”
    + script 的“确认提交”
    + style 的“暂无订单”

committed
  = 只有 catalog 校验和所有输出文件都写成功后，才更新为上述 live 的正式版本
```

若本轮发现两个位置都声明 `i18n-key: order.title`，但一个源文本是“订单详情”、另一个是“订单历史”，就产生 key conflict。本轮必须失败，旧 committed 仍然保留；不能把一半新结果写到磁盘。

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

### 示例：多文件发布失败时如何恢复

一次成功发布通常同时更新多个文件，例如：

```text
lang/zh.json
lang/zh_hash.map.json
catalog.json
catalog.meta.json
```

若 `catalog.json` 已写成功，但接着写 `catalog.meta.json` 时磁盘报错，journal 会把前面已经替换的文件恢复。最终磁盘应保持“全部旧版本”，而不是出现“词典是新版本、metadata 是旧版本”的不一致状态。

这也是为什么“收集到了候选文案”不等于“它已经成为可以被团队使用的正式翻译目录”。

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

## 21. 本次讨论：replacement 是改源码，不是改构建产物

收集（collect）和替换（replace）是两个连续但职责不同的阶段：

```text
源代码中的中文
  ↓ collect
catalog / catalog metadata / 语言包
  ↓ 人工或平台补齐翻译
已知 key 与已知源码位置
  ↓ replace --write
源代码中的 t('key')、$t('key') 或 this.$t('key')
  ↓ 正常 build
新的 dist 构建产物
```

最容易混淆的一点是：**replace 的写入目标是项目源码，`dist` 是随后正常构建产生的结果。** replace 不直接搜索、修改或依赖已有的 `dist` 文件。

### 21.1 为什么 replacement 不重新扫描项目

replace 读取 catalog metadata 中已经记录的信息，而不是再次扫描所有中文：

```json
{
  "key": "order.save",
  "source": "保存",
  "location": {
    "path": "src/pages/Order.vue",
    "kind": "html-text",
    "start": { "line": 5, "column": 24 },
    "end": { "line": 5, "column": 26 }
  }
}
```

例如，以下两个“保存”可能含义不同：

```vue
<button>保存</button>       <!-- order.save -->
<button>保存</button>       <!-- profile.save -->
```

如果 replacement 按文本值全局查找并统一替换，它无法知道第一个应变为 `$t('order.save')`，第二个应变为 `$t('profile.save')`。因此它必须按 metadata 的文件和精确位置逐项验证。

### 21.2 `replace` 实际如何验证一处文本

假设 metadata 记录：

```text
src/pages/Order.vue，第 5 行第 24 至 26 列，原文“保存”，key 为 order.save
```

replace 的简化步骤是：

```text
1. 读取当前 src/pages/Order.vue
2. 将行列坐标换算为字符串 offset
3. 取出该范围的当前 slice
4. 确认 slice 仍然等于 metadata 中的“保存”
5. 分析它所在的语法位置和 adapter
6. 生成一个安全 edit，或明确报告 skip
```

如果 collect 之后有人把源码改成：

```vue
<button>存储</button>
```

原记录仍指向同一范围，但当前 slice 已是“存储”，不是“保存”。replace 必须跳过，并报告：

```text
catalog location does not match the current source
```

它绝不能因为 key 名为 `order.save` 就把新的“存储”强行改成 `$t('order.save')`；那会把人工改动悄悄覆盖为可能不正确的翻译单元。

### 21.3 preview、`--strict`、`--write` 的区别

仍用上例：metadata 记录“保存”，但源码已改为“存储”。三种模式的行为如下：

| 命令或模式 | 会得到什么 | 是否修改源码 |
|---|---|---:|
| 默认 preview | 计划结果与 skip 理由 | 否 |
| `replace --strict` | 发现 skip 后以退出码 7 结束 | 否 |
| `replace --write` | 仍先验证；这条不合法则不会替换 | 不会改这条 |
| `replace --strict --write` | 有任一 skip 就整体不提交 | 否 |

正常、可写入的例子是：

```vue
<!-- 写入前 -->
<button>保存</button>

<!-- vue2 / vue3 template 写入后 -->
<button>{{ $t('order.save') }}</button>
```

对于普通 JavaScript：

```js
// 写入前
const label = '提交订单'

// js adapter 或具备既有 t 的 vue3 script setup，写入后
const label = t('order.submit')
```

默认 preview 可能把上述“写入后内容”展示给开发者审阅，但只存在于报告或内存中；只有加 `--write` 才会写回 [src/pages/Order.vue](src/pages/Order.vue)。

### 21.4 adapter 不是自动安装运行时

replacement 只能使用项目已经具备的本地化调用方式：

| adapter | 可生成的例子 | 需要已存在的运行时条件 |
|---|---|---|
| `js` | `t('order.submit')` | 项目已有可用的 `t` 函数；不会自动插入 import |
| `vue2` | template 中 `$t('order.save')`；方法中 `this.$t('order.save')` | 已使用 VueI18n 8 |
| `vue3` | template 中 `$t('order.save')`；Options API 中 `this.$t(...)` | 已配置 vue-i18n 9+；script setup 还必须已有可用的 `t` |

反例：源码只有

```js
const label = '提交订单'
```

但项目既没有 `t` 的 import、也没有定义 `t`。replace 不应擅自输出：

```js
const label = t('order.submit')
```

因为这段代码会在运行时报 `t is not defined`。它不会替用户安装依赖、修改应用入口、创建 i18n 实例或猜测 import 来源。

### 21.5 能收集不代表一定能安全替换

collect 的工作是“识别并记录静态文本”；replace 的工作还要判断“生成调用后是否保持语法和运行时正确”。例如：

```js
// 支持：变量 value 位置
const title = '订单详情'
// → const title = t('order.title')

// 通常跳过：对象 key 位置
const labels = { '订单详情': value }
// 不应盲目变为 { t('order.title'): value }

// 已本地化：不重复嵌套
const title = t('order.title')
// 不应变为 t('order.title') 外再包一层 t(...)
```

Vue 属性也不能只替换字符串内容，必须转换为正确模板语法：

```vue
<!-- 写入前 -->
<button title="保存">保存</button>

<!-- 静态属性的安全写入形式 -->
<button :title="$t('order.save')">{{ $t('order.save') }}</button>
```

replace 会拒绝不支持的语义位置、重叠 edit、超出当前范围的 React JSX、CSS generated content 与独立 HTML 等情况。报告 skip 不是“忽略错误”，而是为了避免生成语法错误或运行时错误。

### 21.6 写入后的中文去了哪里

写入成功后，业务源码中的中文确实会被 key 调用替代：

```js
// 源码写入前
const title = '订单详情'

// 源码写入后
const title = t('order.title')
```

但原文和对应翻译不应丢失，它们存在 catalog/语言包中：

```json
{
  "order.title": {
    "zh-CN": "订单详情",
    "en-US": "Order details"
  }
}
```

因此用户最终看到的不是 key：运行时 `t('order.title')` 会根据当前语言取出相应文本。例如中文环境显示“订单详情”，英文环境显示“Order details”。

这里的“中文从源码消失”是有意的迁移结果；它不代表中文被删除，而是从业务代码移动到了专门管理翻译的目录。

### 21.7 为什么 `--write` 仍然需要事务

一次 replace 的事务会同时覆盖：

```text
src/pages/Order.vue             ← 替换源码
catalog 的既有文件               ← 与源码一起作为事务参与者原样重写
replacements.json               ← 记录替换结果
```

这里的 catalog 与 `catalog.meta.json` 不会被 replace 重新收集或改写业务内容；CLI 将它们作为同一份提交中的既有文件纳入 targets，保证这次迁移涉及的文件不会出现半新半旧。若 `Order.vue` 已成功写入 `$t('order.save')`，但随后 `replacements.json` 写入失败，系统必须通过同一个 journal 恢复 `Order.vue`。否则下一次运行会看到源码已本地化、报告却说尚未替换，形成半迁移状态。

成功重复执行也应保持幂等：

```js
// 第一次运行后
const label = t('order.submit')

// 第二次运行
// 识别为 already localized，不写成 t(t('order.submit'))
```

### 21.8 这次讨论的结论

```text
collect：发现中文，建立带 key、source、位置的 catalog metadata
replace preview：验证并展示计划，不写文件
replace --write：验证通过后修改项目源码，而非 dist
正常 build：根据已改源码生成新的 dist
运行时：通过 key 从语言包取得当前语言文本
```

最重要的判断口诀是：

> **收集阶段回答“有什么文案”；替换阶段回答“这个已记录的位置现在能否安全改成 key 调用”；构建阶段才把改过的源码编译成产物。**

## 22. 新增问题清单

19. collect 与 replace 分别读取什么事实来源？
20. 为什么 replacement 不能按“相同中文”做全局替换？
21. 默认 preview、`--strict`、`--write` 与 `--strict --write` 分别会不会写源码？
22. 为什么 replace 修改的是 `src`，而不是直接修改 `dist`？
23. adapter 为什么不能自动添加 import、安装 `vue-i18n` 或创建 `t`？
24. 为什么“收集成功”不保证“替换一定成功”？
25. 源码里的中文被替换后，原文和译文保存在哪里？
26. replacement 为什么也必须使用 journal 和幂等检测？

## 23. 补充源码与课程索引

- [替换预览实现](packages/i18n-collect/mycommon/replace-preview.js)
- [CLI replace 实现](packages/i18n-collect/cli/replace.js)
- [第九课：替换预览与写入](lessons/0009-replacement.html)

## 24. AST 与 `extract-script.js` 详解

本节围绕 `packages/i18n-collect/myloader/extract-script.js`，说明脚本提取器怎样利用 Babel AST 同时发现：

1. 源码中包含汉字的普通字符串；
2. 模板字符串中静态可确定的汉字段落；
3. 已经存在的静态显式本地化调用，例如 `t('home.title')`；
4. 与这些内容相邻的 `no-i18n-auto`、`i18n-key` 指令；
5. 日志、测试和埋点等可配置排除上下文。

这个文件的职责不是翻译，也不是修改源码。它只负责把一段脚本源码转换为结构化的收集结果：

```text
脚本源码
  → Babel 解析为 AST
  → 遍历感兴趣的节点
  → 应用语法、注释、上下文和内容过滤
  → 生成 entries
  → 交给后续 catalog、policy 和 replacement 流程
```

### 24.1 总调用链

脚本提取器在整个 Loader 收集流程中的位置可以概括为：

```text
Webpack 调用 myloader
  ↓
myloader/index.js: runCollect()
  ↓
describeResource() 判断当前 request 的语义资源类型
  ↓
collectedFor()
  ↓ resource.block === 'script'
extractScript({ source, resource, config })
  ↓
parser.parse(source)
  ↓
traverse(ast, visitors)
  ├─ CallExpression(nodePath)
  ├─ StringLiteral(nodePath)
  └─ TemplateLiteral(nodePath)
  ↓
entries
  ↓
snapshotFor(resource, entries)
  ↓
Session / catalog / formal outputs
```

这条调用链体现了职责分层：

- `myloader/index.js` 负责 Loader 生命周期、资源识别和结果提交；
- `extract-script.js` 负责脚本语义分析；
- `localized-call.js` 负责识别已本地化调用；
- `directives.js` 负责解析注释指令；
- `context-filter.js` 负责识别应排除的调用上下文；
- `resource.js` 负责 Han 判断和源码坐标转换。

### 24.2 AST、AST node 与 `NodePath`

AST 是源代码的结构化树形表示。例如：

```js
const message = '你好'
```

可以粗略表示为：

```text
VariableDeclaration
└── VariableDeclarator
    ├── id: Identifier(message)
    └── init: StringLiteral('你好')
```

Babel 遍历时传给 visitor 的参数不是单纯的 AST node，而是 `NodePath`：

```js
traverse(ast, {
  StringLiteral(nodePath) {
    // nodePath 是 NodePath
    // nodePath.node 才是 StringLiteral AST node
  }
})
```

可以把两者理解为：

```text
AST node
  = 当前语法节点本身的数据

NodePath
  = 当前语法节点在整棵树中的“导航包装器”
  = node + 父子关系 + 所在容器 + 作用域 + 遍历辅助方法
```

常见属性和能力如下：

| 属性或方法 | 含义 | 本文件中的用途 |
|---|---|---|
| `nodePath.node` | 当前 AST node | 读取节点类型、值、起止偏移量 |
| `nodePath.parent` | 原始父 AST node | 判断字符串是否直接位于 import/export 中 |
| `nodePath.parentPath` | 父节点的 `NodePath` | 向上查找调用上下文 |
| `nodePath.scope` | 当前词法作用域 | 本文件未直接使用，但 Babel 插件常用它分析绑定关系 |
| `nodePath.key` | 当前节点在父容器中的 key 或下标 | 可判断节点位于父节点的哪个字段 |
| `nodePath.listKey` | 当前节点所在数组字段名 | `context-filter.js` 用它确认节点是否位于 `arguments` |
| `nodePath.isCallExpression()` | 判断当前 path 是否包装调用节点 | 上下文过滤向上寻找最近调用时使用 |

当前编辑器选中的第 72 行是：

```js
if (MODULE_SPECIFIER_PARENTS.has(nodePath.parent.type)) return
```

这里应当是完整变量名 `nodePath`；如果编辑器只选中了 `odePath`，那只是选择范围少了首字母 `n`，不是另一个变量。

这一行具体做了三件事：

```text
nodePath
  → 当前 StringLiteral 的路径对象

nodePath.parent
  → 当前字符串的直接父 AST node

nodePath.parent.type
  → 父节点的语法类型名称
```

例如：

```js
import page from './中文页面'
```

`'./中文页面'` 是 `StringLiteral`，其直接父节点是 `ImportDeclaration`，所以：

```js
nodePath.parent.type === 'ImportDeclaration'
```

它会命中 `MODULE_SPECIFIER_PARENTS` 并直接返回，避免把模块地址误认为用户界面文案。

为什么这里不能只传 `nodePath.node`？因为原始 node 只描述当前字符串本身：

```js
{
  type: 'StringLiteral',
  value: './中文页面',
  start: 17,
  end: 25
}
```

仅看这些数据无法判断它究竟是：

```js
import page from './中文页面' // 模块地址，应排除
const label = './中文页面'    // 普通字符串，按其他规则判断
```

`NodePath` 提供的父节点和祖先链让提取器能够根据语法上下文，而不是只根据文本内容做判断。

### 24.3 文件依赖分别解决什么问题

文件开头的依赖可以分成五组。

#### Babel 解析与遍历

```js
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
```

- `parser.parse()`：把源码字符串转换为 AST；
- `traverse()`：遍历 AST，并在遇到指定类型的节点时调用对应 visitor。

#### 已本地化调用识别

```js
const {
  REPRESENTATION_LOCALIZED_CALL,
  isStaticLocalizationKeyArgument,
  staticLocalizationCall
} = require('../mycommon/localized-call')
```

- `staticLocalizationCall()`：判断一个调用是否为受支持的静态本地化调用；
- `isStaticLocalizationKeyArgument()`：判断一个字符串是否已经是本地化调用的 key 参数；
- `REPRESENTATION_LOCALIZED_CALL`：为这类 entry 标记来源类型。

当前实现只识别：

```js
t('home.title')
$t('home.title')
this.$t('home.title')
```

当前实现不识别：

```js
i18n.t('home.title')
obj.$t('home.title')
this.t('home.title')
t(dynamicKey)
t(`home.${section}`)
```

这里需要区分“通用 i18n 提取器可能支持什么”和“这个仓库当前代码实际支持什么”。本文件以 `localized-call.js` 的实现为准。

#### 注释指令

```js
const {
  babelComments,
  directivesBefore,
  runtimeKeyConflict,
  scanDirectives
} = require('./directives')
```

支持两类指令：

```js
/* no-i18n-auto */
/* i18n-key: home.title */
```

- `babelComments()`：把 Babel comment 转成项目内部的简化结构；
- `scanDirectives()`：预扫描并校验所有有效指令；
- `directivesBefore()`：查找某个语法结构前紧邻的指令；
- `runtimeKeyConflict()`：生成显式 key 冲突错误。

#### 上下文过滤

```js
const { contextSuppresses } = require('./context-filter')
```

它根据 `config.contextFilters` 判断当前节点是否位于日志、测试或埋点调用中。

#### 内容与位置工具

```js
const { containsHan, offsetToPosition } = require('./resource')
```

- `containsHan()`：判断文本中是否至少包含一个 Unicode Han 字符；
- `offsetToPosition()`：把 Babel 的字符偏移量转换为 `{ line, column }`。

### 24.4 输出 entry 的两种主要形态

提取器不是只收集中文，也不是只收集 key。它生成两类主要记录。

#### 源码文案 entry

```js
const title = '首页'
```

结果大致为：

```js
{
  value: '首页',
  locations: [
    {
      path: 'src/example.js',
      kind: 'script-string',
      start: { line: 1, column: 14 },
      end: { line: 1, column: 18 }
    }
  ]
}
```

如果使用显式注释 key：

```js
const title = /* i18n-key: home.title */ '首页'
```

结果还会包含：

```js
{
  key: 'home.title',
  value: '首页',
  locations: [/* ... */]
}
```

#### 已本地化调用 entry

```js
t('home.title')
```

结果大致为：

```js
{
  key: 'home.title',
  value: '',
  representation: 'localized-call',
  locations: [/* key 参数的位置 */],
  paramsKind: 'none',
  paramNames: []
}
```

这里的 `value` 是空字符串，因为 `'home.title'` 是本地化 key，不是中文源文案。真正的规范中文源文案应由 catalog 或 explicit message manifest 提供。

### 24.5 `MODULE_SPECIFIER_PARENTS`

```js
const MODULE_SPECIFIER_PARENTS = new Set([
  'ImportDeclaration',
  'ExportAllDeclaration',
  'ExportNamedDeclaration'
])
```

它列出“字符串虽然可能包含汉字，但语义上是模块地址”的直接父节点类型：

```js
import local from './中文模块'
import './另一个模块'
export * from './导出全部'
export { value } from './导出命名'
```

使用 `Set` 的原因是这里表达的是一个固定成员集合，并需要反复执行成员判断：

```js
MODULE_SPECIFIER_PARENTS.has(nodePath.parent.type)
```

这比一串重复的 `||` 更清晰，也更方便扩展。

### 24.6 `location()`：统一源码位置

```js
function location(source, projectPath, node, kind) {
  return {
    path: projectPath,
    kind,
    start: offsetToPosition(source, node.start),
    end: offsetToPosition(source, node.end)
  }
}
```

Babel node 使用 `start`、`end` 字符偏移量记录源码范围，项目对外需要的是项目路径、来源类型和行列位置。因此 `location()` 把 Babel 坐标适配成统一的 source range。

`kind` 在本文件中主要有：

```text
script-string    普通脚本字符串，或本地化调用的字符串 key 参数
template-literal 模板字符串的静态 quasi
```

位置数据用于：

- 报告文案来源；
- 识别 occurrence；
- 检测冲突；
- replacement 时定位源码；
- 在 CLI 错误信息中显示具体行列。

### 24.7 `entry()`：创建源码文案记录

```js
function entry(value, loc, key) {
  return key ? { value, key, locations: [loc] } : { value, locations: [loc] }
}
```

它处理包含实际源码文案的记录：

```js
entry('首页', loc)
// { value: '首页', locations: [loc] }

entry('首页', loc, 'home.title')
// { value: '首页', key: 'home.title', locations: [loc] }
```

这里不把缺失的 key 写成 `key: null`，而是直接省略字段，使“自动文案”和“显式 key 文案”的数据形态保持清楚。

### 24.8 `localizedCallEntry()`：创建已本地化调用记录

```js
function localizedCallEntry(key, loc, params = {}) {
  return {
    key,
    value: '',
    representation: REPRESENTATION_LOCALIZED_CALL,
    locations: [loc],
    paramsKind: params.paramsKind || 'none',
    paramNames: Array.isArray(params.paramNames) ? params.paramNames : []
  }
}
```

它记录源码已经使用了哪个静态 key，以及调用参数契约是什么。

```js
t('home.title')
// paramsKind: 'none'
// paramNames: []

t('items.deleted', { count })
// paramsKind: 'static'
// paramNames: ['count']

t('items.deleted', params)
// paramsKind: 'dynamic'
// paramNames: []
```

`paramsKind` 的含义是：

| 值 | 含义 |
|---|---|
| `none` | 没有第二个参数 |
| `static` | 第二个参数是可静态分析的对象字面量 |
| `dynamic` | 第二个参数无法安全得出固定参数名集合 |

这些信息可以让后续流程检查同一个显式消息的 placeholder contract 是否一致。

### 24.9 `extractScript()` 的入口校验

```js
function extractScript({ source, resource, config }) {
  if (typeof source !== 'string') throw new TypeError('Script extractor requires source text')
  if (!resource || typeof resource.projectPath !== 'string' || !resource.projectPath) {
    throw new TypeError('Script extractor requires a project path')
  }
```

入口立即验证两个必要条件：

- `source` 必须是源码字符串；
- `resource.projectPath` 必须是有效的项目相对路径。

这是边界处尽早失败的设计。没有项目路径，后续 entry 即使成功收集，也无法形成可追踪的位置记录。

### 24.10 解析源码

```js
const ast = parser.parse(source, {
  sourceType: 'unambiguous',
  plugins: ['jsx', 'typescript']
})
```

`sourceType: 'unambiguous'` 让 Babel 根据源码判断它更像 ESM 还是普通脚本，因此可以兼容：

```js
import app from './app.js'
const app = require('./app.js')
```

`plugins: ['jsx', 'typescript']` 表示解析器能读懂 JSX 和 TypeScript 语法。这里的“支持 TypeScript”主要是语法解析能力，不代表本文件会进行 TypeScript 类型检查。

例如它可以解析：

```ts
const title: string = '首页'
```

但不会使用 TypeScript 类型系统判断某个值在运行时必然是什么字符串。

### 24.11 `fail()`：把偏移量错误转换为源码位置错误

```js
const fail = (offset, message) => {
  const error = new Error(message)
  error.loc = offsetToPosition(source, offset)
  throw error
}
```

`directives.js` 只需要提供：

```text
错误偏移量 + 错误消息
```

当前提取器负责补充当前源码上下文，并转换为：

```js
error.loc = { line, column }
```

这种写法让错误位置的生成逻辑集中在一个地方，同时通过闭包复用当前 `source`。

### 24.12 注释指令预扫描

```js
const directives = scanDirectives(babelComments(ast.comments), fail)
```

这里先统一扫描全部注释，再开始处理字符串节点。这样 visitor 不需要反复解析注释文本，只需查询当前节点前方是否存在已经验证过的指令。

普通注释不会成为文案：

```js
// 这是开发说明
const title = '首页'
```

结果只收集 `'首页'`，不会收集注释中的中文。

只有格式精确匹配的注释才是指令：

```js
/* no-i18n-auto */          // 有效排除指令
/* i18n-key: home.title */  // 有效显式 key 指令

/* no-i18n-auto extra */    // 普通注释，不是有效排除指令
/* NO-I18N-AUTO */          // 大小写不匹配，不是有效指令
/* i18n-key home.title */   // 形似 key 指令但格式错误，会失败
```

`directivesBefore()` 还要求指令与目标语法结构之间只有空白。若中间隔着其他代码，指令不会跨越代码绑定到后面的字符串。

### 24.13 Visitor 之一：`CallExpression`

```js
CallExpression(nodePath) {
  const call = staticLocalizationCall(nodePath.node)
  if (!call) return
  // ...
}
```

`CallExpression` 表示函数或方法调用：

```js
alert('Hi')
t('home.title')
this.$t('home.title')
```

以：

```js
t('home.title', { name })
```

为例，其核心 AST 结构可粗略表示为：

```text
CallExpression
├── callee: Identifier(t)
└── arguments
    ├── StringLiteral('home.title')
    └── ObjectExpression
        └── ObjectProperty(name)
```

处理步骤如下。

#### 第一步：识别受支持的静态本地化调用

```js
const call = staticLocalizationCall(nodePath.node)
if (!call) return
```

只有调用者和第一个参数都满足规则时才继续：

```js
t('home.title')           // 收集
$t('home.title')          // 收集
this.$t('home.title')     // 收集

t(key)                    // 动态 key，不收集
t(`home.${page}`)         // 动态模板 key，不收集
i18n.t('home.title')      // 当前实现不支持
obj.$t('home.title')      // 当前实现不支持
```

#### 第二步：读取调用前的指令

```js
const directive = directivesBefore(source, directives, nodePath.node.start, fail)
```

它检查的是整个调用表达式前的相邻指令，而不是只检查 key 字符串前的注释。

#### 第三步：应用排除和上下文过滤

```js
if (directive.exclude) return
if (contextSuppresses(nodePath, config && config.contextFilters)) return
```

显式的 `no-i18n-auto` 可以排除调用记录；配置也可以排除位于特定上下文中的调用。

#### 第四步：检查 key 冲突

```js
if (directive.key && directive.key !== call.key) {
  fail(nodePath.node.start, runtimeKeyConflict(directive.key, call.key))
}
```

下面的代码表达了两个互相矛盾的 key：

```js
/* i18n-key: home.title */
t('home.other')
```

提取器不会猜测哪一个正确，而是立即失败，避免 catalog 和运行时代码对同一位置产生不同理解。

#### 第五步：生成 localized-call entry

```js
entries.push(localizedCallEntry(
  call.key,
  location(source, resource.projectPath, call.argument, 'script-string'),
  { paramsKind: call.paramsKind, paramNames: call.paramNames }
))
```

位置使用 `call.argument`，也就是第一个 key 参数，而不是整个调用表达式。因此 source range 精确覆盖：

```js
'home.title'
```

而不是：

```js
t('home.title', { name })
```

### 24.14 Visitor 之二：`StringLiteral`

```js
StringLiteral(nodePath) {
  if (MODULE_SPECIFIER_PARENTS.has(nodePath.parent.type)) return
  if (isStaticLocalizationKeyArgument(nodePath)) return
  const directive = directivesBefore(source, directives, nodePath.node.start, fail)
  if (directive.exclude) return
  if (contextSuppresses(nodePath, config && config.contextFilters)) return
  const value = nodePath.node.value
  if (!containsHan(value)) return
  entries.push(entry(
    value,
    location(source, resource.projectPath, nodePath.node, 'script-string'),
    directive.key
  ))
}
```

这是普通字符串提取的完整过滤管线。

#### 过滤一：模块地址

```js
if (MODULE_SPECIFIER_PARENTS.has(nodePath.parent.type)) return
```

排除 import/export module specifier。

#### 过滤二：已本地化调用的 key 参数

```js
if (isStaticLocalizationKeyArgument(nodePath)) return
```

遍历：

```js
t('home.title')
```

时，Babel 会先后遇到整个 `CallExpression` 和内部的 `StringLiteral('home.title')`。如果不排除这个字符串，它可能被重复或错误地作为普通源码文本处理。

该判断确保它只生成一条：

```js
{
  key: 'home.title',
  representation: 'localized-call'
}
```

#### 过滤三：相邻注释指令

```js
const directive = directivesBefore(/* ... */)
if (directive.exclude) return
```

例如：

```js
const internal = /* no-i18n-auto */ '内部标记'
```

不会进入结果。

#### 过滤四：调用上下文

```js
if (contextSuppresses(nodePath, config && config.contextFilters)) return
```

如果启用了对应配置，日志、测试和埋点参数中的字符串可以被排除。

#### 过滤五：Han 门槛

```js
const value = nodePath.node.value
if (!containsHan(value)) return
```

结果如下：

```js
'首页'           // 收集
'你好 ABC 123'   // 收集整个字符串
'𠀀'             // 收集，属于 Unicode Han
'hello'          // 不收集
'123'            // 不收集
'，。！'          // 不收集
'   '            // 不收集
```

它不是从字符串中截取汉字，而是以“是否至少包含一个 Han 字符”作为整段字符串的准入门槛。

### 24.15 Visitor 之三：`TemplateLiteral`

模板字符串：

```js
const message = `你好，${name}世界`
```

可粗略表示为：

```text
TemplateLiteral
├── quasis[0]: TemplateElement('你好，')
├── expressions[0]: Identifier(name)
└── quasis[1]: TemplateElement('世界')
```

visitor 的实现是：

```js
TemplateLiteral(nodePath) {
  if (contextSuppresses(nodePath, config && config.contextFilters)) return
  let pending = directivesBefore(source, directives, nodePath.node.start, fail)
  for (const node of nodePath.node.quasis) {
    const value = node.value.cooked
    if (!value || !containsHan(value)) continue
    const applied = pending
    pending = null
    if (applied && applied.exclude) continue
    entries.push(entry(
      value,
      location(source, resource.projectPath, node, 'template-literal'),
      applied && applied.key
    ))
  }
}
```

#### 为什么遍历 `quasis`

`quasis` 是模板字符串中静态可确定的片段。提取器不会执行 `${...}` 中的表达式，也不会尝试计算最终运行时字符串。

```js
`你好，${name}世界`
```

会得到静态片段：

```text
你好，
世界
```

不会得到：

```text
你好，张三世界
```

因为 `name` 的值只能在运行时确定。

#### `cooked` 是什么

```js
const value = node.value.cooked
```

`cooked` 是处理过转义后的模板片段值。例如源码转义序列会按 JavaScript 模板字符串规则得到对应文本值。位置仍然来自原始 AST node，因此可以继续锚定源码范围。

#### `pending` 为什么只消费一次

```js
const applied = pending
pending = null
```

模板前的一个指令只应用到第一个符合 Han 门槛的静态片段：

```js
const greet = /* i18n-key: home.greet */ `你好${name}世界`
```

结果相当于：

```js
{ value: '你好', key: 'home.greet' }
{ value: '世界' }
```

同一个显式 key 不会自动同时赋给多个独立 fragment。

排除指令也是一次性消费：

```js
const message = /* no-i18n-auto */ `排除${name}保留`
```

当前实现会排除第一个符合条件的静态片段 `'排除'`，但仍收集后面的 `'保留'`。这不是“排除整个模板字符串”，而是“排除该指令绑定的下一个 collected fragment”。理解测试时必须注意这个边界。

#### 模板表达式里的字符串怎样处理

```js
const message = `前缀${'内嵌'}后缀`
```

- `'前缀'` 和 `'后缀'` 由 `TemplateLiteral` visitor 处理；
- `'内嵌'` 本身是 `StringLiteral`，由 `StringLiteral` visitor 独立处理。

因此三段都能得到各自准确的位置和 `kind`。

### 24.16 上下文过滤怎样使用 `NodePath`

`contextSuppresses(nodePath, filters)` 不只查看当前 node，还会沿 `parentPath` 向上寻找语法上下文。

支持的配置值包括：

```js
{
  contextFilters: ['logging', 'tests', 'analytics']
}
```

#### 日志上下文

```js
console.log('日志文案')
logger.warn('警告文案')
```

启用 `logging` 时，作为对应调用参数的文案被排除。

#### 测试上下文

```js
it('用例标题', () => {
  const sample = '断言文案'
})
```

启用 `tests` 时，过滤器沿祖先链发现节点位于 `it()` 等测试调用内部，因而可以排除整个测试调用范围中的文案。

#### 埋点上下文

```js
track('埋点文案')
analytics.track('用户登录')
dataLayer.push({ event: '页面打开' })
```

启用 `analytics` 时，相应调用参数中的文案被排除。

这里必须使用 `NodePath`，因为过滤器需要：

- 通过 `parentPath` 向上寻找最近调用；
- 通过 `isCallExpression()` 判断祖先节点类型；
- 通过 `listKey === 'arguments'` 确认当前内容确实处在调用参数中。

仅有 `nodePath.node.value` 无法回答这些语义问题。

### 24.17 过滤规则总表

| 内容或上下文 | 默认行为 | 条件或原因 |
|---|---|---|
| `'首页'` | 收集 | 包含 Han 字符 |
| `'hello'` | 不收集 | 不包含 Han 字符 |
| `'你好 ABC'` | 收集整个字符串 | Han 是准入门槛，不做字符切片 |
| import/export 模块地址 | 不收集 | 父节点属于 module specifier 类型 |
| 普通中文注释 | 不收集 | 没有访问 comment 作为文案 |
| `/* no-i18n-auto */ '首页'` | 不收集 | 有效相邻排除指令 |
| `/* i18n-key: home.title */ '首页'` | 收集文案和 key | 显式 key 指令 |
| `t('home.title')` | 收集静态 key | 生成 `localized-call` entry |
| `t(key)` | 不作为 localized call 收集 | key 无法静态确定 |
| `i18n.t('home.title')` | 当前不收集 | 当前 callee 规则不支持 |
| `console.log('日志')` | 默认收集 | 只有配置 `logging` 才过滤 |
| `it('用例', ...)` | 默认收集 | 只有配置 `tests` 才过滤 |
| `track('埋点')` | 默认收集 | 只有配置 `analytics` 才过滤 |
| 模板 `${expression}` | 不执行表达式 | 只收集静态 quasi 或表达式中独立出现的字符串节点 |

### 24.18 完整示例

输入源码：

```js
import page from './中文页面'

const title = /* i18n-key: home.title */ '首页'
const greeting = `你好，${name}世界`
const ignored = /* no-i18n-auto */ '内部标记'

console.log('调试信息')
t('button.submit', { count })
```

若没有启用 `logging`，核心结果大致为：

```js
[
  {
    value: '首页',
    key: 'home.title',
    locations: [/* script-string 位置 */]
  },
  {
    value: '你好，',
    locations: [/* template-literal 位置 */]
  },
  {
    value: '世界',
    locations: [/* template-literal 位置 */]
  },
  {
    value: '调试信息',
    locations: [/* script-string 位置 */]
  },
  {
    key: 'button.submit',
    value: '',
    representation: 'localized-call',
    paramsKind: 'static',
    paramNames: ['count'],
    locations: [/* 'button.submit' 的位置 */]
  }
]
```

没有进入结果的内容：

```text
./中文页面  → 模块地址
内部标记    → no-i18n-auto 排除
name        → 动态表达式，不执行
```

若配置：

```js
{
  contextFilters: ['logging']
}
```

则 `'调试信息'` 也不会进入结果。

### 24.19 这里使用的设计思想

#### AST 静态分析

提取器分析代码结构，不执行用户代码。这样可以避免副作用、运行时依赖和动态结果的不确定性。

#### Visitor Pattern

```js
traverse(ast, {
  CallExpression() {},
  StringLiteral() {},
  TemplateLiteral() {}
})
```

AST 结构相对稳定，不同操作按节点类型分开。增加新的语法支持时，可以增加 visitor 或扩展辅助识别函数，而不需要把所有语法写进一套正则表达式。

#### 关注点分离

```text
extract-script.js   组织脚本提取流程
localized-call.js  识别本地化调用
directives.js      解析注释指令
context-filter.js  分析排除上下文
resource.js        处理字符和位置
```

每个模块只处理一类规则，降低主 visitor 的复杂度。

#### Fail-fast

格式错误或互相冲突的显式 key 会立即失败，而不是静默猜测：

```js
/* i18n-key home.title */        // malformed
/* i18n-key: a */ /* i18n-key: b */ '首页' // conflict
/* i18n-key: a */ t('b')         // runtime key conflict
```

这保护了 catalog、源码和运行时调用之间的一致性。

#### 统一中间表示

不同 JavaScript 语法最终都转换成 entry。后续流程只需理解 entry，不必重新遍历 JavaScript AST。

#### 精确来源追踪

每个 entry 都带 source range。位置不是附加展示数据，而是 occurrence identity、冲突诊断和安全 replacement 的基础。

### 24.20 提取不等于最终允许自动本地化

需要区分两个阶段：

```text
extractor
  → 发现源码中静态可见的片段和调用

policy / catalog
  → 判断这些结果是否符合完整静态文案、显式消息和运行时多语言边界规则
```

例如：

```js
`你好，${name}世界`
```

脚本提取器能够发现 `'你好，'` 和 `'世界'` 两个静态片段，但它们围绕动态插值形成 fragmented copy，不代表这两个片段适合独立翻译。按照仓库的 hybrid localization 规则，依赖变量、格式或结构的完整消息应优先写成显式本地化调用，并由一个消息控制 placeholder 和语序。

因此：

> “能被 AST 提取器看见”回答的是语法发现问题；“能否作为完整静态文案自动本地化”回答的是领域策略问题。

### 24.21 当前实现的边界

当前脚本提取器有意保持保守：

- 不执行变量、函数或模板表达式；
- 不解析动态 key；
- 不推断 `const key = 'home.title'; t(key)`；
- 不支持任意命名的翻译函数；
- 不支持当前规则以外的 `i18n.t()`、`obj.$t()`；
- 不根据 TypeScript 类型系统推断字符串值；
- 不负责判断翻译文本是否正确；
- 不负责把源码改写成 `t()`；
- 不负责跨文件合并 catalog。

这些限制减少误判，并让 extractor 保持可预测。需要增加调用形态时，应优先扩展 `localized-call.js` 的显式规则和对应测试，而不是在 `extract-script.js` 中加入模糊猜测。

### 24.22 推荐阅读顺序

继续学习这条链路时，可以按以下顺序阅读：

1. `packages/i18n-collect/myloader/extract-script.js`：掌握三个 visitor 的主流程；
2. `packages/i18n-collect/mycommon/localized-call.js`：理解静态 key 和参数契约识别；
3. `packages/i18n-collect/myloader/directives.js`：理解注释怎样绑定到后续语法结构；
4. `packages/i18n-collect/myloader/context-filter.js`：观察 `parentPath`、`listKey` 和祖先遍历；
5. `packages/i18n-collect/myloader/resource.js`：理解 Han 判断和源码坐标；
6. `packages/i18n-collect/test/script-extractor.test.js`：用测试确认每条边界规则；
7. `packages/i18n-collect/myloader/index.js`：把提取器放回 Loader 总调用链。

本节最重要的心智模型是：

```text
node 告诉我们“当前是什么语法”；
NodePath 告诉我们“当前语法处在整棵树的什么位置”；
visitor 决定“遇到这种语法要做什么”；
过滤规则决定“这次发现是否应进入收集结果”；
entry 是交给后续领域流程的统一结果。
```

## 25. HTML 与 Vue Template 中文文案收集

本文基于以下核心文件及相关实现，总结项目如何收集 HTML 和 Vue template 中的中文文案：

- `packages/i18n-collect/myloader/index.js`
- `packages/i18n-collect/myloader/extract-html.js`
- `packages/i18n-collect/myloader/template-parser.js`
- `packages/i18n-collect/myloader/template-parser-parse5.js`
- `packages/i18n-collect/myloader/template-parser-vue2.js`
- `packages/i18n-collect/myloader/template-parser-vue3.js`
- `packages/i18n-collect/myloader/vue-compiler-resolver.js`
- `packages/i18n-collect/myloader/directives.js`
- `packages/i18n-collect/myloader/context-filter.js`
- `packages/i18n-collect/mycommon/localized-call.js`
- `docs/adr/0002-native-vue-template-parser-adapters.md`

---

### 一、总体结论

HTML 文案收集采用的是一个**解析与策略分离的两阶段架构**：

```text
原始 HTML / Vue SFC
        │
        ▼
对应语言的模板解析器
parse5 / Vue 2 compiler / Vue 3 compiler
        │
        ▼
统一 Template IR
constructs / comments / regions / warnings
        │
        ▼
extractHtml()
统一执行文案收集策略
        │
        ▼
CollectedEntry[]
        │
        ▼
Loader snapshot → session → catalog/store
```

最重要的设计原则是：

> 模板解析器负责理解语法、恢复精确源码位置；`extractHtml()` 负责决定什么算文案、什么应该忽略，以及怎样生成统一收集条目。

因此：

- 不从 Vue 编译后的 render 函数中收集；
- 不让 `extractHtml()` 直接依赖 Vue 2、Vue 3 或 parse5 的 AST；
- Vue 2、Vue 3、独立 HTML 最终走相同的收集规则；
- 所有位置都指向原始 `.vue` 或 `.html` 文件，而不是转换后的虚拟模块；
- 解析器差异止步于 Template IR，后面的收集策略不感知解析器类型。

---

### 二、两层不同的统一 IR

讨论“统一 IR”时，需要区分两个层次。

#### 2.1 Template IR：模板解析层的统一结构

`parseTemplate()` 返回给 `extractHtml()` 的内部结构是：

```js
{
  constructs: [],
  comments: [],
  regions: [],
  warnings: []
}
```

它专门统一：

- parse5 AST；
- Vue 2 template AST；
- Vue 3 template AST。

概念结构如下：

```js
{
  constructs: [
    {
      id,
      kind: 'element' | 'text' | 'expression',
      name,
      parentId,
      start,
      end
    }
  ],

  comments: [
    {
      start,
      end,
      text
    }
  ],

  regions: [
    {
      type: 'text' | 'attribute' | 'expression',
      value,
      start,
      end,
      sourceOffsets,
      owners
    }
  ],

  warnings: []
}
```

这里不会暴露 Vue 2、Vue 3 或 parse5 的节点类型。

#### 2.2 CollectedEntry：整个收集系统共享的结果结构

`extractHtml()` 最后输出的条目属于更高一层的统一收集结构：

```js
{
  value: '保存',
  key: 'page.save',
  representation: 'localized-call',
  paramsKind: 'static',
  paramNames: ['count'],
  locations: [
    {
      path: 'src/App.vue',
      kind: 'html-text',
      start: { line: 3, column: 5 },
      end: { line: 3, column: 7 }
    }
  ]
}
```

这一层会被 HTML、JavaScript、CSS 等 extractor 共同使用，供后续流程完成：

- 去重；
- 自动 key 分配；
- catalog 生成；
- occurrence 生命周期管理；
- 完整性校验；
- 源码替换。

因此完整关系是：

```text
语言 AST
  ↓
模板专用 Template IR
  ↓
extractHtml 收集策略
  ↓
跨语言共享的 CollectedEntry IR
```

`entries` 确实是一种统一 IR，但它是**收集结果 IR**；Template IR 是它前面的另一层稳定边界。

---

### 三、完整调用链

#### 3.1 Loader 总调用图

```text
webpack 调用 i18n-collect/myloader
        │
        ├─ loader.pitch()
        │      └─ runCollect()
        │
        └─ loader()
               └─ 如果 pitch 尚未收集，再调用 runCollect()
                       │
                       ▼
               loadConfig()
                       │
                       ▼
               describeResource()
               判断资源属于：
               script / template / html / style
                       │
                       ▼
               isResourceIncluded()
                       │
                       ▼
               collectedFor()
                       │
                       ├─ Vue script → extractVueScript()
                       ├─ 普通 script → extractScript()
                       ├─ template/html → extractHtml()
                       └─ style → extractCss()
                               │
                               ▼
                      snapshotFor(resource, entries)
                               │
                               ▼
                      record()
                               │
                               ├─ module.buildInfo metadata
                               └─ CollectionSession.submit()
```

#### 3.2 HTML/Vue template 分支

当资源满足以下条件之一：

```js
resource.block === 'template'
resource.block === 'html'
```

Loader 调用：

```js
extractHtml({
  source: fs.readFileSync(resource.absolutePath, 'utf8'),
  resource,
  config
})
```

这里不是直接使用前一个 Loader 传入的 `sourceText`，而是重新读取当前文件的原始内容。

这样设计是因为 vue-loader 可能已经：

- 提取了 template block；
- 去掉了缩进；
- 添加了 padding；
- 改变了换行；
- 无法提供足够精确的原始列位置。

重新读取当前 `.vue` 文件，可以让最终位置准确指向原始 SFC。

这里仍然遵守一个重要边界：收集器只读取当前正在处理的资源，不扫描项目目录，也不读取其他业务文件。

---

### 四、模板解析器如何选择

`extractHtml()` 首先调用：

```js
const template = parseTemplate({
  source,
  resource,
  standalone,
  config
})
```

`parseTemplate()` 的分派规则是：

```text
template lang 不是 html
    → 返回空 Template IR

standalone HTML
    → parse5 adapter

Vue 2 template
    → vue-template-compiler adapter

Vue 3 template
    → @vue/compiler-sfc + @vue/compiler-dom adapter
```

调用图如下：

```text
parseTemplate()
  ├─ requestedLang() !== html → 空结果
  ├─ standalone === true      → parse5Adapter.parse()
  └─ Vue template
       ├─ resolveVueCompilers()
       ├─ Vue 2 → vue2Adapter.parse()
       └─ Vue 3 → vue3Adapter.parse()
```

#### 4.1 为什么不用 vue-loader 判断 Vue 版本

解析器不是根据 vue-loader 版本选择，而是：

1. 从当前 template 资源所在目录开始向上查找；
2. 找到最近的 `vue/package.json`；
3. 根据 Vue 主版本选择 compiler；
4. Vue 2 要求 `vue-template-compiler` 与 Vue 版本完全一致；
5. Vue 3 使用项目自己的 `@vue/compiler-sfc` 和 `@vue/compiler-dom`。

这样可以支持：

- 同一个 monorepo 同时存在 Vue 2 和 Vue 3；
- 使用与应用自身一致的模板语法；
- 避免收集器捆绑的 compiler 与项目 Vue 版本不匹配。

Vue template 最终确实可能被编译成 render 函数，但收集器的关键运行时机是：

```text
原始 template
  ↓
i18n-collect 读取和收集
  ↓
Vue compiler 生成 render 函数
```

收集器不分析 render 函数，而是读取原始 template，并直接调用项目对应版本的 Vue compiler 获取 template AST。

---

### 五、Template IR 各字段的作用

#### 5.1 `regions`：可能产生文案的源码片段

标准化后的 region 只有三类：

```text
text
attribute
expression
```

例如：

```html
<p title="提示">你好 {{ userName }}</p>
```

大致产生：

```js
[
  {
    type: 'attribute',
    name: 'title',
    value: '提示'
  },
  {
    type: 'text',
    value: '你好 '
  },
  {
    type: 'expression',
    value: 'userName',
    expressionKind: 'template-expression'
  }
]
```

`extractHtml()` 只消费这些标准化 region，不关心它们原来来自哪种 AST。

#### 5.2 `constructs`：注释指令的语义宿主

construct 表示一个可以绑定注释指令的模板构造，例如：

- 元素；
- 非空文本节点；
- 插值表达式。

例如：

```html
<!-- i18n-key: page.title -->
<section title="标题">正文</section>
```

注释先绑定到 `section` 这个 construct，再通过 `owners` 找到该 construct 内最早产生的收集条目。

这里最早的条目是 `title="标题"`，所以 key 会给属性文案，不会给后面的正文。

#### 5.3 `owners`：region 属于哪些祖先构造

每个 region 都保存：

```js
owners: [祖先 construct id, 当前 construct id]
```

这使 `extractHtml()` 不需要重新理解 AST，也能知道：

- 某个属性属于哪个元素；
- 某段文本位于哪个父元素；
- 某个注释指令应该影响哪条 entry；
- 指令应该只作用于下一处文案，而不是整个子树。

#### 5.4 `sourceOffsets`：把解析后的字符映射回原始源码

例如：

```html
<p>保存&nbsp;成功</p>
```

语义值应该是：

```text
保存 成功
```

但源码位置必须覆盖：

```text
保存&nbsp;成功
```

因此 region 同时保存：

```js
{
  value: '保存 成功',
  sourceOffsets: [
    // 解码后每个字符对应原始源码中的 offset
  ]
}
```

同样的映射还用于处理：

- `&#20320;&#22909;` 到 `你好`；
- CRLF 到 `\n`；
- Unicode 代理对；
- Vue 插值内的字符串位置；
- SFC template 相对于完整 `.vue` 文件的偏移。

这样最终 catalog 使用解码后的真实文案，而替换和诊断仍能精确指向原始源码。

---

### 六、三个模板解析适配器分别做什么

#### 6.1 独立 HTML：parse5 adapter

独立 HTML，例如 `public/index.html`，使用 parse5：

```text
parse5.parseFragment()
    │
    ├─ 建立 constructs
    ├─ 收集 HTML comments
    ├─ 建立 text regions
    ├─ 建立 attribute regions
    ├─ 解码 HTML entity
    ├─ 跳过 EJS 表达式区间
    └─ 返回 Template IR
```

#### EJS 的处理

例如：

```html
<title><%= htmlWebpackPlugin.options.title %> 中文标题</title>
```

parse5 adapter 会把 `<% ... %>` 区间切掉，只为普通 HTML 部分生成 region：

```text
EJS 表达式：不执行、不分析
中文标题：正常生成 text region
```

属性中也一样：

```html
<meta content="<%= prefix %>中文说明">
```

只收集 EJS 之外的静态部分。

原因是收集器不知道 EJS 表达式：

- 会返回什么；
- 会不会产生中文；
- 使用的是哪一种模板引擎语义。

因此只做静态源码收集，不执行模板。

#### 6.2 Vue 2 adapter

Vue 2 使用项目自己的 `vue-template-compiler`。

它首先定位 SFC 中真正的 template block，然后为了让 compiler 可以处理多个顶层节点，在片段外包一层虚拟根节点：

```html
<i18n-collect-root>
  原始 template 内容
</i18n-collect-root>
```

之后：

```text
vue-template-compiler.compile()
    │
    ├─ 获取带 start/end 的 Vue 2 AST
    ├─ 收集注释
    ├─ 标准化元素/文本/表达式
    ├─ 恢复属性源码范围
    └─ 转换成 Template IR
```

#### Vue 2 条件分支和 scoped slot

Vue 2 AST 的节点不一定只存在于普通 `children` 中，所以适配器额外合并：

- `node.children`；
- `node.ifConditions` 中的其他条件分支；
- `node.scopedSlots`。

因此：

```html
<p v-if="first">第一分支</p>
<p v-else-if="second">第二分支</p>
<p v-else>第三分支</p>
```

三个分支都能被遍历和收集，不会只看到第一个分支。

#### 6.3 Vue 3 adapter

Vue 3 分两步：

```text
@vue/compiler-sfc
    → 定位 SFC template block

@vue/compiler-dom
    → 解析 template 内容
```

Vue 3 adapter 遍历 compiler AST：

```text
Element       → element construct + attribute regions
Text          → text construct + text region
Interpolation → expression construct + expression region
Comment       → comment
其他容器节点   → 继续递归 children
```

Vue 2 和 Vue 3 最终输出相同形状的 Template IR，因此 `extractHtml()` 不需要区分 Vue 版本。

---

### 七、`extractHtml()` 的核心收集流程

总体流程：

```text
extractHtml()
   │
   ├─ 判断是 Vue template 还是 standalone HTML
   ├─ 确定最终 location kind
   ├─ 读取属性白名单
   ├─ parseTemplate() 生成 Template IR
   ├─ 遍历 regions
   │    ├─ text
   │    ├─ expression
   │    └─ attribute
   ├─ 应用 HTML 注释指令
   ├─ 去掉 suppress/dropped 条目
   └─ 映射成最终 CollectedEntry[]
```

#### 7.1 Vue template 与独立 HTML 的 kind 不同

```js
const standalone = resource.block === 'html'

const textKind = standalone
  ? 'static-html-text'
  : 'html-text'

const attributeKind = standalone
  ? 'static-html-attribute'
  : 'html-attribute'
```

最终分类如下：

| 来源 | kind |
| --- | --- |
| Vue template 静态文本 | `html-text` |
| Vue template 静态属性 | `html-attribute` |
| Vue 动态属性里的静态字符串 | `html-attribute` |
| Vue 插值表达式里的静态字符串 | `template-expression` |
| 独立 HTML 静态文本 | `static-html-text` |
| 独立 HTML 静态属性 | `static-html-attribute` |

这些 kind 不只是描述来源，也供后续替换策略判断：

- Vue template 有明确运行时语义，可以由 Vue adapter 替换；
- 独立 HTML 没有统一模板运行时，所以只收集、校验，不自动假设如何替换。

这并不表示 HTML 不能国际化，而是当前工具没有替项目决定应该使用：

- SSR；
- SSG；
- EJS/Nunjucks；
- 构建期 token；
- 多语言 HTML 输出。

---

### 八、各种文案类别具体怎样收集

#### 8.1 普通静态文本

输入：

```html
<p>保存成功</p>
```

parser 产生：

```js
{
  type: 'text',
  value: '保存成功'
}
```

`extractHtml()` 判断包含 Han 字符后直接收集：

```js
push(
  region.value,
  textKind,
  region.start,
  region.end,
  region.owners
)
```

输出：

```js
{
  value: '保存成功',
  locations: [
    {
      kind: 'html-text'
    }
  ]
}
```

中文判断使用 Unicode Han Script：

```js
/\p{Script=Han}/u
```

只要片段包含至少一个汉字，就保留整个片段，包括：

- 空格；
- 标点；
- 数字；
- 英文；
- emoji。

例如：

```html
<p> 保存 2 个文件 😄 </p>
```

收集值仍是：

```text
 保存 2 个文件 😄 
```

不会自动 `.trim()`。

但是解析器会去掉纯排版性的首尾换行缩进。标签内容内部真正存在的换行和缩进仍会保留。

#### 8.2 嵌套元素中的文本

输入：

```html
<p>你好 <em>世界</em> 啊</p>
```

不会合并成一句 `你好 世界 啊`，而是按 AST 文本节点分别收集：

```js
[
  '你好 ',
  '世界',
  ' 啊'
]
```

这样设计是因为它们对应三个独立源码范围，也可能属于不同的 DOM 结构。

不过需要注意：

> 能够收集静态片段，不等于这些片段适合独立翻译。

结构化句子可能需要在更高层改造成显式完整消息，否则不同语言很难调整词序。

#### 8.3 HTML entity

输入：

```html
<p>保存&nbsp;成功</p>
<p>&#20320;&#22909;</p>
```

输出值：

```js
[
  '保存\u00a0成功',
  '你好'
]
```

但位置分别覆盖原始源码：

```text
保存&nbsp;成功
&#20320;&#22909;
```

#### 8.4 静态属性

默认白名单为：

```js
[
  'title',
  'placeholder',
  'alt',
  'aria-label',
  'value'
]
```

例如：

```html
<input
  title="保存成功"
  placeholder="请输入"
  alt="示例图片"
  aria-label="关闭"
  value="提交"
  class="不收集"
  data-id="不收集"
>
```

收集：

```js
[
  '保存成功',
  '请输入',
  '示例图片',
  '关闭',
  '提交'
]
```

不收集：

```text
class
data-id
```

原因是不能把所有属性里的中文都视为用户可见文案。例如：

- `class="中文主题"` 可能只是技术标识；
- `data-id="中文编号"` 可能是业务数据；
- 自定义属性的语义无法通用判断。

因此采用显式白名单，而不是“所有属性包含中文就收集”。

#### 8.5 Vue 动态绑定属性

只处理白名单中的绑定属性：

```html
<input
  :placeholder="'请' + missing + '输入'"
  :title.sync="`前缀${name}后缀`"
  v-bind:alt.prop="'图片'"
  :value.camel="'字段'"
>
```

支持的绑定形式：

```text
:title
v-bind:title
:title.prop
:title.sync
:title.camel
```

允许的 modifier 只有：

```text
prop
sync
camel
```

表达式不会被执行，而是交给 Babel：

```text
属性源码字符串
    ↓
Babel parseExpression()
    ↓
Babel traverse()
    ↓
提取静态 StringLiteral / TemplateLiteral 静态段
```

上例收集：

```js
[
  '请',
  '输入',
  '前缀',
  '后缀',
  '图片',
  '字段'
]
```

不会把：

```js
'请' + missing + '输入'
```

求值成 `请输入`，因为 `missing` 是运行时变量。

#### 不支持的动态属性

```html
<div :[dynamicName]="'中文'">
<div :title.unknown="'中文'">
<div :class="'中文'">
```

这些都不会收集：

- 动态属性名无法确定最终语义；
- 未知 modifier 不接受；
- `class` 不在展示属性白名单。

#### 独立 HTML 不分析动态绑定

即使独立 HTML 中出现：

```html
<div :title="'中文'">
```

也不会把它当 Vue 表达式分析。

原因是普通 HTML 中的 `:title` 不一定属于 Vue，收集器不能擅自给它套用 Vue 表达式语义。

#### 8.6 Vue 插值表达式

输入：

```html
<p>你好 {{ empty + '拼接后的中文' }}</p>
```

先被模板 adapter 分成两个 region：

```text
text region:       "你好 "
expression region: "empty + '拼接后的中文'"
```

然后输出：

```js
[
  {
    value: '你好 ',
    kind: 'html-text'
  },
  {
    value: '拼接后的中文',
    kind: 'template-expression'
  }
]
```

插值本身由 Vue compiler 确定边界，因此表达式中出现 `}}` 字符串也不会被简单字符串扫描错误截断：

```html
<p>{{ ({ label: '包含}}的中文' }) }}</p>
```

仍能正确识别 `'包含}}的中文'`。

#### 8.7 模板字符串

输入：

```html
<p>{{ `这是${name}的名字呀` }}</p>
```

Babel 将它解析为一个 `TemplateLiteral`，其中有两个静态 quasi：

```text
这是
的名字呀
```

输出：

```js
[
  {
    value: '这是',
    kind: 'template-expression'
  },
  {
    value: '的名字呀',
    kind: 'template-expression'
  }
]
```

同样，这只是发现静态片段，不代表两个片段应该分别翻译。更可靠的国际化形式通常是完整消息加参数：

```js
t('person.name', { name })
```

#### 8.8 已存在的本地化调用

表达式中的以下调用会被识别：

```js
t('home.title')
$t('home.title')
this.$t('home.title')
```

例如：

```html
<p>{{ $t('items.deleted', { count }) }}</p>
```

不会把 `'items.deleted'` 当普通文案收集，而是生成：

```js
{
  value: '',
  key: 'items.deleted',
  representation: 'localized-call',
  paramsKind: 'static',
  paramNames: ['count'],
  locations: [
    {
      kind: 'template-expression'
      // 范围指向 'items.deleted'
    }
  ]
}
```

参数分类：

```text
没有第二个参数
    → paramsKind: none

对象字面量 { count, name }
    → paramsKind: static
    → paramNames: ['count', 'name']

变量、函数调用、展开属性等
    → paramsKind: dynamic
    → paramNames: []
```

例如：

```html
<p :title="t('items.deleted', params)"></p>
```

得到：

```js
{
  paramsKind: 'dynamic',
  paramNames: []
}
```

这样收集器不仅知道“这里已经本地化”，还知道运行时参数的大致结构。

#### 8.9 Context filter

模板表达式中的静态字符串也会经过可选的上下文过滤：

```js
contextFilters: [
  'logging',
  'tests',
  'analytics'
]
```

例如启用 `logging` 后：

```html
<p>{{ console.log('调试信息') }}</p>
```

其中 `'调试信息'` 可以被过滤。

需要注意：

- context filter 作用于 Babel 表达式候选；
- 不会凭猜测过滤普通 HTML 静态文本；
- 默认 `contextFilters: []`，即全部保留。

---

### 九、`v-if`、`v-for`、`@click` 如何处理

更准确的描述是：

> 这些指令会被模板解析器识别，也通常会进入标准化的 attribute region；只是 `extractHtml()` 的属性分类策略会将它们排除，不进一步解析其中的 JavaScript。

#### 9.1 `v-if`

```html
<p v-if="visible">欢迎</p>
```

流程：

```text
Vue compiler
  ├─ 理解 v-if 控制流
  ├─ 生成 v-if 属性/指令信息
  └─ 保留子节点“欢迎”

Template IR
  ├─ attribute region: v-if="visible"
  └─ text region: "欢迎"

extractHtml
  ├─ classifyAttribute("v-if") → 不在白名单，跳过
  └─ text 包含汉字 → 收集“欢迎”
```

结果：

```js
['欢迎']
```

不收集 `visible`。

#### 9.2 `v-for`

```html
<li v-for="item in items">{{ item.name }}</li>
```

处理结果：

- `item in items` 不分析；
- `item.name` 没有静态中文，不产生 entry；
- 如果子节点中有静态文字，仍正常收集。

例如：

```html
<li v-for="item in items">
  商品：{{ item.name }}
</li>
```

收集：

```js
['商品：']
```

#### 9.3 `@click`

```html
<button @click="save()">保存</button>
```

收集：

```js
['保存']
```

不分析 `save()`。

即使写成：

```html
<button @click="notify('保存成功')">保存</button>
```

当前实现也只收集按钮正文：

```js
['保存']
```

不会收集事件表达式中的 `保存成功`。

原因不是 Babel 无法解析，而是 `@click` 没有通过 `classifyAttribute()` 的展示属性白名单，因此根本不会进入 `collectExpression()`。

这体现了一个重要的语义边界：

> 只分析明确具有用户展示语义的模板属性，不把事件处理、控制流和任意业务逻辑中的字符串都视为界面文案。

这类消息更适合放到 script 中：

```js
function save() {
  notify('保存成功')
}
```

然后由 script extractor 收集。

#### 9.4 `:title` 是例外

```html
<button :title="t('save.tip')">保存</button>
```

因为 `title` 在展示属性白名单中，所以：

```text
attribute region
  ↓
classifyAttribute(':title')
  ↓
dynamic + allowlisted
  ↓
collectExpression()
  ↓
Babel traverse()
  ↓
识别 t('save.tip')
```

结果中同时存在：

```js
[
  {
    value: '',
    key: 'save.tip',
    representation: 'localized-call',
    kind: 'html-attribute'
  },
  {
    value: '保存',
    kind: 'html-text'
  }
]
```

#### 9.5 指令处理总结

| 写法 | Vue compiler 是否理解 | 是否分析指令表达式 | 子节点是否继续扫描 |
| --- | ---: | ---: | ---: |
| `v-if="visible"` | 是 | 否 | 是 |
| `v-for="item in items"` | 是 | 否 | 是 |
| `@click="save()"` | 是 | 否 | 是 |
| `@click="notify('成功')"` | 是 | 否，不收集“成功” | 是 |
| `:class="'中文'"` | 是 | 否，非白名单 | 是 |
| `:title="'提示'"` | 是 | 是 | 是 |
| `{{ '提示' }}` | 是 | 是 | 不适用 |
| `{{ t('page.title') }}` | 是 | 是，记录 localized call | 不适用 |

---

### 十、注释指令如何工作

支持两类注释：

```text
no-i18n-auto
i18n-key: page.title
```

#### 10.1 HTML 层注释

例如：

```html
<!-- no-i18n-auto -->
<section title="排除标题">保留正文</section>
```

注释绑定到下一个 construct，也就是 `section`。

然后通过 `owners` 找出这个 construct 中最早产生的 entry：

```text
title="排除标题"
```

只删除这一条，后面的 `保留正文` 仍会收集。

也就是说：

> 写在元素前面的 `no-i18n-auto` 不是“忽略整个元素子树”，而是“忽略这个构造中的下一处可收集片段”。

#### 10.2 显式 key

```html
<!-- i18n-key: page.title -->
<h1 title="标题提示">页面标题</h1>
```

由于属性按源码顺序早于正文，key 默认给最早的 entry：

```js
{
  value: '标题提示',
  key: 'page.title',
  kind: 'html-attribute'
}
```

正文仍然没有显式 key。

#### 10.3 表达式内注释

```html
<p>
  {{ /* no-i18n-auto */ '排除' + '保留' }}
</p>
```

表达式先由 Babel 解析，注释指令根据 AST 中字符串节点的位置绑定到下一处候选。

结果：

```js
['保留']
```

#### 10.4 key 冲突

```html
<p>
  {{ /* i18n-key: home.title */ t('home.other') }}
</p>
```

注释 key 与现有 localized-call key 不一致，会直接报错：

```text
i18n-key "home.title" conflicts with localized-call key "home.other"
```

相同 key 是允许的：

```html
{{ /* i18n-key: home.title */ t('home.title') }}
```

这样可以防止源码注释和运行时调用在 catalog 中静默指向两个不同消息。

---

### 十一、独立 HTML 与 Vue template 的区别

两者共享 `extractHtml()` 的文案策略，但解析器和后续能力不同。

| 方面 | Vue template | 独立 HTML |
| --- | --- | --- |
| 解析器 | Vue 2/3 compiler | parse5 |
| 静态文本 | 收集 | 收集 |
| 静态白名单属性 | 收集 | 收集 |
| `{{ expression }}` | 分析 | 不按 Vue 表达式处理 |
| `:title` | 分析 | 跳过动态属性 |
| EJS `<%= ... %>` | 不适用 | 跳过表达式，只收集静态部分 |
| 最终 kind | `html-*` / `template-expression` | `static-html-*` |
| 是否有统一运行时替换语义 | 有 Vue 语义 | 没有 |
| 当前是否可自动替换 | 取决于 Vue adapter | 不支持通用自动替换 |

独立 HTML 不是不能国际化，也不是必须使用 `$t()`；只是当前工具只负责发现、记录和校验，没有定义应该生成：

- EJS 表达式；
- SSR token；
- SSG 多语言文件；
- HTMLWebpackPlugin 模板参数；
- 其他项目特定形式。

同理，CSS 也可以通过构建期产物、locale class、`:lang()` 或 CSS 变量完成国际化，不一定使用 `$t()`。当前工具不自动替换 HTML/CSS 的根本原因，是没有一个通用且可靠的输出策略，而不是它们无法国际化。

---

### 十二、设计思想及为什么这样设计

#### 12.1 用真正的语言解析器理解语法

Vue template 不使用 parse5 加自定义字符串扫描，而是：

- Vue 2 用 Vue 2 compiler；
- Vue 3 用 Vue 3 compiler；
- 独立 HTML 才用 parse5；
- template 内的 JavaScript 表达式用 Babel。

优点：

- 插值边界可靠；
- `v-if` 分支可靠；
- scoped slot 可靠；
- 属性位置可靠；
- 不需要自己重新实现 Vue 语法；
- Vue 2 和 Vue 3 的差异被隔离在 adapter 内。

#### 12.2 Parser adapter 只负责事实，collector 负责政策

Parser adapter 只回答：

```text
这里有一个文本 region
这里有一个属性 region
这里有一个表达式 region
这里对应原始源码的这些 offset
它属于这些 construct
```

它不决定：

- 哪些属性可收集；
- 是否包含中文；
- 是否属于 logging；
- 是否是 `$t()`；
- `no-i18n-auto` 怎样生效；
- 最终 kind 是什么。

这些都由 `extractHtml()` 统一处理。

这样可以避免三个 adapter 各自复制一套收集政策。

#### 12.3 保留原始源码位置是核心约束

工具不仅要生成翻译目录，还要支持：

- 精确诊断；
- occurrence 生命周期；
- 自动 key 稳定复用；
- 后续源码替换；
- 冲突定位。

因此“知道文案是什么”还不够，必须知道：

```text
文案来自哪个文件
从哪一行哪一列开始
到哪一行哪一列结束
原始拼写是什么
```

这就是为什么 Template IR 需要 `sourceOffsets`，而不是只保存解析后的字符串。

#### 12.4 不执行运行时表达式

下面这些都不会被执行：

```html
{{ getMessage() }}
:title="computeTitle()"
<%= buildTitle() %>
```

原因包括：

- 构建时执行任意业务代码不安全；
- 运行结果依赖状态；
- 结果不稳定；
- 可能有副作用；
- 不同模板引擎语义不同。

收集器只提取能够从源码静态确定的片段。

#### 12.5 属性使用白名单而不是黑名单

黑名单需要提前知道所有“不应该收集”的属性，几乎不可维护。

白名单则明确表达：

```text
这些属性具有稳定的用户展示语义
```

项目仍然可以通过 `attributeAllowlist` 自定义扩展。

#### 12.6 收集与替换分离

收集范围可以大于自动替换范围：

```text
收集：发现项目中的所有潜在源语言残留
替换：只处理具有明确运行时语义的来源
```

因此独立 HTML、CSS 仍值得收集，因为它们可以用于：

- 完整性检查；
- catalog 统计；
- 人工迁移；
- 构建期多语言生成；
- 防止项目仍残留中文。

但工具不会凭空替项目选择具体输出策略。

---

### 十三、完整示例

输入：

```html
<template>
  <!-- i18n-key: page.form -->
  <section title="表单区域" v-if="visible">
    <input
      placeholder="请输入姓名"
      :aria-label="`编辑${name}的信息`"
      @click="notify('点击输入框')"
    >

    <p>你好，{{ user.name }}</p>
    <p>{{ '保存成功' }}</p>
    <p>{{ $t('items.count', { count }) }}</p>
  </section>
</template>
```

处理过程：

```text
Vue compiler
  │
  ├─ 理解 v-if、:aria-label、@click 和插值
  ├─ 建立 template AST
  └─ 转为 Template IR
         │
         ├─ attribute: title="表单区域"
         ├─ attribute: v-if="visible"
         ├─ attribute: placeholder="请输入姓名"
         ├─ attribute: :aria-label="`编辑${name}的信息`"
         ├─ attribute: @click="notify('点击输入框')"
         ├─ text: "你好，"
         ├─ expression: user.name
         ├─ expression: '保存成功'
         └─ expression: $t('items.count', { count })
                 │
                 ▼
extractHtml()
  │
  ├─ title → 白名单，收集
  ├─ v-if → 非展示属性，跳过
  ├─ placeholder → 白名单，收集
  ├─ :aria-label → 白名单动态绑定，Babel 分析
  ├─ @click → 非展示属性，不分析
  ├─ text → 收集
  ├─ user.name → 无静态中文
  ├─ '保存成功' → 收集
  └─ $t(...) → 记录 localized-call
```

最终大致得到：

```js
[
  {
    value: '表单区域',
    key: 'page.form',
    locations: [{ kind: 'html-attribute' }]
  },
  {
    value: '请输入姓名',
    locations: [{ kind: 'html-attribute' }]
  },
  {
    value: '编辑',
    locations: [{ kind: 'html-attribute' }]
  },
  {
    value: '的信息',
    locations: [{ kind: 'html-attribute' }]
  },
  {
    value: '你好，',
    locations: [{ kind: 'html-text' }]
  },
  {
    value: '保存成功',
    locations: [{ kind: 'template-expression' }]
  },
  {
    value: '',
    key: 'items.count',
    representation: 'localized-call',
    paramsKind: 'static',
    paramNames: ['count'],
    locations: [{ kind: 'template-expression' }]
  }
]
```

不会收集：

```text
visible
user.name
点击输入框
```

其中：

- `visible` 是控制流；
- `user.name` 是运行时变量，没有静态中文；
- `点击输入框` 位于 `@click` 事件表达式中，该属性不属于允许分析的展示属性。

---

### 十四、边界和实现细节

#### 14.1 非 HTML template 不收集

例如：

```html
<template lang="pug">
```

当前不会调用 Pug 预处理器，而是返回空 Template IR。

这是明确的能力边界，不是解析失败。

#### 14.2 不分析 render 函数

即使 Vue 最终会将 template 编译为 render 函数，收集输入仍然是原始 template。

因为 render 函数会丢失或改变：

- 原始 DOM 结构；
- 原始注释；
- 原始属性写法；
- HTML entity 拼写；
- 可靠的源码位置；
- 文案所属模板构造。

#### 14.3 HTML warning 当前在 Loader 分派处被丢弃

`extractHtml()` 会返回：

```js
{
  entries,
  warnings: template.warnings
}
```

但是当前 `collectedFor()` 对 HTML/template 分支重新包装为：

```js
{
  entries: extractHtml(...).entries,
  warnings: []
}
```

因此 parse5/Vue adapter 产生的非致命 warning，在直接调用 `extractHtml()` 时可见，但经过当前 Loader 主链时不会发布。CSS 分支则会保留 extractor 返回的 warnings。

如果设计目标是让 template warning 进入 webpack compilation，这里应该直接返回完整的 `extractHtml()` 结果。就现有代码而言，必须把“Template IR 支持 warnings”和“Loader 当前会发布这些 warnings”区分开。

---

### 十五、最终总结

这套 HTML 中文收集机制不是“用一个正则扫描 HTML”，而是：

> 使用项目对应的 HTML/Vue 解析器准确理解模板语法，将不同 AST 统一成带原始位置映射的 Template IR，再由 `extractHtml()` 统一应用中文判断、属性白名单、Babel 表达式分析、本地化调用识别、上下文过滤和注释指令，最后输出跨语言共享的收集条目 IR。

核心职责可以压缩为：

```text
parse5 / Vue compiler
    负责“源码是什么结构”

Template IR
    负责“屏蔽解析器差异并保留源码位置”

extractHtml
    负责“哪些结构属于应收集文案”

CollectedEntry
    负责“向 catalog、校验和替换流程提供稳定输入”
```
