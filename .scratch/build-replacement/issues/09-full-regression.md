# 09 — 完成全量回归与发布前加固

**What to build:** 对双模式 replacement 和两阶段构建做发布前完整回归，修复集成后暴露的问题，并提供可重复执行的验证入口。验收范围不仅包括新增 Build replacement，还必须覆盖现有 collection、catalog identity、translation、Source replacement、policy、verify、webpack cache、watch 和 demo。最终结果必须证明构建模式从不修改业务源文件，永久迁移模式仍然事务安全，并且失败场景不会留下半成品。

**Blocked by:** 08 — 改造 Vue 2/Vue 3 Demo 并补齐用户文档.

**Status:** implemented (local; awaiting commit)

- [x] package 全量自动化测试通过，包括 collection、catalog、translation、Source replacement、run、verify、policy、webpack integration 和 watch。
- [x] Vue 2 demo 和 Vue 3 demo 的 production build、两阶段首次收集、重复构建和语言切换验证通过。
- [x] Build replacement 的 JS/TS、Vue 2、Vue 3 结果与共享 Planner 的 Source replacement call 决策一致。
- [x] Source replacement preview、`--strict`、`--write`、事务失败恢复和中断后恢复回归通过。
- [x] webpack memory cache 和 filesystem cache 在源码、catalog、配置及 runtime 模块变化后正确失效，缓存命中时不会丢失 collection metadata。
- [x] Watch 在真实 webpack compiler 下覆盖首次构建、连续修改、失败恢复、删除资源和关闭清理，不产生 rebuild loop。
- [x] source map 回归覆盖普通 JS/TS、Vue template、Vue script 和下游编译错误，诊断映射回原始磁盘源码。
- [x] Windows 路径分隔符、CRLF、UTF-16 列、astral character、重复 occurrence 和多 block SFC 回归通过。
- [x] identity ambiguity、key conflict、orphaned/retired key、explicit message、external key 和 legacy MD5 行为保持正确。
- [x] 构建失败时上一版正式 bundle 可继续使用，输出目录不存在部分新产物。
- [x] 所有 Build replacement 测试在执行前后比较受测业务源码，确认文件内容和时间戳没有被转换流程修改。
- [x] 测试结束后不存在 staging、temp、backup、commit journal、未关闭 watcher 或悬挂 compiler。
- [x] README、中文 README、CLI help、领域词汇和 ADR 对命令、默认值、失败策略及支持范围表述一致。
- [x] 提供一条可重复执行的完整回归命令，并在干净工作区连续运行两次得到一致结果。
