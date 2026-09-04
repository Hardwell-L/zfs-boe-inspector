# Changelog

## Extension 0.2.5 - 2026-09-04

- 规则依赖标题展示当前值摘要，优化显示文本、计算说明和动态显示规则筛选。
- 新增 AI 排障与过程分析，支持直接关联证据、请求精简、脱敏、Markdown 回答及引用定位。
- AI 分析范围支持页面字段和区域连续点选；需配合支持 `continuous-picker` 的 Adapter，旧 Adapter 保留单次选择。
- 修复 AI 配置读取和诊断列表的 TypeScript 类型检查错误。

## Extension 0.2.4 - 2026-09-02

- 更新 Runtime Adapter 未接入时的提示，与 `billTemplate.vue` 单点注册和差旅 Collector 自动注册方式保持一致。

## Extension 0.2.3 - 2026-08-28

- 扩展 Side Panel 支持访问任意 HTTP/HTTPS BOE 环境，不再局限于 `localhost` 和 `127.0.0.1`。
- 增加独立 Extension ZIP 发布流程，不更新或发布 npm 包。

## 0.2.2 - 2026-08-28

- `billTemplate` Collector 自动识别标准差旅父组件并注册 Travel Collector，业务项目无需逐个修改差旅 wrapper。
- 自动注册与显式差旅 Mixin/Composable 共享同一 Collector，并通过引用计数安全管理注销生命周期。
- 新增自动发现开关与自定义差旅宿主解析回调，兼容非标准组件层级。

## 0.2.1 - 2026-08-27

- 修复 `adapter-vue3@0.2.0` 在 npm registry 中残留 `workspace:^`、导致 npm 客户端无法安装的问题。
- npm 发布流程固定发布 `release/npm` 中的 tarball，并在发布检查中禁止 public package 使用 `workspace:` 协议。

## 0.1.2 - 2026-08-27

- 新增差旅组件的 Mixin 和 Composition API Composable，自动安装 Inspector Runtime。
- 修复 `NEW_TRAVEL_BOE` 父组件先于 `billTemplate` 子组件挂载时的 Runtime 未安装异常。

## 0.1.1 - 2026-08-27

- 修复 Adapter 发布包中 `workspace:^` 依赖导致 npm 客户端无法安装的问题。
- npm 发布包改用普通 semver 依赖，兼容 npm、pnpm 和 yarn consumer。

## 0.1.0 - 2026-08-27

- 提供 Vue3 BOE Runtime Adapter 和只读 Browser Extension。
- 支持最终单据模板、区域配置、字段配置和差旅标准检查。
- 支持页面字段选择、定位及 Side Panel 展示。
- 提供 Options API Mixin 与 Composition API `setup()` 两种接入方式。
