# 规则开发

## 首版 Rule Pack

规则包包含以下 category：

- `field-config`：最终字段结构、运行时路径、显示/编辑/必填、动态配置、数据源、`trans`、前后置/级联、默认值、计算依赖、链接、导入和函数元数据。
- `travel-standard`：日期、标准请求、缓存/结果、地点 key、业务类型、去重、逐日汇总、控制等级、补贴地点及人员一致性。
- `validation-rule`：校验规则 JSON、控制节点、触发条件、表达式依赖和当前值。
- `calculation-rule`：`calculate/computed` 配置、条件分支、字段依赖和循环依赖。
- `dynamic-rule`：区域/字段动态配置与已采集的显示、编辑、必填运行态。
- `apply-boe`：新旧 `dataTrans`、重复目标映射及可选三段快照一致性。

静态配置解析遵循当前 BOE 已支持的 JSON、`${area.field}`、`${field#type}` 和依赖字段表达方式。不要扩展一个当前产品并未使用的新公式语法。

## 规则约束

字段警告规则检查 `FIELD_WARNING_RULE_MISSING` 将非空字符串 `field.warning` 与宿主采集的 `config.warningRuleNames` 精确匹配，未注册时报 `error`，证据指向字段的 `warning` 配置。规则名由适配器读取宿主的 `config/warning`，不硬编码内置规则名单，也不执行 `validateFunc`。已解析的对象规则不参与名称匹配；旧 Snapshot 或无法读取注册表时返回 `skipped`。通用采集器可通过 `warningRules` 传入项目实际使用的注册表。

1. 规则必须是纯函数，不修改 Snapshot。
2. 证据不足时返回 `skipped`，禁止按经验猜测 `issue`。
3. 不请求接口，不调用业务 validator，不执行函数型配置。
4. 同一规则可针对多个字段输出多条 `issue`；无问题时输出一条 `passed`。
5. 金额比较保留 0.01 容差；日期先规范为 `YYYY-MM-DD`。
6. 新增规则必须同时增加 passed/issue/skipped 中适用分支的 fixture。

## 新增规则

在 `packages/rule-base/src` 中实现 `RuleEvaluator` 并加入 `baseRuleEvaluators`。建议 ID 格式：

```text
FIELD_<对象>_<问题>
TRAVEL_<对象>_<问题>
```

运行：

```bash
pnpm test
pnpm typecheck
pnpm lint
```
