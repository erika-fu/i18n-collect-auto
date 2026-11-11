# 02 — 交付 JS/TS 两阶段 Build replacement 主链路

**What to build:** 在保留现有 Source replacement 的基础上，为普通 JavaScript 和 TypeScript 提供不修改业务源文件的 Build replacement。新增 `i18n-collect build` 编排入口：第一阶段运行 collection compilation 并发布稳定 catalog，第二阶段读取该 catalog，在模块进入后续编译器前执行内存替换并产出正式 bundle。构建转换必须复用共享 Replacement Planner，并根据项目配置的 runtime 模块自动注入唯一 helper binding，使业务源码无需预先导入 `t`。第一阶段产物不能被当作正式 bundle，第二阶段成功后才算构建成功。

**Blocked by:** 01 — 提炼共享 Replacement Planner 并记录架构决策.

**Status:** implemented (local; awaiting commit)

- [x] 配置支持启用 Build replacement、选择 `js` adapter、声明项目根目录相对的 runtime 模块和命名导出，并拒绝未知字段、越界路径和无效值。
- [x] Build replacement 配置不改变 collection result 的身份语义；与收集无关的构建字段不应造成 localization key 或 collection metadata 的非必要失效。
- [x] `i18n-collect build` 接受 webpack 配置和现有通用 CLI 输出模式，严格按 collection compilation、replacement compilation 的顺序执行。
- [x] 第一阶段失败、catalog 发布失败或 occurrence identity/key conflict 未解决时，不启动第二阶段。
- [x] 第一阶段产生的临时 webpack bundle 不进入项目正式输出；只有第二阶段成功结果可以发布。
- [x] 普通 ESM 模块能够自动注入 runtime 命名导入，CommonJS 模块能够自动注入对应的 `require` binding。
- [x] runtime 模块请求按当前资源正确解析，不能把一个只对项目根目录有效的相对请求原样插入所有嵌套模块。
- [x] 自动生成的 helper 名称避开模块中已有 binding，并且所有本次生成的 call 使用同一个安全别名。
- [x] 已有有效 `t` binding 和已经存在的 localized call 得到识别，不会重复注入或重复包装。
- [x] 支持现有 JS adapter 允许的字符串和模板字面量语义位置；对象 key、switch case、JSX 和其他不支持位置不被静默改写。
- [x] 转换生成可供后续 Babel/TypeScript loader 继续组合的 source map，映射回磁盘原始源码。
- [x] 构建前后业务源文件字节完全一致；Build replacement 不创建 replacement metadata，也不调用 Source replacement 的磁盘提交 Adapter。
- [x] 集成测试证明首次新增中文能在同一次 `i18n-collect build` 的第二阶段以稳定 key 进入 bundle。
- [x] ESM、CommonJS、TypeScript、模板字面量、helper 命名冲突、source map 和构建失败路径均有自动化测试。

