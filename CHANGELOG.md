# Changelog

## 0.1.1 - 2026-08-27

- 修复 Adapter 发布包中 `workspace:^` 依赖导致 npm 客户端无法安装的问题。
- npm 发布包改用普通 semver 依赖，兼容 npm、pnpm 和 yarn consumer。

## 0.1.0 - 2026-08-27

- 提供 Vue3 BOE Runtime Adapter 和只读 Browser Extension。
- 支持最终单据模板、区域配置、字段配置和差旅标准检查。
- 支持页面字段选择、定位及 Side Panel 展示。
- 提供 Options API Mixin 与 Composition API `setup()` 两种接入方式。
