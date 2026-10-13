# 文案收集架构设计

## 1. 状态与目标

本文记录经过设计访谈确认的目标架构和分阶段实施方案。Phase 1 到 Phase 4 已经落地，本文继续作为设计记录。接入方式、配置、支持范围和故障说明见仓库 README 与 `docs/collection.md`。

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
- 聚合、去重并输出正式文档。

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
- 运行时字典 `{ "<md5>": "<value>" }`；
- source map 的 `version: 1` 外层结构；
- 已有 Semantic kind 名称；
- 已有 JavaScript 文案和范围行为；
- 稳定排序及相同字节不重写输出。

新 HTML/CSS 支持只增加已有种类的新位置，不借机重新定义已有 JavaScript 数据。

---

## 3. 最终职责边界

## 3.1 Loader

Loader 负责：

1. 识别资源路径、扩展名及 Vue block query。
2. 规范化 Resource identity。
3. 应用 `include` 和 `exclude`。
4. 调用对应的纯 extractor。
5. 为一个资源生成完整 Resource snapshot，包括空 snapshot。
6. 将 snapshot 写入当前 webpack module 的构建元数据。
7. 向当前 compilation session 报告此次处理。
8. 原样传递 `source`、`sourceMap` 和 `meta`。

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
6. 在 compilation 成功后聚合和写出两个 JSON 文件。
7. compilation 失败时保留上一次正式输出。
8. 检测 Loader 完全没有接入的配置错误。

---

## 4. 目标模块结构

保持两个公共入口不变，内部只拆出必要的职责：

```text
packages/i18n-collect/
├── myloader/
│   ├── index.js                   # webpack Loader adapter
│   ├── resource.js                # 类型、query、identity、过滤和坐标
│   ├── context-filter.js          # 可选的 logging / tests / analytics 策略
│   ├── extract.js                 # 三类 extractor 的简单分派
│   ├── extract-script.js          # JavaScript/TypeScript/表达式
│   ├── extract-html.js            # HTML 和 Vue template
│   └── extract-css.js             # 标准 CSS
├── myplugin/
│   └── index.js                   # compilation 生命周期与输出
└── mycommon/
    ├── scope-pattern.js           # 目录边界与 glob 范围
    ├── session.js                 # 候选 round、提交、放弃和淘汰
    ├── store.js                   # 聚合、去重和稳定排序
    ├── config.js                  # 配置加载、校验和字段归属
    └── output.js                  # 相同内容跳过和成对写入
```

不建立通用 parser registry 或插件系统。三个 extractor 共享最小 entry 数据结构，但不相互依赖。

### 4.1 Extractor 接口

统一的纯函数入口：

```js
extractResource({
  source,
  resource,
  config
})
```

返回：

```js
{
  identity,
  entries,
  warnings
}
```

其中 `resource` 是规范化描述，不是 webpack 对象：

```js
{
  absolutePath,
  projectPath,
  query,
  block,
  styleIndex,
  lang,
  sourceOffset
}
```

Extractor 不读取其他文件、不访问 webpack hook、不写输出、不修改 session，也不保存全局状态。

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
- 零条结果也必须提交空 snapshot，从而删除该资源以前存在的条目。
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

Loader 将普通、可序列化的 snapshot 写入 module metadata，例如：

```js
module.buildInfo.i18nCollect = snapshot
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
各资源经过 myloader
        ↓
extractor 生成完整 snapshot
        ↓
snapshot 写入 module.buildInfo
        ↓
Plugin 从当前 module graph 重建 live snapshots
        ↓
检查 compilation 是否有效
       / \
    失败   成功
     ↓      ↓
 放弃候选  原子替换正式结果
             ↓
       聚合并写出 JSON
```

Session 最少需要表达以下操作：

```js
session.begin(compilation)
session.submit(compilation, module, snapshot)
session.warn(compilation, warning)
session.commit(compilation, liveSnapshots, configHash)
session.abandon(compilation)
```

内部维护：

- 上一次成功构建的 committed snapshots；
- 以 Compilation 为键的 candidate round；
- 本轮 Loader invocation 证据；
- 本轮 warnings 的去重状态；
- 最近一次成功的配置哈希。

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

要求：

- string 或 Buffer 的源码内容保持不变；
- 传入 source map 原样传给后续 Loader；
- `meta` 原样传递；
- Loader 应最先看到当前语义资源的原始内容；
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

