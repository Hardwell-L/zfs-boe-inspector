# 架构设计

## 数据链路

```text
BOE local wrapper
  ├─ billTemplate Collector：最终 template、rawBillData、字段描述与动态状态
  └─ NEW_TRAVEL Collector：calendar、标准请求元数据、缓存日期、结果与汇总
                         ↓ 按动态 instanceId 合并
Page Bridge：window.__ZFS_BOE_INSPECTOR__
             ↓ Side Panel: chrome.scripting.executeScript(MAIN)
             ↓ DevTools: chrome.devtools.inspectedWindow.eval
BOE Inspector Panel
  ├─ Snapshot 展示
  ├─ 页面字段/区域选择器
  ├─ 可撤销的方法观察与过程记录
  ├─ 确定性 Rule Engine
  ├─ JSON 报告导出
  └─ 扩展侧 AI 请求、范围预览与脱敏
```

## 关键决策

### 采集最终模板

`getBillTemplate.js` 先读取并合并父子模板，但 `initBillData.handleTemplate()` 后续仍会执行 `templateOp()` 和 `initBillField()`，最终再执行 `this.template = markRaw(billTemplate)` 并派发 `template-loaded`。因此 Inspector 只读取运行时 `billTemplate` 实例上的最终 `this.template`，不重复请求模板接口，也不把中间合并结果当成最终生效配置。

### 两个 Collector 合并

最终模板和单据数据位于 `billTemplate`，`calendarData`、`standardAmountParamsObj`、`standardAmount`、`standardDates` 位于 `NEW_TRAVEL_BOE` 父组件。两个 local wrapper 分别注册 Collector，运行时根据 `boeTypeCode + boeId` 动态生成 `instanceId` 并合并，避免遍历 Vue component tree。

### Side Panel、Bridge 与 iframe

扩展以 Chrome Side Panel 为主入口，点击扩展图标后打开 `panel.html`。Side Panel 使用 `chrome.scripting.executeScript()` 在当前活动 Tab 的 `MAIN` world 调用固定 Bridge 方法；DevTools 入口继续使用 `chrome.devtools.inspectedWindow.eval()`。两种入口复用同一 UI 和 Bridge 客户端。Bridge 只返回 JSON-compatible 数据，不提供任意 JavaScript 执行入口。Adapter 在同源 iframe 中会同时把 Bridge 暴露给 `window.top`；跨域 iframe 首版明确不支持。

### 页面字段选择器

选择器只在用户主动开启时注册 capture 事件与临时 outline。字段身份来自现有 BOE DOM id：`areaCode.rowIndex.fieldCode`；`table-search` 使用 `labelCode` 渲染时，会回查最终模板并解析为真实 `fieldCode`。点击会阻止业务事件，选择完成、Esc、取消或 30 秒超时后立即清理监听与样式。

### 只读和副作用边界

- `dataFormat()` 默认不调用；只有项目完成副作用审计后，才能显式提供 `getFormattedBoeDto`。
- `checkStandard()`、`beforeSubmit()` 和未知校验函数永不由 Inspector 调用。
- 校验、计算和关联申请诊断只解析序列化配置，不调用 `validateRuleByDoCalculate`、`getCalculateValue`、`getComputedValue` 或 `transApplyBoeData`。
- `getDynamicConfig()` 仅允许项目显式传入，并始终接收字段浅拷贝；失败时记录 `evaluationError`。
- Promise 只记录元数据，不附加处理器。AI 请求在扩展侧执行，Key 不进入页面 Bridge；模型只提供建议，不执行代码或修改单据。详见[过程记录与 AI 分析](ai-diagnostics.md)。

### 规则诊断模型

`core` 将校验、计算、动态和关联申请配置转换为统一的只读诊断模型。模型区分 `issue`、`unverified` 和已有运行态 `ok`：只有非法配置、缺失字段、循环依赖、重复目标映射或三段快照明确不一致才进入正式问题；不能静态确认的执行结果保持未验证。Side Panel 负责折叠展示、筛选与字段定位，不在 UI 内重复业务解析。
