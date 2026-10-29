# 文案收集架构设计

## 1. 状态与目标

本文记录经过设计访谈确认的目标架构和分阶段实施方案。Phase 1 到 Phase 4 已经落地，本文继续作为设计记录，并按当前代码补上收集侧后来增加的行为：排除指令、显式本地化键、键控源语言目录，以及这一组正式产物的事务写入。接入方式、配置、支持范围和故障说明见仓库 README 与 `docs/collection.md`。`translate`、`replace`、`run` 的命令约定、翻译提供方和源码替换仍以 README 与 `CONTEXT.md` 为准。本文只记录收集架构：Loader 如何识别文案，Plugin 如何提交一轮收集并发布产物。

本次设计的主要目标是：

1. 由一个 webpack loader 负责所有业务源码中的文案识别与收集。
2. webpack plugin 不再读取或解析业务源码，只负责 collection session、结果汇总和输出。
3. 增加 Vue template、独立 HTML、Vue style 和独立 CSS 中的中文文案收集。
4. 保持现有接入方式、运行时字典和 source map 外层结构兼容。
5. 修复资源覆盖、过期条目、配置规则不一致和失败时发布部分结果等生命周期问题。
6. 保持设计适合当前项目规模，不引入 parser registry、通用编译器框架或多构建工具抽象。

本文使用根目录 `CONTEXT.md` 中定义的领域词汇。

---

## 2. 已确认的设计原则

### 2.1 单一收集入口

公共入口仍是 `i18n-collect/myloader`。同一个 loader 根据资源扩展名和 Vue resource query 分派到 script、HTML 或 CSS extractor。

只有实际进入该 loader 链的资源才会进入 Collection result。Plugin 不通过目录扫描补收集遗漏的资源；缺少 loader 配置应明确失败，而不是静默回退。

### 2.2 Plugin 仅管理生命周期、汇总与输出

公共入口仍是 `i18n-collect/myplugin`。Plugin 可以：

- 为每个 webpack compiler 管理独立 collection session；
- 开始、提交或放弃一次 collection round；
- 从当前 webpack module graph 中恢复 Loader 提交的 Resource snapshot；
- 保留增量编译中仍有效的缓存 snapshot；
- 淘汰已经删除或不再参与构建的资源；
- 聚合、去重，并在同一事务中输出哈希词典、source map、源语言翻译目录和目录元数据。

Plugin 不可以：

- 遍历 `src` 或其他业务目录；
- 读取业务源码；
- 解析 JavaScript、Vue、HTML 或 CSS；
- 调用 extractor；
- 以磁盘扫描补偿 loader 配置缺失。

### 2.3 运行时集成范围

本期只交付 webpack 5 和当前 Vue 2 工程的集成。Extractor 保持为不依赖 webpack 的纯模块，以便独立测试和未来复用；本期不实现 Vite、Rollup 等适配器。

webpack 4 不再属于受支持范围，package 的 peer dependency 应相应收缩。

### 2.4 兼容性

以下接口和输出保持兼容：

- `require('i18n-collect/myloader')`；
- `require('i18n-collect/myplugin')`；
- 运行时字典 `{ "<md5>": "<value>" }`，key 仍是文案的 MD5，不是本地化键；
- source map 的 `version: 1` 外层结构，条目仍是 `key`（MD5）、`value` 和 `locations`，不写入本地化键；
- 已有 Semantic kind 名称；
- 已有 JavaScript 文案和范围行为；
- 稳定排序及相同字节不重写输出。

在此之上，成功的一轮还会写出键控源语言目录。目录的 key 是本地化键。哈希收集产物和翻译目录并存：已有哈希消费方继续读词典，翻译和源码替换读目录。新 HTML/CSS 支持只增加已有种类的新位置，不借机重新定义已有 JavaScript 数据。

---

## 3. 最终职责边界

## 3.1 Loader

Loader 负责：

1. 识别资源路径、扩展名及 Vue block query。
2. 规范化 Resource identity。
3. 应用 `include` 和 `exclude`。
4. 调用对应的纯 extractor。Extractor 在识别文案的同时解释 `no-i18n-auto` 和 `i18n-key`，并按 `contextFilters` 丢掉被选中的 script 候选。
5. 为一个资源生成完整 Resource snapshot，包括空 snapshot。条目可以带上显式本地化键；没有显式键的条目只保留文案和位置，派生键留到汇总阶段计算。
6. 将 snapshot 写入当前 webpack module 的构建元数据。
7. 向当前 compilation session 报告此次处理。被排除或零结果的资源仍算一次 invocation。
8. 原样传递 `source`、`sourceMap` 和 `meta`。收集发生在 pitch，不改写模块内容。

Loader 不负责：

- 聚合所有资源；
- 写输出文件；
- 判断整个 compilation 是否成功；
- 扫描项目目录；
- 主动处理没有进入 loader 链的资源。

## 3.2 Plugin

Plugin 负责：

1. 为每个 webpack root compiler 建立独立 session。
2. 管理 collection round 的开始、成功提交和失败放弃。
3. 从当前 module graph 中取得 Loader 创建的 snapshots。
4. 保留当前构建仍然有效的缓存 snapshots。
5. 淘汰已删除、已取消引用或不再经过 Loader 的资源。
6. 在 compilation 成功后聚合快照，建成键控源语言目录，并和哈希词典、source map 一起写出。
7. 本地化键冲突时放弃本轮，保留上一次正式输出。
8. compilation 失败或写出失败时保留上一次正式输出；写出失败还会把已经替换的文件按 journal 恢复。
9. 检测 Loader 完全没有接入的配置错误。

---

## 4. 目标模块结构

保持两个公共入口不变，内部只拆出必要的职责：

