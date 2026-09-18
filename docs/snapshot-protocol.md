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
- `applyBoe`：可选的关联申请证据快照，包含最近一次源申请数据、转换结果及可选流程状态。
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
getAreaDetail(areaCode, instanceId?)
getFieldDetail(selection, instanceId?)
startFieldPicker()
getFieldPickerState()
cancelFieldPicker()
```

新增可选方法包括 `startPicker`、`locateSelection`、`startTrace`、`stopTrace`、`getTrace` 和 `clearTrace`，通过 `BridgeStatus.capabilities` 检测。具体签名与记录边界见[过程记录与 AI 分析](ai-diagnostics.md)。旧接口继续可用。

Bridge 不提供单据 setter、请求重放或任意表达式执行能力。过程控制仅修改 Inspector 自身状态。

### 字段配置定位与过程值

`FieldSelection.fieldIndex` 是可选的原始 `areaFields` 索引，用于区分同一区域内相同编码的配置项；`rowIndex` 仍表示运行时数据行。传入索引时同时校验字段编码，不匹配时返回未找到。未传索引的调用保持原有按编码查找行为。旧 Adapter 未返回索引时，面板可使用当前快照恢复指定配置项。

`TraceEvent.triggers` 是可选的触发字段数组，每项包含区域、字段、可用行号、值及来源：`argument` 表示字段更新的传入值，`entry-value` 表示方法进入时读取的源字段值，`event-before` 表示从同一事件已记录的源行进入时值恢复，`unavailable` 表示未采集。可选 `reason` 区分旧记录不支持、数据不可用、行号无效、区域或行缺失、字段缺失、读取失败。`triggerComputeMixin` 的第二个参数是行号，不是字段值；计算源字段与计算目标分别保留。一次更新最多采集 30 个触发字段，超出数量记录在 `triggersOmitted`，值沿用现有序列化限制。

过程记录可选保存会话级 `conditionDefinitions` 和事件级 `conditions`。条件定义包含稳定 `key`、可选规则标识、显示名称和已采集表达式；事件只保存条件 key 及本次结果，避免重复传输表达式。`conditions[0]` 是主条件，用于面板分组，其余条件作为同一事件的附加信息。旧 Adapter 和旧记录没有这些字段时，面板回退按 `category + method` 分组。

Adapter 可通过只读同步 `getTraceConditions` 回调提供运行时条件。回调异常、重入或超过 20 ms 时不影响业务方法；本次记录后续条件解析会降级或停用。Inspector 不执行表达式，也不保证能够中断业务方法内部不返回的同步死循环。

`trace-values` 能力标志表示支持触发值采集。`trace-incremental` 表示支持 `getTraceUpdate(cursor?)`：游标包含 `sessionId`、已接收的追加事件数量 `offset` 和是否已接收停止状态 `ended`。返回 `reset`、`eventOffset`、会话元数据及新增事件；初次读取或游标失效时同时返回开始快照，停止快照仅在首次读取停止状态时返回。偏移按追加顺序计算，不能用事件 ID 替代，因为嵌套调用先结束的事件可能具有更大的 ID。旧 `getTrace()` 保持全量读取。

`stopTrace(true)` 只停止而不返回全量记录，新面板随后读取最后一批增量；无参数的旧调用保持返回完整记录。旧 Adapter 没有增量能力时，面板继续使用旧接口。

过程采集的每次值序列化最多遍历 500 个节点、每个字符串最多 8,192 字符、累计字符串和键名最多 32,768 字符，保留截断标记；原有深度、集合数量、事件数和 5 MB 会话限制继续生效。同步调用深度超过 32 层或 1 秒内完成事件超过 300 条时，Inspector 停止采集并在 `stopDetail` 中记录保护原因，不改变原业务方法行为。面板按会话缓存字段索引和事件摘要，条件、区域和字段分组只保存事件引用，问题与事件列表每页最多展示 50 个条目，差异和原始 JSON 在展开后才计算。

这些新增字段不改变协议主版本。旧过程记录缺少当时值时不从当前或结束快照补值；查看新采集的触发时值需要更新 Adapter 并重新开始记录。

## 规则结果

每条规则输出 `passed`、`issue` 或 `skipped`。类别除 `field-config`、`travel-standard` 外，还包括 `validation-rule`、`calculation-rule`、`dynamic-rule` 和 `apply-boe`。`skipped` 用于 Snapshot 缺少确定性判断所需输入或不能静态确认执行结果，不计入正式问题数。`issue` 必须包含 `ruleId`、等级、摘要和证据路径，可选实际值、期望值、原因和建议。
