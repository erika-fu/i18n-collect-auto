# 01 — 提炼共享 Replacement Planner 并记录架构决策

**What to build:** 当前系统的 Source replacement 能够根据 keyed catalog 中的 occurrence 和 localization key，把支持的源码位置规划为 `t`、`$t` 或 `this.$t` 调用，但规划、预览、文件读取和写入职责仍集中在 CLI 路径中。提炼一个无文件副作用的 Replacement Planner，让 Source replacement 和未来的 Build replacement 使用同一套匹配、调用选择、重叠检查和已本地化识别规则。现有 `replace` 默认预览、`--strict` 和 `--write` 行为必须保持兼容。同时记录为什么系统同时保留会修改业务源文件的 Source replacement，以及只修改内存模块和构建产物的 Build replacement；记录新 occurrence 必须先获得稳定 localization key，正式 bundle 才能消费该 key 的两阶段决策。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Replacement Planner 提供一个稳定的小型接口，输入包含源码、adapter、catalog occurrence、资源信息和可用 runtime 能力，输出包含 edits、replacement、recognized 和 skipped/failure 详情。
- [ ] Planner 不读取或写入文件、不加载项目配置、不提交 catalog，也不依赖 CLI 或 webpack 对象。
- [ ] JS/TS AST、Vue Template IR、位置校验、调用形式选择、已本地化识别和重叠编辑处理只保留一套权威实现。
- [ ] 现有 CLI 通过 Adapter 调用共享 Planner，默认 dry-run、JSON/human report、`--strict`、`--write` 和退出码保持兼容。
- [ ] Source replacement 仍使用事务提交源文件、catalog 文件和 replacement metadata；Planner 本身不感知该事务。
- [ ] 现有 replacement metadata reconciliation 行为保持兼容，重复执行不会产生嵌套 localization call。
- [ ] 领域词汇明确区分 Source replacement、Build replacement 和 Replacement Planner，不把 Build replacement 描述为磁盘源码改写。
- [ ] 新增 ADR 记录双模式、共享 Planner 和两阶段构建选择，并说明为何拒绝在单次 compilation 中边收集、边分配 key、边转换。
- [ ] 现有 replace 专项测试和完整 package 测试通过，输出快照或报告顺序没有非必要变化。