```text
packages/i18n-collect/
├── bin/i18n-collect.js            # 命令入口；命令语义见 README
├── cli/                           # collect 复用下面的 Loader；translate / replace / run 不参与 webpack 轮次
├── myloader/
│   ├── index.js                   # webpack Loader adapter，并按 block 分派 extractor
│   ├── resource.js                # 类型、query、identity、过滤和坐标
│   ├── context-filter.js          # 可选的 logging / tests / analytics 策略
│   ├── directives.js              # no-i18n-auto 与 i18n-key 的扫描和关联
│   ├── extract-script.js          # JavaScript/TypeScript/表达式
│   ├── extract-vue-compat.js      # 从 Vue 文件中对齐 script block 后再交给 script extractor
│   ├── extract-html.js            # HTML 和 Vue template
│   └── extract-css.js             # 标准 CSS
├── myplugin/
│   └── index.js                   # compilation 生命周期、目录汇总与输出
└── mycommon/
    ├── scope-pattern.js           # 目录边界与 glob 范围
    ├── session.js                 # 候选 round、提交、放弃、回滚和淘汰
    ├── store.js                   # 哈希词典聚合、去重和稳定排序
    ├── catalog.js                 # 本地化键、冲突、指纹和目录差异
    ├── catalog-format.js          # 目录格式适配器，目前只有 json
    ├── config.js                  # 配置加载、校验和字段归属
    └── output.js                  # 相同内容跳过，以及带 journal 的成组写入
```

不建立通用 parser registry 或插件系统。三个 extractor 共享最小 entry 数据结构，但不相互依赖。分派写在 `myloader/index.js` 的 `collectedFor`，没有单独的 `extract.js`。`mycommon/translate.js` 和 `mycommon/replace-preview.js` 只服务 README 中的翻译和替换命令，不进入收集轮次。

### 4.1 Extractor 接口

Loader 先把 webpack 请求收成规范化的 `resource`，再调用纯函数。`resource` 不是 webpack 对象：

```js
{
  absolutePath,
  projectPath,
  query,
  block,
  styleIndex,
  lang,
  sourceOffset,
  identity
}
```

Script 与 Vue script 返回条目数组。HTML 与 CSS 返回 `{ entries, warnings }`。一条条目是：

```js
{ value, locations, key? }
```

`key` 只在该片段前面有格式正确的 `i18n-key` 时出现。`locations` 使用下面第 15 节的坐标。不含汉字的片段、被排除指令去掉的片段，以及被选中的 context filter 去掉的片段，都不会进入 `entries`。

Loader 再把结果包成 snapshot：

```js
{
  identity,
  projectPath,
  owner: { block, styleIndex, lang },
  entries
}
```

Extractor 不访问 webpack hook、不写输出、不修改 session，也不保存全局状态。Vue script、Vue template 和 Vue style 会读取当前正在处理的这一个 `.vue` 文件，只为了对齐原始 block；这是第 10 节的例外，不是目录扫描。普通 script 使用 Loader 已经拿到的源码字节。

---

## 5. Resource identity

Resource identity 只包含影响收集语义的字段，不直接使用完整 raw query。Vue query 中的 `id`、`scoped`、`prod` 等字段不能造成新的收集身份。

规范示例：

```text
src/utils/message.js::script
public/index.html::html
src/base.css::style[index=0;lang=css]
src/App.vue::script[lang=js]
src/App.vue::template[lang=html]
src/App.vue::style[index=0;lang=css]
src/App.vue::style[index=1;lang=scss]
```

规则：

- 路径相对项目根目录，分隔符统一为 `/`。
- Vue script、template 和每个 style block 分开保存。
- Vue style identity 必须包含 `index` 和规范化后的 `lang`。
- 未显式声明语言时分别规范化为 `js`、`html` 和 `css`。
- 忽略不改变 extractor 行为的 query 字段。
- 每次 Loader 调用提交该 identity 的完整替换 snapshot，而不是增量追加。
- 零条结果也必须提交空 snapshot，从而删除该资源以前存在的条目。显式本地化键不是 identity 的一部分；它挂在条目上，汇总时才变成目录的 key。
- 外部 `<script src>`、`<template src>` 或 `<style src>` 以实际提供源码字节的资源路径为位置来源。

---

## 6. Collection session 与事务发布

## 6.1 Session 作用域

删除当前按项目根目录保存的进程级全局 Store。新 session 使用 webpack root compiler 作为生命周期边界：

```text
WeakMap<webpack root compiler, CollectionSession>
```

这样可以隔离：

- 同一项目中的多个 compiler；
- 并行构建；
- 测试实例；
- main compiler 与 child compiler；
- 已经可以被垃圾回收的构建实例。

HTMLWebpackPlugin 的 child compiler 必须归一到对应 root compiler 和 main compilation。

## 6.2 Snapshot 元数据

Loader 将普通、可序列化的信封写入 module metadata：

```js
module.buildInfo.i18nCollect = {
  schemaVersion: 1,
  root,            // 规范化后的项目根
  fileConfigHash,  // 配置文件里收集字段的哈希，不含目录和翻译字段
  invoked: true,
  included,        // include/exclude 之后是否进入收集
  snapshot         // included 时为完整 snapshot，否则为 null
}
```

这是支持以下行为所必需的：

- webpack 增量构建可能不重新运行未变化模块的 Loader；
- webpack filesystem cache 可能直接恢复 module；
- HTMLWebpackPlugin 可能复用缓存的 child compilation。

这不构成第二个收集来源：Loader 是 snapshot 的唯一创建者，Plugin 只恢复和汇总 Loader 已创建的数据。

## 6.3 Collection round

```text
main compilation 开始
        ↓
建立候选 round
        ↓
myloader pitch 在主进程读取原始文件
        ↓
extractor 生成完整 snapshot
        ↓
信封写入 module.buildInfo.i18nCollect
        ↓
Plugin 从 main module graph 与 child compilation 重建 snapshots
        ↓
检查 compilation 是否有效
       / \
    失败   成功
     ↓      ↓
 放弃候选  合并 live、缓存 HTML 与本轮提交
             ↓
       由快照构建键控目录
             ↓
       有键冲突？ —— 放弃候选并失败，不写文件
             ↓
       session.release：先提交内存，再成组写出
             ↓
       写出失败则回滚内存并放弃本轮
```

Session 最少需要表达以下操作：

```js
session.begin(compilation)
session.submit(compilation, module, snapshot)
session.noteInvocation(compilation)
session.warn(compilation, warning)
session.commit(compilation, liveSnapshots, configHash)
session.release(compilation, liveSnapshots, configHash, write)
session.abandon(compilation)
```

`release` 先做一次内存 checkpoint，再 `commit`，然后调用 `write`。`write` 抛错时用 checkpoint 回滚内存里的 committed snapshots，并放弃本轮。键冲突发生在 `release` 之前，因此不会留下半份目录。

内部维护：

