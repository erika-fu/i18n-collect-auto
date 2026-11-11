# 05 — 保证 Source replacement 与 Build replacement 共存

**What to build:** 完成两种 replacement 模式的兼容闭环。项目可以长期保留中文源码并使用 Build replacement，也可以对部分或全部位置运行 `replace --write` 做永久迁移。无论选择哪种方式，同一个 occurrence 必须使用同一个 localization key 和相同调用选择规则；显式 localized call 优先，混合文件可以同时包含已经迁移的调用和尚未迁移的中文静态文案。任何执行顺序都不能造成重复包装、key 漂移或 catalog 历史丢失。

**Blocked by:** 03 — 扩展 Vue 3 Build replacement; 04 — 扩展 Vue 2 Build replacement.

**Status:** ready-for-agent

- [ ] CLI preview、CLI `--write` 和 Build replacement 对相同 occurrence 使用共享 Planner，并产生相同的 adapter call 决策。
- [ ] Build replacement 不写 replacement metadata；只有 Source replacement 成功提交后才更新该审计记录。
- [ ] 先运行 Build replacement、再运行 Source replacement 时，preview 和实际写入结果与未进行过构建转换时一致。
- [ ] 先运行 `replace --write`、再运行两阶段 build 时，collection 将显式调用识别为 localized-call，Build replacement 不再次包装。
- [ ] 同一文件中显式 localized call 与 source-text occurrence 可以共存，并各自保持正确 catalog identity。
- [ ] 已有 replacement metadata 的项目可以升级并使用 Build replacement，不要求删除或重建历史记录。
- [ ] 相同中文的不同 occurrence 继续保留各自 localization key；明确共享 key 的 occurrence 继续共享同一调用。
- [ ] legacy MD5 调用保持现有兼容行为，不被 Build replacement 误识别为项目 keyed occurrence。
- [ ] orphaned、retired、external key 和显式 message 的现有 catalog 生命周期不因双模式而改变。
- [ ] CLI JSON/human report、退出码和事务恢复行为保持向后兼容。
- [ ] 端到端测试覆盖 JS、Vue 2、Vue 3 的两种执行顺序、混合文件、重复运行和 catalog 再收集。
- [ ] 完整 package 测试通过，并证明没有出现两套 planner 规则分叉。