动态 HTML 属性中的静态片段仍是 `html-attribute`。

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

不限制 `content` 必须位于伪元素上；只要声明本身符合规则，就处理其中的静态字符串。

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
  sourceMapFilename: 'lang/zh_hash.map.json'
}
```

修改：

- 删除 `htmlEntries`；
- Loader 使用 `include`、`exclude`、`contextFilters`、`attributeAllowlist`、`styleExtensions`；
- Plugin 使用 `outputPath`、`sourceMapFilename`；
- 显式 options 只能覆盖调用方拥有的字段；
- 未知字段和跨职责字段继续报错；
- `configHash` 基于规范化后的完整配置；
- 配置文件存在时，Loader 应将其登记为 webpack dependency，以便 watch 正确失效。

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

`contextFilters` 默认是 `[]`。可选值只有 `logging`、`tests`、`analytics`，可以单独选择。未选择时，收集不会按启发式丢掉文案。选择之后，只去掉该策略所描述的 script 候选，以及 Vue 插值和动态属性里的同类表达式；HTML 文本和 CSS 生成内容不在这些策略里。具体调用名单见 README。未知名称和重复项是配置错误。该字段属于 Loader。

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
- 输出准备或成对写入失败。

错误至少包含：

- 项目相对路径；
- semantic block；
- style index/lang（适用时）；
- 1-based 行；
- 0-based UTF-16 列；
- 底层错误原因。

失败时：

- webpack 保持失败；
- candidate round 作废；
- committed snapshots 不变；
- 两个正式输出保持上一次成功版本；
- 不发布部分结果。

不支持的样式方言属于 warning，不属于 parse failure。

## 18.2 输出兼容性

继续保持：

- MD5 key；
- runtime dictionary 的对象结构；
- source map `version: 1`；
- 已有 Semantic kind；
- 相同 value 跨资源合并所有 distinct locations；
- 稳定排序；
- 两个输出内容均相同时完全不写磁盘；
- 两个文件成对更新并在同步错误时回滚。

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

- 有效 compilation 完成后写正式输出；
- watch 中真正变化的字典允许触发一次后续 compilation；
- 后续 compilation 看到相同字节后停止写入并保持安静；
- 一次性生产构建生成的磁盘字典是最新结果；
- 该次 bundle 仍可能包含构建开始时的上一版字典。

本期不通过双阶段构建、二次编译或运行时消费方式重构来解决这一闭环。该限制必须在用户文档中明确说明，不能宣称单次 bundle 与本轮新字典强一致。

---

## 20. 分阶段实施方案

每阶段达到验收门槛并完成评审后，再进入下一阶段。

## Phase 1：职责与生命周期重构

### 目标

在增加完整 HTML/CSS 功能前，先建立单一收集来源、Resource identity 和可靠的 collection 生命周期。

### 文件级改动

- 重构 `packages/i18n-collect/myloader/index.js` 为透明 webpack adapter。
- 新增 `myloader/resource.js`、`myloader/extract.js` 和 `myloader/extract-script.js`。
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
├── session.test.js
├── loader.test.js
├── webpack-integration.test.js
├── html-webpack-plugin.test.js
├── watch-loop.test.js
└── fixtures/
```

职责：

- `resource.test.js`：query 规范化、identity、path boundary、filter 和坐标。
- extractor tests：源码到 entries 的纯函数契约。
- `session.test.js`：begin、commit、abandon、保留、替换、淘汰和去重。
- `loader.test.js`：透明传递、metadata、warning 和错误格式。
- `webpack-integration.test.js`：真实 module graph、Vue blocks 和 cache。
- `html-webpack-plugin.test.js`：forced chain、child compiler 和缓存命中。
- `watch-loop.test.js`：相同输出不写、真正变化一次后收敛。

测试 fixture 放在 package 测试目录内，不依赖递归扫描，也不把已提交的 demo 输出当作唯一 oracle。

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

- 修改业务源码或自动替换为翻译调用；
- 运行时翻译方案调整；
- final bundle 扫描；
- Plugin 扫描业务文件；
- 收集没有进入 Loader 链的资源；
- 执行或复杂折叠 JavaScript/CSS 动态表达式；
- Sass、Less、Stylus 解析；
- webpack 4 支持；
- 通用 directive framework。节点级 `no-i18n-auto` 排除指令见 README；
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

任何阶段开始前均应先确认该阶段的范围；本文保存设计，不授权立即实施。
