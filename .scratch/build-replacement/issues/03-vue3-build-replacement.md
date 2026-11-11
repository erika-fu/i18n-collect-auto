# 03 — 扩展 Vue 3 Build replacement

**What to build:** 将 Build replacement 扩展到 Vue 3 单文件组件，同时保持磁盘 SFC 以中文静态文案为权威。转换必须发生在根 SFC 被 `vue-loader` 拆分和编译之前，以便共享 Planner 可以继续使用 keyed catalog 中相对于完整原始 SFC 的 occurrence 坐标。支持 template、Options API 和 `<script setup>`，并与项目已有的 Vue i18n runtime 集成；不得通过修改业务启动文件安装 runtime。

**Blocked by:** 02 — 交付 JS/TS 两阶段 Build replacement 主链路.

**Status:** ready-for-agent

- [ ] Vue 3 Build replacement 在根 SFC 进入 `vue-loader` 解析前处理内存源码，collection 仍以磁盘原始 SFC 和原始坐标为权威。
- [ ] Template text 转换为 `$t` 插值，静态用户可见属性转换为动态绑定，template expression 和模板字面量静态片段保持原表达式结构。
- [ ] Options API 的实例方法和受支持生命周期位置使用 `this.$t`，不具备实例语义的位置不会被错误转换。
- [ ] `<script setup>` 和其他需要独立函数的位置使用安全 runtime helper；缺少 binding 时只向内存中的对应 script block 注入配置的 runtime import。
- [ ] 已存在 `$t`、`this.$t` 或合法 helper call 时识别为 localized call，不发生嵌套替换。
- [ ] 构建开始前验证 Vue 3 所需的 `vue-i18n` 主版本和现有 `createI18n` 集成；注释或同名非调用不能通过验证。
- [ ] 一个 SFC 同时包含 template、普通 script、script setup 或多个可替换 occurrence 时，所有 edit 使用完整 SFC 坐标安全合并。
- [ ] Vue Template IR 与 catalog location 不一致时构建失败，不使用文本搜索猜测替换位置。
- [ ] 转换后的 SFC 能由真实 `vue-loader` 和 Vue 3 compiler 完成生产构建，且运行时渲染通过 localization key 获取文案。
- [ ] source map 或 Vue 编译诊断仍指向磁盘原始 SFC 的合理行列。
- [ ] 自动化测试覆盖 template text、attribute、expression、Options API、script setup、已有 localized call、位置过期和 runtime 集成缺失。
- [ ] 集成测试在构建前后比较 SFC 字节，确认 Build replacement 没有写入业务源文件。