- 上一次成功构建的 committed snapshots，以及由它们生成的哈希词典和 source map；
- 以 Compilation 为键的 candidate round；
- 本轮 Loader invocation 证据，包括被排除、空快照和不支持的样式；
- 本轮 warnings 的去重状态，键是 `code + identity`；
- 最近一次成功的 `configHash`。本地化键和目录正文不进这枚哈希。

## 6.4 当前资源与过期淘汰

Plugin 以 `compilation.modules` 作为当前 module graph，而不是要求模块最终进入 chunk。语义收集不应因 tree-shaking 而消失。

提交成功 round 时：

- 当前 module metadata 中的 snapshot 保留；
- 本轮重跑资源由新 snapshot 替换；
- 已删除文件对应 snapshot 移除；
- 退出 module graph 的资源移除；
- 被删除的 Vue block 只移除对应 identity；
- style index 或 lang 变化后淘汰旧 identity；
- compilation 失败时不改变 committed state。

不得永久保留历史资源，也不得每轮清空所有 snapshot 后要求所有 Loader 重跑。

---

## 7. Loader 未接入的诊断

“没有 Loader 调用”和“Loader 处理过资源但没有中文”是两种不同状态。

以下任一证据存在时，说明 Loader 已接入：

1. 本轮有真实 Loader invocation；
2. 当前 module graph 中存在由 webpack cache 恢复的有效 `i18nCollect` metadata。

两者都不存在时，Plugin 应使构建失败，并提示检查：

- 普通 module rules；
- Vue script/template/style block rules；
- HTMLWebpackPlugin 的显式模板 Loader chain。

Loader 若发现自己跑在 `thread-loader` 的 worker 里，直接失败，提示把它放在 `thread-loader` 之前。pitch 必须留在主进程，才能读到原始文件并写入主 compilation 的 metadata。`i18n-collect collect` 把这条错误，以及“Loader 未接入”、畸形 `i18n-key` 和键冲突，都归为收集失败（退出码 2）。其他构建错误是退出码 3。

以下情况仍属于有效 Loader invocation：

- 提取结果为零；
- 资源被 include/exclude 排除；
- 样式语言当前不受支持，并已产生 warning。

---

## 8. Loader 的透明传递契约

Loader 除收集 metadata 和报告诊断外，不改变模块内容：

```js
this.callback(null, source, sourceMap, meta)
```

收集本身发生在 `pitch`。pitch 用 `fs.readFileSync(resourcePath)` 读取磁盘上的原始字节，跑完 extractor 后把 `data.collected` 设为 true。随后的普通 Loader 调用发现这个标记就不再收集，只补登记配置文件依赖，然后原样回调。pitch 没有跑过时，普通调用才用自己收到的 `source` 收集；Vue 的 script、template 和 style 即使在这条路径上，也会再读当前 `.vue` 文件来对齐 block。

要求：

- string 或 Buffer 的源码内容保持不变；
- 传入 source map 原样传给后续 Loader；
- `meta` 原样传递；
- pitch 应最先看到当前语义资源的原始内容，并且必须在主进程执行；
- demo 中必须用测试验证最终 Loader 顺序，不能只依赖 `.before()`、`.after()` 的注释理解。

现有 JS rule 的注释与 webpack Loader 从右向左执行的实际顺序可能相反，实施时必须通过最终 webpack config 和集成测试确认。

---

## 9. HTMLWebpackPlugin 集成

`public/index.html` 必须真正进入 `myloader`，但 Plugin 不能读取该文件。

Vue CLI 当前依赖 HTMLWebpackPlugin 的模板 Loader 处理：

```html
<%= BASE_URL %>
<%= htmlWebpackPlugin.options.title %>
```

因此不能只添加普通 `.html` rule。应显式配置以下模板请求：

```text
html-webpack-plugin/lib/loader.js?force=true
  ! i18n-collect/myloader
  ! public/index.html
```

Loader 从右向左执行：

1. `myloader` 读取原始 HTML、收集文案并原样返回。
2. HTMLWebpackPlugin Loader 编译 EJS 风格模板。
3. HTMLWebpackPlugin 注入资源并生成页面。

`force=true` 是必要条件；否则 HTMLWebpackPlugin 的 Loader 在发现其他 Loader 时可能直接透传原始 HTML。

验收条件：

- `<%= BASE_URL %>` 正常展开；
- 页面标题正常生成；
- 不泄漏 EJS 标记；
- JS/CSS 资源正常注入；
- 在相同输入和资源文件名下，生成 HTML 内容保持不变；
- 新增文案只改变收集输出；
- Plugin 不读取 HTML 源码。

## 9.1 Child compiler 与缓存

HTMLWebpackPlugin 在 child compiler 中编译模板，并可能复用缓存结果。缓存命中时，该次 main compilation 中 HTML Loader 不一定重新运行。

因此不能采用“本轮没有提交就立即淘汰”的规则。此前的 HTML snapshot 仅在以下条件都成立时保留：

- 仍是 main compilation 的文件依赖；
- HTMLWebpackPlugin 仍配置了该模板；
- 文件没有出现在删除集合中；
- 没有新的 child snapshot 替换它。

模板移除、替换或不再作为依赖时，旧 snapshot 必须淘汰。

新的 compiler 实例不继承上一实例的 session。文件系统缓存恢复 child compilation、且 Loader 不再执行时，Plugin 必须从该 child compilation 的 module metadata 读回 snapshot。只查看 main `compilation.modules` 会在跨 compiler 恢复时丢掉独立 HTML。metadata 中的 root 或配置哈希与当前 compiler 不一致时，该 snapshot 不进入 session，并且本轮失败，避免把别的构建的结果发布出来。

---

## 10. Vue block 与原始源码位置

Vue script、template 和 style block 使用独立 Resource identity，并以 Loader 收到的语义 block 作为收集触发点。

但 vue-loader 可能：

- 对 template 去缩进；
- 对 script/style 进行行填充；
- 不提供足以恢复 template 原始列的映射。

因此，“只看变换后的 block 输入”与“范围精确指向原始 `.vue` 文件”无法同时保证。

采用以下最小例外：

> `myloader` 可以读取当前正在处理的 `resourcePath` 自身，仅用于定位对应 Vue block 的原始字节和恢复 source range；它不能扫描目录，也不能读取其他业务资源。

该例外仍满足核心边界：

