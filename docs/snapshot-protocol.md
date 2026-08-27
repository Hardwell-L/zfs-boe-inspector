# Snapshot 与 Bridge 协议

协议定义位于 `packages/shared-types/src/index.ts`，当前 `schemaVersion = 1`、`apiVersion = 1`。

## Snapshot

`BoeInspectionSnapshot` 由以下部分组成：

- `meta`：项目、环境、Adapter/Vue/ZFS 版本及单据身份。
- `runtime`：只读 `rawBillData`；格式化 DTO 默认标记为 `skipped`。
- `config.template`：运行时最终生效模板。
- `config.areaDescriptors`：由 `boeDesign` 的 `areaConfig` 净化得到的区域属性描述。
- `config.fieldDescriptors`：由 `boeDesign` 的 `fieldConfig` 净化得到的字段属性描述。
- `config.fieldRuntimeStates`：使用受信任 `getDynamicConfig` 对字段浅拷贝计算出的显示/编辑/必填状态。
- `travel`：当前人员、行程、标准请求元数据、结果、缓存日期和汇总；`standardDates` 同时兼容字符串和 BOE 运行时对象结构。
- `warnings`：采集失败但不影响其余 Snapshot 的信息。

## 序列化

跨 DevTools 边界前统一转换为 JSON-compatible 数据：

- `function` → `{ "__kind": "function", "name": "...", "length": 0 }`
- `Promise` → `{ "__kind": "promise", "status": "unknown" }`
- 循环引用 → `{ "__kind": "circular", "reference": "$.path" }`
- 异常 getter → `{ "__kind": "unreadable", "message": "..." }`
- `Date` → ISO string；`Map`、`Set` 保留显式类型元数据。

默认深度、数组和对象 key 数均有限制，避免异常业务对象拖垮 DevTools。

## Bridge

页面只暴露以下固定方法：

```typescript
getStatus()
getSnapshot(instanceId?)
getFieldDetail(selection, instanceId?)
startFieldPicker()
getFieldPickerState()
cancelFieldPicker()
```

Bridge 不提供 setter、请求重放或任意表达式执行能力。

## 规则结果

每条规则输出 `passed`、`issue` 或 `skipped`。`skipped` 用于 Snapshot 缺少确定性判断所需输入，不计入正式问题数。`issue` 必须包含 `ruleId`、等级、摘要和证据路径，可选实际值、期望值、原因和建议。
