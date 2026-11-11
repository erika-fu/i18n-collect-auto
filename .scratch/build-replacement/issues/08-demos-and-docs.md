# 08 — 改造 Vue 2/Vue 3 Demo 并补齐用户文档

**What to build:** 把 Build replacement 接入现有 Vue 2 和 Vue 3 demo，让用户可以直接观察“磁盘源码保留中文静态文案、catalog 获得稳定 key、正式 bundle 使用 runtime localization call、页面能够切换语言”的完整体验。保留 Source replacement 演示和命令说明，使两种模式的用途清楚可选。React JSX 不在第一版 Build replacement 支持范围内，因此 React demo 继续作为 collection、explicit localization 和 policy 示例，并明确说明该限制，不能伪装成已经支持。

**Blocked by:** 05 — 保证 Source replacement 与 Build replacement 共存; 07 — 交付串行 Watch Build replacement.

**Status:** implemented (local; awaiting commit)

- [x] Vue 2 demo 配置 Build replacement、兼容的 Vue i18n runtime 模块、源语言和至少一个目标语言 catalog。
- [x] Vue 3 demo 配置 Build replacement、兼容的 Vue i18n runtime 模块、源语言和至少一个目标语言 catalog。
- [x] 两个 Vue demo 的业务 SFC 保留直接中文静态文案，同时页面在正式构建后通过 localization key 渲染。
- [x] 两个 Vue demo 展示语言切换，证明 Build replacement 与现有 runtime catalog 加载职责能够组合。
- [x] Demo build script 使用两阶段构建入口，不依赖开发者手工先运行 collect。
- [x] Demo watch script 使用串行 Watch Build replacement，并能在新增中文后自动获得 key 和刷新正式 bundle。
- [x] Demo 构建前后通过测试或脚本验证业务源文件未被修改。
- [x] Source replacement preview 和 `--write` 仍有独立文档与示例，明确它是可选永久迁移，不是启用 Build replacement 的前置条件。
- [x] React demo 和文档明确说明 JSX 第一版不支持 Build replacement；现有 collection、explicit call 和 runtime multilingual 示例保持可用。
- [x] 用户文档解释 Source replacement、Build replacement、Replacement Planner、两阶段构建和首次新增中文的时序。
- [x] 用户文档包含配置字段、一次性 build、watch、runtime 模块契约、失败诊断、CI 使用和常见 loader 顺序问题。
- [x] 文档明确 Build replacement 不负责安装 runtime、加载 locale、语言切换、fallback 或翻译完整性。
- [x] Vue 2、Vue 3 demo production build 和可自动化的页面行为检查通过。