- 文案识别和收集只发生在 Loader；
- Plugin 不读取源码；
- 只有进入 Loader 链的资源才收集；
- 每个 block 仍提交独立 snapshot；
- 不恢复旧 Plugin 的全项目扫描。

如果未来可以从 vue-loader 获得稳定的原始 offset metadata，应优先使用 metadata，而不是再次读取当前 resource。

---

## 11. 中文识别

当前 `U+4E00–U+9FA5` 的窄范围改为 Unicode Han Script：

```js
/\p{Script=Han}/u
```

该正则只用于判断片段是否符合收集条件。只要静态片段包含至少一个 Han 字符，就保留整个解码后的片段，包括：

- 标点；
- 数字；
- 空格；
- 拉丁字符；
- 其他 Unicode 字符。

纯标点、纯空白、纯英文和不含 Han 字符的片段不触发收集。

---

## 12. Script 提取语义

保留现有 Babel 语义：

- 普通字符串：`script-string`；
- 模板字面量的每个静态 segment：`template-literal`；
- Vue 插值表达式中的静态字符串或模板 segment：`template-expression`；
- import/export 模块路径忽略；
- 不执行表达式；
- 不做变量求值或常量折叠；
- 保持已有 JavaScript range 行为。

Vue 插值中的表达式由 HTML extractor 定位，再交给共享的 script fragment collector 解析；它不重新定义为 HTML text。

## 12.1 排除指令与本地化键

`directives.js` 是 script、HTML 和 CSS 共用的关联规则，不是可扩展的 directive framework。一条注释先去掉首尾空白再判断：

- 文本恰好是 `no-i18n-auto` 时，它是排除指令。比较区分大小写。
- 文本匹配 `i18n-key: <key>`，并且键以字母开头、由点分隔的段组成、每段只含字母、数字、`_` 和 `-` 时，它是键指令。`home.title` 和 `order.list-empty` 合格。以 `i18n-key` 开头但形状不对的注释，在扫描时就失败，错误锚在注释起点。
- 其他注释既不排除，也不收集。

关联只向前。一组指令是写在构造前面、彼此之间以及它们和构造之间只有空白的那些指令注释。中间出现普通注释或代码，这一组就结束。同一组里可以同时有排除和键。两条不同的键指向同一片段时失败。排除生效时，同组的键不产生目录条目。

Script 把字符串字面量或模板字面量当作构造。模板字面量只把这一组指令用在第一段含有汉字的静态片段上，后面的片段不再继承。HTML 把元素或紧挨着的文本节点当作构造，按源码顺序只作用在该构造最早的一处已收集片段上：白名单属性早于文本，插值里的前一个片段早于后一个。CSS 把前一个节点是该注释的 `content` 声明，或紧挨在注释后的那个字符串，当作构造。写在规则前面的注释不会进入规则内部。

没有显式键的位置，在 `catalog.js` 里得到派生键。派生键由去掉扩展名的项目相对路径做成点分 slug（其他字符换成 `_`，不以字母开头时加 `k`），再加 8 位十六进制。这 8 位是 SHA-256（路径、`\0`、semantic kind、`\0`、文案）的前 8 个字符。行号和列号不参与，所以同一文件里同一文案、同一种类移动后仍是同一键。

一个键可以对应多处位置，只要源文案相同。一个键对应两段不同源文案就是键冲突，包括显式键撞上另一段文案的派生键。冲突在 Plugin 汇总之后、写文件之前失败。错误列出每个键、每段文案、它的 `explicit` 或 `derived` 来源，以及每处 `path:line:column (kind)`。

---

## 13. HTML 提取语义

HTML 使用 `parse5`，并将其声明为 package 的直接依赖。

- 独立 HTML 使用 document 模式。
- Vue template block 使用 fragment 模式。
- EJS 风格占位符不会被执行或改写。

## 13.1 HTML 文本节点

对于：

```html
<p>
  欢迎使用
  <strong>文案工具</strong>
</p>
```

分别收集 `欢迎使用` 和 `文案工具`。

规则：

- 每个 text node 独立处理；
- 不跨标签合并；
- 全空白节点忽略；
- 格式排版产生的首尾换行与缩进移除；
- 文本节点内部有意义的空格和换行保留；
- 没有换行的行内边缘空格默认保留，避免把相邻行内元素的语义间隔删除。

“格式空白”实现必须由带有行内和块级场景的 fixture 固化，不能简单对所有值调用 `trim()`。

## 13.2 HTML entity

对于：

```html
<p>保存&nbsp;成功</p>
<button title="保存&#x540E;关闭">关闭</button>
```

收集值使用解码后的字符：

- `保存 成功`；
- `保存后关闭`。

Source range 仍指向原始源码拼写，例如 `保存&nbsp;成功`。哈希基于用户最终看到的解码值，而不是 entity 的拼写。

## 13.3 HTML 属性

只处理 `attributeAllowlist` 中的属性。

静态属性：

```html
<input placeholder="请输入姓名">
```

收集完整解码值 `请输入姓名`。

动态 Vue binding：

```vue
<input :placeholder="'请输入' + fieldName">
<input :title="`查看${name}的资料`">
```

收集：

- `请输入`；
- `查看`；
- `的资料`。

规则：

- 支持普通属性、`:name` 和 `v-bind:name`；
- 先规范化为底层属性名，再应用 allowlist；
- 表达式交给 Babel 解析但绝不执行；
- 每个静态 string 或 template segment 独立收集；
- 非 allowlist 属性不收集；
- 事件、普通 directive 和内部数据属性不收集；
- 新属性范围只覆盖实际 fragment 内容，不包含属性名、`=`、HTML 引号或内部 JavaScript 字符串定界符。

## 13.4 Semantic kind

| 来源 | Semantic kind |
| --- | --- |
| Vue template 文本 | `html-text` |
| Vue template 属性 | `html-attribute` |
| Vue 插值表达式 | `template-expression` |
| 独立 HTML 文本 | `static-html-text` |
| 独立 HTML 属性 | `static-html-attribute` |

动态 HTML 属性中的静态片段仍是 `html-attribute`。HTML 注释里的排除指令和键指令使用第 12.1 节的同一组规则。插值和动态属性内部的 JavaScript 注释则按 script 规则处理那段表达式，并同样接受 `contextFilters`。

## 13.5 HTML 解析错误

