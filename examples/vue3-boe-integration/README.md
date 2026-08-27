# Vue3 BOE 接入示例

该目录只保存真实 BOE 项目的接入片段，不包含本地模拟页面，也不复制任何 `@zfs` 依赖源码：

- `billTemplate.inspector.js`：Options API / Mixin 接入示例。
- `billTemplate.setup.js`：Composition API / setup 接入示例。
- `travel.inspector.js`：在 local NEW_TRAVEL_BOE wrapper 中复用的生命周期 helper。

实际项目应选择一种 billTemplate 接入方式并合并进已有 local wrapper，保留原有 `extends`、组件注册、生命周期和业务方法。
