# 07 — 交付串行 Watch Build replacement

**What to build:** 为 `i18n-collect build --watch` 实现一致的双阶段监听循环。每个有效变更周期必须先完成 collection、提交 catalog，再用该版本 catalog 执行 replacement compilation，最后发布 bundle。监听期间不能先向浏览器或输出目录发布基于旧 catalog 的临时 bundle。连续文件事件必须合并和串行化，慢速构建期间的新变更必须排入下一轮，而不是并发修改共享 catalog。

**Blocked by:** 06 — 落实严格失败与产物发布契约.

**Status:** implemented (local; awaiting commit)

- [x] Watch 启动时先完成一次完整的 collect、catalog commit、replacement build、publish 周期。
- [x] 业务源码新增、修改或删除 collected copy 时，下一次发布的 bundle 使用同一周期刚提交的 catalog。
- [x] catalog、配置、runtime 模块和 webpack 配置变化能够使正确阶段失效并触发新周期。
- [x] catalog 文件被声明为 replacement compilation dependency，但 catalog 发布不会造成无限 rebuild loop。
- [x] 连续 invalidation 被合并；任一时刻最多有一个 collection 阶段和一个受协调的 replacement 阶段运行。
- [x] 构建中途收到的新变更会在当前周期结束或取消后触发下一轮，不会丢失。
- [x] collection 失败时不执行 replacement 阶段，并保留上一版 catalog 和 bundle。
- [x] replacement 失败时保留该轮成功发布的 catalog 供诊断，但不发布不完整 bundle；后续修复能够恢复监听。
- [x] 未改变有效 collection 或 replacement 输出的事件不会产生无休止的 catalog 写入和重复 compilation。
- [x] Watch 关闭时两个 compiler、文件 watcher、进程监听器和临时资源都被释放。
- [x] 自动化测试覆盖首次构建、新增文案、编辑文案、删除文案、快速连续编辑、失败后恢复、配置变化和正常关闭。
- [x] 测试明确断言每个已发布 bundle 对应的 catalog 版本，期间没有可观察到的旧 catalog 中间 bundle。