`parse5` 会恢复部分错误，且 Vue 合法语法可能产生非标准 HTML 诊断。因此不能把每个 `onParseError` 都视为 fatal。

实现时应：

- 明确一组经过 fixture 验证的 Vue 兼容恢复诊断；
- 仅忽略这组已知诊断；
- 其他会使位置或节点语义不可信的诊断导致 Collection failure；
- Vue 动态属性或插值中的 Babel 表达式错误始终失败；
- 错误包含路径、block 和原始位置。

---

## 14. CSS 提取语义

CSS 使用 `postcss`，并将其声明为 package 的直接依赖。

第一版只正式支持：

- 独立 `.css`；
- 未声明 `lang` 或声明 `lang=css` 的 Vue `<style>`。

## 14.1 `content` 静态片段

对于：

```css
.a::before { content: "必填"; }
.b::after  { content: "第" counter(item) "项"; }
.c         { content: var(--label, "默认标签"); }
.d         { content: attr(data-label); }
.e         { --label: "内部文案"; }
.f         { color: red; /* 中文注释 */ }
```

收集：

- `必填`；
- `第`；
- `项`；
- `默认标签`。

忽略：

- `attr()`、`counter()` 和变量引用本身；
- custom property 定义；
- 非 `content` 声明；
- 选择器；
- 注释。

不限制 `content` 必须位于伪元素上；只要声明本身符合规则，就处理其中的静态字符串。`content` 声明和声明值内部的字符串都可以按第 12.1 节挂上排除指令或键指令。CSS 不应用 `contextFilters`。

## 14.2 空值和特殊值

以下内容不收集：

```css
content: "";
content: "   ";
content: none;
content: normal;
```

`content: "（新）"` 收集完整值 `（新）`，因为它包含 Han 字符“新”。

## 14.3 CSS escape 和范围

CSS string 先按 CSS 规则解码；解码值用于：

- Han 判断；
- MD5；
- runtime dictionary。

Source range 指向原始源码中的字符串内容，包括 escape 的原始拼写，但不包含单引号或双引号。

## 14.4 样式预处理器

第一版不解析 `.scss`、`.sass`、`.less` 或 `.styl`。

对于 Vue `style` 的非 CSS `lang` 或配置中显式出现但尚无 parser 的扩展：

- 每个 Resource identity 每轮最多产生一个清晰 warning；
- 提交空 snapshot；
- 不用标准 CSS parser 尝试解析；
- 不使构建失败。

`styleExtensions` 的默认值收缩为 `['.css']`。未来每增加一种方言，都应增加明确 parser 和对应测试，而不是依靠偶然兼容。

---

## 15. Source location 约定

统一采用：

- 行号：1-based；
- 列号：0-based；
- 列单位：UTF-16 code unit；
- 范围：half-open，end exclusive；
- 路径：项目相对路径，使用 `/`。

新 HTML attribute 和 CSS string 的范围：

- 只覆盖收集 fragment 的原始内容；
- 不包含属性名、等号或语法定界符；
- 不包含 HTML/CSS 字符串引号。

旧 JavaScript range 行为保持不变，以避免改变现有 source map 数据。

偏移转行列的公共工具应基于 JavaScript string index；该 index 本身按 UTF-16 code unit 计数。测试必须覆盖：

- CRLF；
- fragment 之前存在 astral character；
- entity 和 escape 导致解码值与原始拼写长度不同；
- 多行 fragment。

---

## 16. 配置迁移

仍使用一个 `i18n-collect.config.js`，不拆成 Loader 和 Plugin 两个文件。

目标默认值：

```js
{
  styleExtensions: ['.css'],
  include: [],
  exclude: [],
  contextFilters: [],
  attributeAllowlist: [
    'title',
    'placeholder',
    'alt',
    'aria-label',
    'value'
  ],
  outputPath: 'lang/zh_hash.json',
  sourceMapFilename: 'lang/zh_hash.map.json',
  catalogDir: 'lang/catalog',
  sourceLocale: 'zh',
  catalogFormat: 'json',
  translationProvider: '',
  targetLocales: [],
  translationFailure: 'partial'
}
```

修改：

- 删除 `htmlEntries`；
- Loader 使用 `include`、`exclude`、`contextFilters`、`attributeAllowlist`、`styleExtensions`；
- Plugin 使用 `outputPath`、`sourceMapFilename`、`catalogDir`、`sourceLocale`、`catalogFormat`；
- `translationProvider`、`targetLocales`、`translationFailure` 只属于配置文件和 `translate` 命令。它们不是 Loader 选项，也不是 Plugin 选项；
- 显式 options 只能覆盖调用方拥有的字段；
- 未知字段和跨职责字段继续报错；
- `configHash` 和 metadata 上的 `fileConfigHash` 都只覆盖收集字段。计算前会去掉 `catalogDir`、`sourceLocale`、`catalogFormat` 和三个翻译字段，因此只改目录位置或翻译设置不会让 source map 的哈希变化，也不会因为哈希不符而丢弃缓存 snapshot；
- `fileConfigHash` 取配置文件规范化之后、Loader/Plugin 显式选项和 CLI scope override 之前的值。`configHash` 再纳入 Loader 选项、Plugin 的输出路径选项，以及 `collect --include`、`--exclude`、`--context-filter` 对这一次运行的替换；
- 配置文件存在时，Loader 应将其登记为 webpack dependency，以便 watch 正确失效。不存在时登记为 missing dependency。

源语言目录写到 `<catalogDir>/<sourceLocale>.json`，元数据写到 `<catalogDir>/catalog.meta.json`。`sourceLocale` 是 `zh` 或 `zh-CN` 这种语言标签。`catalogFormat` 目前只能是 `json`。适配器提供 `name`、`extension`、`serialize(messages)` 和 `parse(text)`；相同的 messages 必须得到相同的文本，key 按字母序写出。目录文件不得与 `outputPath` 或 `sourceMapFilename` 重合。`collect` 命令可以替换 include、exclude 和 contextFilters，不能替换目录字段。

独立 HTML 不再由配置项声明输入；它必须通过 webpack 配置显式进入 Loader 链。

## 16.1 Include/exclude

