# 06 — 落实严格失败与产物发布契约

**What to build:** Build replacement 的成功含义是正式 bundle 已对其支持范围内的 collected copy 完成安全转换。因此 Build replacement 不提供 Source replacement CLI 那样的宽松 skipped 模式。把所有无法证明安全和一致的情况转换为结构化构建错误，并保证 collection 或 replacement 任一阶段失败时都不会发布新的部分 bundle。错误必须足以让开发者在不阅读内部实现的情况下定位 occurrence 和修复原因。

**Blocked by:** 03 — 扩展 Vue 3 Build replacement; 04 — 扩展 Vue 2 Build replacement.

**Status:** implemented (local; awaiting commit)

- [x] catalog 缺失、不可读、schema 不支持或 collection config/catalog 不一致时，正式 replacement compilation 不启动或立即失败。
- [x] occurrence 未知、orphaned、retired、位置过期、身份歧义或 key conflict 时构建失败。
- [x] catalog location 与 AST/Template IR 不匹配、编辑范围重叠或同一范围存在竞争声明时构建失败。
- [x] React JSX、独立 HTML、CSS generated content 和其他第一版不支持的 collected position 在启用 Build replacement 的项目中构建失败，而不是保留中文静默通过。
- [x] runtime 模块越界、无法解析、缺少指定 export、模块类型无法安全注入或 helper binding 无法生成时构建失败。
- [x] 已有 localized call 引用未知、retired 或不允许的 project key 时沿用 collection 的 fail-closed 规则。
- [x] 每条诊断至少包含项目相对路径、起止行列、semantic kind、localization key、source text 和稳定原因描述。
- [x] JSON 输出提供机器可读的阶段、failure kind 和 occurrence details；human 输出保持简洁且可操作。
- [x] collection compilation 失败时保留上一版 catalog 和正式 bundle。
- [x] replacement compilation 失败时不发布新 bundle、不覆盖上一版成功产物，也不留下 staging、temp、backup 或 journal 文件。
- [x] Source replacement CLI 继续保持默认报告 skipped、仅 `--strict` 失败的既有契约。
- [x] 自动化测试覆盖每类失败、多个失败的确定性排序、无部分 emit、上一版产物保留和进程退出码。
