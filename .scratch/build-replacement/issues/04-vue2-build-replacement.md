# 04 — 扩展 Vue 2 Build replacement

**What to build:** 将 Build replacement 扩展到 Vue 2 单文件组件，复用与 Source replacement 相同的 Vue template 和 Options API 语义规则。磁盘 SFC 保持中文静态文案，内存中的根 SFC 在进入 Vue 2 `vue-loader` 前转换。构建必须验证项目已经使用兼容的 Vue i18n 8 runtime，不安装依赖，也不修改应用 bootstrap。

**Blocked by:** 02 — 交付 JS/TS 两阶段 Build replacement 主链路.

**Status:** implemented (local; awaiting commit)

- [x] Vue 2 Build replacement 在根 SFC 拆块前处理内存源码，并继续以完整磁盘 SFC 的 occurrence 坐标作为匹配依据。
- [x] Template text、用户可见静态属性、template expression 和模板字面量片段生成与现有 Vue 2 Source replacement 相同的 `$t` 调用形状。
- [x] Options API 的实例方法、受支持生命周期和 data 等实例位置使用 `this.$t`。
- [x] 顶层脚本、普通嵌套函数、箭头形式的 Options API method 和其他没有 Vue 实例语义的位置不会被错误赋予 `this.$t`。
- [x] 已存在 `$t` 或 `this.$t` 调用时识别为 localized call，不发生嵌套转换。
- [x] 构建前验证 `vue-i18n` 主版本为 8，并存在真实的 `Vue.use(VueI18n)` 或 `new VueI18n(...)` 集成。
- [x] 注释、字符串和同名但无关的标识符不能伪造 runtime 集成。
- [x] Vue Template IR、script AST 和 catalog location 必须一致；过期位置不能通过文本搜索兜底。
- [x] 真实 Vue 2/Vue CLI production build 能消费转换后的内存 SFC，并通过 localization key 渲染文案。
- [x] source map 和构建诊断能够映射回原始磁盘 SFC。
- [x] 自动化测试覆盖 template、attribute、expression、实例方法、data、箭头方法、嵌套函数、已有 localized call 和缺失 runtime。
- [x] 构建前后 SFC 字节完全一致，Build replacement 不产生 replacement metadata。