`include` 和 `exclude` 接受项目相对的文件或目录边界，也接受 glob。不含 `*`、`?`、`[`、`{` 的模式仍是边界：`src/foo` 匹配 `src/foo` 与 `src/foo/bar.js`，不匹配 `src/foobar.js`。含这些字符的模式是 glob。`*` 与 `?` 不跨越路径段；`**` 必须独占一个路径段，并匹配零个或多个路径段；`[abc]`、`[a-z]`、`[!abc]`、`[^abc]` 匹配该段中的一个字符。

规则：

1. 路径分隔符规范化为 `/`。反斜杠是分隔符，不是转义。
2. 匹配时忽略 resource query。
3. `include` 为空则默认允许，否则必须至少命中一个模式。
4. `exclude` 在 include 之后应用，并拥有最终否决权；边界与 glob 重叠时同样由 exclude 否决。
5. 拒绝绝对路径、越过根目录的 `..`、空或项目根目录本身，以及规范化后的重复项。
6. glob 另外拒绝：以 `/` 结尾、花括号展开、`**` 与其他字符写在同一段、glob 段之后的 `..`、未闭合、空或多余的字符类。glob 段之前的 `..` 会先做词法折叠，且必须留在项目内。
7. Plugin 不再次应用过滤规则。

`contextFilters` 默认是 `[]`。可选值只有 `logging`、`tests`、`analytics`，可以单独选择。未选择时，收集不会按启发式丢掉文案。选择之后，只去掉该策略所描述的 script 候选，以及 Vue 插值和动态属性里的同类表达式；HTML 文本和 CSS 生成内容不在这些策略里。未知名称和重复项是配置错误。该字段属于 Loader。

判定都看静态调用形状，不执行代码。计算属性、可选调用和标签模板都不是下面这些调用，里面的文案保留。

- `logging` 去掉最近一层调用是下列名称、并且字面量位于该调用参数里的候选：`console.log`、`console.info`、`console.warn`、`console.error`、`console.debug`、`console.trace`、`log`、`logger.log`、`logger.info`、`logger.warn`、`logger.error`、`logger.debug`、`logger.trace`。`console.log(format("界面"))` 保留 `界面`，因为最近一层调用是 `format`。
- `tests` 去掉词法上位于 `describe`、`it`、`test`、`beforeEach`、`afterEach`、`beforeAll`、`afterAll`、`expect`，以及 `describe`、`it`、`test` 的 `.only`、`.skip`、`.each`、`.todo` 之内的候选。同一文件里这些调用之外的字符串保留。这个过滤器不按文件名排除测试；排除整个测试目录要用 `exclude` glob。
- `analytics` 去掉最近一层调用是 `gtag`、`track`、`analytics.track`、`analytics.page`、`analytics.identify`、`analytics.screen` 或 `dataLayer.push`，并且字面量位于该调用参数里的候选，包括对象参数上的字符串属性。

---

## 17. 依赖和 package 边界

Package 应：

- 将 webpack peer dependency 收缩到 webpack 5；
- 直接依赖 `parse5`；
- 直接依赖 `postcss`；
- 保留 Babel parser/traverse；
- 在不再使用时删除 `loader-utils`，改用 webpack 5 的 `this.getOptions()`；
- 更新 lockfile。

不得依赖 demo 或其他 package 偶然提供的传递依赖。

---

## 18. 错误、warning 与正式输出

## 18.1 Collection failure

以下情况使当前 round 失败：

- Babel 解析错误；
- 标准 CSS 解析错误；
- Vue binding 或 interpolation 表达式解析错误；
- 被判定为 fatal 的 HTML 诊断；
- 畸形 `i18n-key`，或同一片段上两条不同的键指令；
- 汇总后一个本地化键对应两段不同源文案；
- Loader 跑在 `thread-loader` worker 中；
- 输出准备或成组写入失败，包括读不到或恢复不了残留的 commit journal。

Loader 里的解析错误和畸形键指令至少包含：

- 项目相对路径；
- semantic block；
- style index/lang（适用时）；
- 1-based 行；
- 0-based UTF-16 列；
- 底层错误原因。

键冲突没有单一位置。它列出每个冲突键、每段源文案、`explicit` 或 `derived`，以及该文案的全部 `path:line:column (kind)`。`thread-loader` 错误只说明 pitch 必须留在主进程。

失败时：

- webpack 保持失败；
- candidate round 作废；
- 若写入已经先改了内存，`release` 把 committed snapshots 滚回写入前的 checkpoint；键冲突和编译失败发生在写入前，内存本来就不动；
- 哈希词典、source map、源语言目录和目录元数据保持上一次成功版本；
- 不发布部分结果。

不支持的样式方言属于 warning，不属于 parse failure。警告码是 `unsupported-style-preprocessor`，每个 Resource identity 每轮最多一次，文案说明该方言没有被解析。

## 18.2 输出兼容性

继续保持：

- MD5 key；
- runtime dictionary 的对象结构；
- source map `version: 1`；
- 已有 Semantic kind；
- 相同 value 跨资源合并所有 distinct locations；
- 稳定排序；
- 参与本次写入的文件内容均相同时完全不写磁盘；
- 有变化的文件作为一组更新，并在失败时按 journal 回滚。

这一组正式产物是：

| 文件 | 内容 |
| --- | --- |
| `outputPath` | `{ "<md5>": "<解码后的文案>" }`，key 按字母序 |
| `sourceMapFilename` | `{ version: 1, parserVersion: "babel-7", configHash, entries }`。每个 entry 是 MD5、文案和排序后的 locations |
| `<catalogDir>/<sourceLocale>.json` | `{ "<本地化键>": "<源文案>" }`，经格式适配器序列化，key 按字母序 |
| `<catalogDir>/catalog.meta.json` | `{ version: 1, sourceLocale, format, entries }`。每个 entry 记录 `source`、`fingerprint`、`origin` 和排序后的 locations |

`fingerprint` 是源文案 SHA-256 的前 16 个十六进制字符。`origin` 是 `explicit` 或 `derived`。同一键下只要有一处显式键，origin 就是 `explicit`。比较两份元数据时：只在新文件里的键是 added，只在旧文件里的键是 removed，两边都在但 fingerprint 不同的键是 source-changed，fingerprint 相同的键是 unchanged。收集不写目标语言目录，也不写 `translation-state.json`。

`writeOutputs` 先丢掉字节已经相同的文件，再对剩余文件调用 `commitFiles`。空列表直接返回，不建临时文件，也不建 journal。否则在每个将要写入的目录里先寻找残留的 `.commit-*.json`；找得到就先按它恢复，读不了或恢复不了就失败。然后写下 journal，把新内容写到临时文件，把已存在的目标改名为备份，再把临时文件换成正式文件。journal 只在全部替换成功后删除。进程在 journal 还在时退出，会尽量按 journal 恢复；没能恢复的 journal 留到下一次写入。备份文件在提交点之后删除，删不掉不会撤销已经提交的内容。

本地化键不写入哈希词典，也不写入 source map。同一段文案改键时，词典字节可以不变，目录和元数据仍然变化。

`parserVersion: 'babel-7'` 暂时保留以避免无必要的 schema 变化，并在文档中说明它是历史 JavaScript parser 标记。多解析器元数据留待未来明确升级 Collection schema 时处理。

---

## 19. 输出时序与已知限制

当前应用会导入生成的 runtime dictionary，而 Plugin 必须等 Loader 完成本轮模块处理后才能得到完整结果，因此存在构建闭环：

```text
构建模块 → Loader 收齐文案 → Plugin 写出字典
    ↑                         ↓
    └──── 源码又导入字典 ─────┘
```

本期保留现有模型：

- 有效 compilation 完成后写正式输出，包括源语言目录；
- watch 中这一组里任何一个文件的字节变化都允许触发一次后续 compilation。演示项目用动态 `require` 引入词典，因此 `lang` 目录被监视，写到 `lang/catalog/` 的目录文件同样可能叫醒这次后续编译；
- 后续 compilation 看到相同字节后停止写入并保持安静；
- 一次性生产构建生成的磁盘词典和目录是最新结果；
- 该次 bundle 仍可能包含构建开始时的上一版词典。目录本身不被演示 bundle 导入。

本期不通过双阶段构建、二次编译或运行时消费方式重构来解决这一闭环。该限制必须在用户文档中明确说明，不能宣称单次 bundle 与本轮新字典强一致。

---

## 20. 分阶段实施方案

每阶段达到验收门槛并完成评审后，再进入下一阶段。

## Phase 1：职责与生命周期重构

### 目标

在增加完整 HTML/CSS 功能前，先建立单一收集来源、Resource identity 和可靠的 collection 生命周期。

### 文件级改动

- 重构 `packages/i18n-collect/myloader/index.js` 为透明 webpack adapter。
- 新增 `myloader/resource.js` 和 `myloader/extract-script.js`。分派留在 `myloader/index.js`，没有单独的 `extract.js`。
- 新增 `mycommon/session.js`。
- 扩展 `mycommon/store.js` 的替换、淘汰和结果生成能力。
- 删除 `myplugin/index.js` 的目录扫描、业务文件读取、Vue 正则切块及 Loader 内部函数调用。
- 调整 `mycommon/config.js` 的字段归属并删除 `htmlEntries`。
- 将当前 Vue interpolation 行为迁入 Loader 侧的兼容路径；Phase 2 再由正式 HTML extractor 接管。
- 修正 demo 中 JS Loader 的真实执行顺序。
- 将 webpack peer dependency 收缩到 webpack 5。
- 调整现有测试，使其不再依赖 Plugin 扫描磁盘。

### 验收门槛

- 已有 script string、template literal 和 Vue interpolation 的值、kind、MD5、排序及历史 JS range 保持兼容。
- 未进入 Loader 链的源码不会被收集。
- 同一 Vue 文件的不同 block 不互相覆盖。
- 零文案 Loader invocation 正常成功。
- 完全没有 Loader 证据时产生可执行的配置错误。
- `source`、`sourceMap` 和 `meta` 透明传递。
- parse/build 失败不修改正式输出。
- import 移除、文件删除和 block 删除会淘汰旧 snapshot。
- webpack cache 恢复的 metadata 不触发错误的“Loader 未接入”。
- watch 中未变化模块的 snapshot 不丢失。
- Plugin 不再读取或解析业务源码。

## Phase 2：HTML 收集

### 目标

完成 Vue template 和独立 HTML 的语义收集，并验证 HTMLWebpackPlugin 集成。

### 文件级改动

- 增加 `parse5` 直接依赖。
- 新增 `myloader/extract-html.js`。
- 扩展 dispatcher、资源坐标及错误格式化。
- 接入 Vue `type=template`。
- 在 demo 中显式配置 HTMLWebpackPlugin 的 forced Loader chain。
- 增加 child compiler/cached child 保留逻辑。
- 将 Phase 1 的 interpolation 兼容路径替换为正式 HTML extractor。
- 增加 HTML 纯函数和 webpack 集成测试。

### 验收门槛

- 不跨标签合并文本节点。
- 格式缩进与有意义的行内空格符合 fixture 定义。
- entity 使用解码值，range 保留原始拼写。
- 静态 allowlisted attributes 正确收集。
- Vue binding 只收集静态片段且不执行表达式。
- Vue interpolation 保持 `template-expression`。
- Vue 和独立 HTML 使用各自的 Semantic kind。
- HTMLWebpackPlugin 占位符和最终页面输出正常。
- child compilation 首次构建、缓存命中、模板移除和替换时的 snapshot 生命周期正确。
- fatal HTML/表达式错误报告路径、block 和位置，并保留旧输出。

## Phase 3：CSS 收集

### 目标

完成标准 CSS `content` 静态片段收集。

### 文件级改动

- 增加 `postcss` 直接依赖。
- 新增 `myloader/extract-css.js`。
- 扩展 dispatcher 和 style identity。
- 接入独立 `.css` 和 Vue `type=style`。
- 增加 CSS string scanner、escape 解码和原始范围映射。
- 为不支持的样式方言增加去重 warning。
- 增加 CSS 纯函数和 webpack/Vue style 集成测试。

### 验收门槛

- `content` 中每个静态字符串均可独立收集。
- 与 `counter()`、`attr()`、`var()` 混合时仍收集字符串 fragment。
- 非 `content`、custom property、选择器和注释不进入结果。
- 空值、空白、`none`、`normal` 和无 Han 字符的值忽略。
- CSS escape 的解码值和原始 range 都正确。
- 多个 Vue style block 使用不同 identity。
- 删除一个 style block 只淘汰对应 snapshot。
- SCSS/Less/Sass/Stylus 产生一次 warning，不误解析且不失败。
- 标准 CSS 解析失败使本轮失败并保留旧输出。

## Phase 4：集成加固和文档

### 目标

锁定真实 Vue CLI、webpack cache、watch 及跨平台行为。

### 文件级改动

- 完善 webpack 5 module graph 集成测试。
- 增加 HTMLWebpackPlugin child cache 测试。
- 增加 filesystem cache 跨 compiler 恢复测试。
- 加固删除、取消引用、配置变更及 watch 收敛测试。
- 更新 README、故障说明和领域词汇。
- 以有意识的 fixture 更新流程更新 demo 输出，避免单元测试意外修改仓库文件。

### 验收门槛

- package 测试全部通过。
- Vue CLI production build 通过。
- 页面行为、HTML 模板、JavaScript/CSS 和 source map 保持正常。
- 最终 Loader 顺序由测试证明。
- 输出在 cache 开关前后一致且字节稳定。
- 真正变化最多造成一次 watch 后续 compilation，并最终停止。
- CRLF、Windows 分隔符、astral character、UTF-16 列、重复位置及确定性排序有覆盖。
- 文档明确单次 bundle 的字典新鲜度限制。

---

## 21. 推荐测试结构

```text
packages/i18n-collect/test/
├── resource.test.js
├── script-extractor.test.js
├── html-extractor.test.js
├── css-extractor.test.js
├── template-fragment.test.js
├── session.test.js
├── loader.test.js
├── loader-order.test.js
├── collection.test.js
├── catalog.test.js
├── webpack-integration.test.js
├── watch-loop.test.js
├── cli-collect.test.js
├── cli-translate.test.js
├── cli-replace.test.js
├── cli-run.test.js
├── migration-workflow.test.js
└── fixtures/replacement/
    ├── vue2/
    ├── vue3/
    └── js/
```

职责：

- `resource.test.js`：query 规范化、identity、path boundary、glob、filter 和坐标。
- extractor tests：源码到 entries 的纯函数契约，包括排除指令、键指令和 context filter。
- `template-fragment.test.js`：Vue 与静态 HTML 的片段边界。
- `session.test.js`：begin、commit、release、abandon、回滚、保留、替换、淘汰和去重。
- `loader.test.js`：透明传递、metadata、warning 和错误格式。
- `loader-order.test.js`：最终 webpack 配置里的 Loader 顺序。
- `collection.test.js`：MD5、配置校验、`configHash` 与 `fileConfigHash` 的差别、稳定排序，以及字节相同时不写临时文件。
- `catalog.test.js`：派生键、显式键、冲突、指纹和目录差异。
- `webpack-integration.test.js`：真实 module graph、Vue blocks、HTMLWebpackPlugin 和 cache。HTMLWebpackPlugin 的 forced chain、child compiler 和缓存命中也在这里覆盖。
- `watch-loop.test.js`：相同输出不写、真正变化一次后收敛。
- `cli-collect.test.js`：一次收集的报告、scope override、退出码，以及不发网络请求。
- `cli-translate.test.js`、`cli-replace.test.js`、`cli-run.test.js`：翻译、替换预览和 `run` 编排。它们不是收集轮次的测试，但和收集共用配置与目录文件。
- `migration-workflow.test.js`：用 Vue 2、Vue 3 和通用 JavaScript fixture，以及本地假提供方，把收集到目录、失败保护、dry-run、写入和回滚串起来。不需要 API key、供应商 SDK 或出站网络。

测试 fixture 放在 package 测试目录内，不依赖递归扫描，也不把已提交的 demo 输出当作唯一 oracle。`fixtures/replacement` 只示范替换适配器能改写的位置，不进入 demo 的 webpack 入口。

---

## 22. 风险及控制措施

### Webpack cache metadata

`module.buildInfo.i18nCollect` 只能保存普通对象和数组。必须测试不同 compiler 实例间的 filesystem cache 恢复。

### Vue Loader pitcher 和执行顺序

Vue loader 会改写 block request。不能根据 rule 名称或注释推测顺序，必须检查最终 config，并在集成测试中证明 Loader 看到的输入。

### HTMLWebpackPlugin 内部行为

不直接依赖 cached-child 内部实现。只使用公开模板 Loader 路径以及 webpack compilation/dependency 数据；文档注明受支持的 HTMLWebpackPlugin major。

### 解码值和原始范围

HTML entity 和 CSS escape 会导致解码值长度与源码长度不同。Scanner 必须在同一次处理里同时产出解码值和原始 `[startOffset, endOffset)`，不能根据解码值反推源码范围。

### 重复 Loader 执行

同一 identity 的候选 snapshot 使用替换语义，因此重复执行幂等。Warning 以 `compilation + identity + code` 去重。

### 配置变更

配置文件应登记为 webpack dependency；配置变化使相关模块失效，并在下一个有效 round 中更新配置哈希和结果。

### 输出触发 watch

保留现有字节相等短路和成对写入。失败 round 绝不写输出。

---

## 23. 非目标

本设计不包括：

- 在收集轮次里修改业务源码。源码替换是后来的 `replace` 命令，默认只做预览，见 README；
- 调用翻译提供方，或写出目标语言目录和审阅状态。那是 `translate` 命令；
- 运行时翻译方案调整；
- final bundle 扫描；
- Plugin 扫描业务文件；
- 收集没有进入 Loader 链的资源；
- 执行或复杂折叠 JavaScript/CSS 动态表达式；
- Sass、Less、Stylus 解析；
- webpack 4 支持；
- 通用 directive framework。已经落地的只有节点级 `no-i18n-auto` 和 `i18n-key`，规则见第 12.1 节；
- Vite/Rollup 集成；
- 通用 parser registry；
- 解决一次性 bundle 消费同轮新字典的构建闭环。

---

## 24. 实施顺序

依赖顺序固定为：

1. Phase 1 建立职责、Resource identity、session 和事务发布。
2. Phase 2 在同一路径上加入 HTML，并解决 HWP child/cache 生命周期。
3. Phase 3 复用相同 snapshot、错误和坐标契约加入 CSS。
4. Phase 4 在语义稳定后锁定集成、fixture 和文档。

Phase 1 到 Phase 4 已经按这个顺序落地。其后的排除指令、context filter、键控目录和 `i18n-collect collect` 都接在同一条 Loader 提交、Plugin 发布的路径上，没有另起一套扫描。本文保存这套设计；命令行的翻译、替换和编排见 README。
