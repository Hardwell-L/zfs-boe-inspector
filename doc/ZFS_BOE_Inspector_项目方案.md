# ZFS BOE Inspector 项目方案

> 文档状态：MVP 实施基线
> 当前阶段：工程、Adapter、Extension 与首版规则已实现，待目标项目接入后完成 Chrome 联调
> 产品名称：ZFS BOE Inspector
> 中文名称：BOE 配置诊断台

> 2026-08-27 实施说明：首版 Rule Engine 只包含“单据字段配置”和“差旅标准”两类规则；模板来源冻结为 `getBillTemplate.js` 初始化链完成后的最终 `this.template`；字段属性展示复用 `boeDesign.vue` 的 `fieldConfig` 描述分组。AI 仅保留 TypeScript 协议，不发起真实请求。当前实现和接入说明见根目录 `README.md`、`docs/architecture.md` 与 `docs/project-integration.md`。

## 1. 项目背景

ZFS BOE 项目在不同客户、不同单据类型和不同版本中，通常存在大量字段配置、数据源配置、校验规则、差旅规则以及项目级 local wrapper 扩展。

开发人员和实施人员排查问题时，需要同时确认：

- 当前页面实际运行的是哪个 BOE 组件。
- 当前单据的运行时数据是什么。
- 哪些字段配置和校验规则真正生效。
- 配置经过继承、覆盖和运行时转换后的最终结果。
- 差旅标准请求、逐日标准、缓存和汇总过程是否一致。
- 问题属于配置错误、运行时数据异常，还是组件处理链异常。

目前这些信息分散在 Vue 组件、ZFS 依赖、local wrapper、单据数据和浏览器调试工具中，缺少统一、只读、可解释的诊断工具。

ZFS BOE Inspector 的目标是提供一个面向开发人员和实施人员的 Chrome DevTools 诊断面板，从当前 BOE 页面采集运行时数据，展示实际生效配置，并通过确定性规则和可选大模型能力检查常见问题。

## 2. 产品定位

ZFS BOE Inspector 是一个只读诊断工具，不是 BOE 配置平台。

### 2.1 目标用户

- ZFS BOE 开发人员。
- 项目实施人员。
- 测试及问题排查人员。

### 2.2 核心能力

- 查看当前 BOE 单据的运行时数据。
- 查看实际生效的字段、数据源、校验和差旅配置。
- 对原始单据数据与格式化提交数据进行对比。
- 检查常见配置冲突和运行时数据不一致。
- 展示差旅标准的请求、匹配、汇总和异常证据链。
- 导出诊断结果。
- 后续通过 DeepSeek 等模型提供辅助分析。

### 2.3 非目标

- 不创建或维护 BOE 配置。
- 不修改 BOE 配置。
- 不修改运行时单据数据。
- 不替代项目已有的提交校验。
- 不在首版建设后台服务、规则管理平台或数据库。
- 不在首版自动修复代码或配置。

## 3. 已确认的产品决策

| 决策项 | 当前结论 |
|---|---|
| 产品名称 | ZFS BOE Inspector |
| 产品形态 | Chrome DevTools Extension |
| 系统形态 | 纯前端，不建设后台服务 |
| 首批 Framework | Vue3 |
| Vue2 | 预留独立 Adapter 扩展口 |
| 首批终端 | PC |
| H5 | 后续版本考虑 |
| DevTools 面板 | 只注册一个 `BOE Inspector` Panel |
| 项目接入方式 | `main.js` 安装插件，`billTemplate.vue` 注册当前 BOE 上下文 |
| 数据来源 | 当前页面的运行时单据数据及实际生效配置 |
| 配置职责 | Inspector 只读取和检查，不参与配置 |
| 生产环境 | 允许安装 Chrome Extension |
| Extension 权限 | 可给予较宽权限，但产品能力保持只读 |
| 数据脱敏 | 当前不考虑，使用者仅为开发和实施人员 |
| AI 能力 | 预留 DeepSeek 等模型的可配置 Provider |

## 4. 总体架构

```text
Vue3 BOE 页面
  ├─ main.js 安装 Runtime Adapter
  └─ billTemplate.vue 注册当前 BOE 实例
             ↓
      Runtime Snapshot
             ↓
Chrome DevTools Extension
  ├─ BOE Inspector 单一 Panel
  ├─ Snapshot 标准化
  ├─ 确定性 Rule Engine
  ├─ 配置与差旅诊断
  ├─ 报告导出
  └─ 可选 Model Provider
             ↓ 用户主动触发
      DeepSeek / 其他模型 API
```

整个链路保持纯前端：

- Runtime Adapter 随 BOE 项目构建。
- Extension 在浏览器本地运行。
- Rule Engine 在 Extension 内执行。
- 模型请求由 Extension Background Service Worker 直接发起。
- 不依赖独立服务端。

## 5. 模块划分

### 5.1 项目侧 Runtime Adapter

建议作为独立 npm 包：

```text
@company/zfs-boe-inspector-adapter-vue3
```

职责：

- 在 Vue3 项目中安装 Inspector Bridge。
- 注册和注销当前 BOE 实例。
- 从真实 `billTemplate` 上下文生成 Snapshot。
- 屏蔽不同 ZFS Vue3 版本的数据位置差异。
- 只暴露读取能力，不暴露修改方法。

后续 Vue2 通过独立包接入：

```text
@company/zfs-boe-inspector-adapter-vue2
```

Vue2 和 Vue3 Adapter 应输出相同的 Snapshot 协议，使 Extension 和 Rule Engine 无需感知 Framework 差异。

### 5.2 Rule Engine

建议作为无 Vue 依赖的独立前端包：

```text
@company/zfs-boe-inspector-core
```

职责：

- 标准化 Snapshot。
- 执行确定性检查规则。
- 输出问题等级、说明、实际值、预期值和证据路径。
- 支持单元测试。
- 为 AI 检查构造基础诊断结果。

### 5.3 Chrome Extension

Extension 是开发和实施人员实际安装的产品。

建议采用 Manifest V3，包含：

- DevTools Page：注册唯一的 `BOE Inspector` Panel。
- Panel App：承载全部诊断 UI。
- Bridge：连接当前 inspected page 和 Runtime Adapter。
- Background Service Worker：处理模型 HTTP 请求和本地设置。
- `chrome.storage.local`：保存用户设置和模型配置。

## 6. 项目接入设计

### 6.1 main.js

`main.js` 负责安装基础插件：

- 初始化 Inspector Bridge。
- 提供项目编码和环境信息。
- 管理 BOE 实例注册表。
- 响应 Extension 的连接和 Snapshot 请求。

接口示意：

```javascript
app.use(BoeInspector, {
  projectCode: 'project-code',
  environment: import.meta.env.MODE,
});
```

以上是拟定接口，不代表当前 ZFS 已存在该 API。最终接入方式需要在首个真实 Vue3 BOE 项目中确认。

### 6.2 billTemplate.vue

`billTemplate.vue` 负责注册当前单据上下文，因为只有该层或其实际父子组件链能够稳定获得：

- 当前 BOE 类型和状态。
- 原始单据数据。
- 实际生效配置。
- 校验配置。
- 差旅行程和标准数据。
- 格式化提交 DTO。

推荐生命周期：

```text
billTemplate mounted
    ↓
注册当前 BOE 实例
    ↓
Extension 请求 Snapshot
    ↓
实时生成只读数据副本
    ↓
billTemplate unmounted
    ↓
注销当前实例
```

只依赖 `main.js` 全局安装而不注册 `billTemplate` 上下文，会迫使 Extension 遍历 Vue component tree 或猜测 store 结构，生产环境下不够稳定。

## 7. Runtime Snapshot 协议

Snapshot 需要与具体 Vue 组件实现解耦，并同时保留原始数据和处理后数据。

协议草案：

```typescript
interface BoeInspectionSnapshot {
  meta: {
    projectCode: string;
    environment: string;
    adapterVersion: string;
    zfsPackages: Record<string, string>;
    boeTypeCode?: string;
    boeStatus?: string;
    operationTypeCode?: string;
    sourceSystemCode?: string;
    pageMode?: string;
  };

  runtime: {
    rawBillData: unknown;
    formattedBoeDto?: unknown;
  };

  config: {
    billConfig?: unknown;
    fieldConfigs?: unknown[];
    validationConfigs?: unknown[];
    dataSourceConfigs?: unknown[];
    travelConfigs?: unknown[];
  };

  travel?: {
    trips?: unknown[];
    calendarData?: unknown[];
    standardRequests?: unknown[];
    standardResults?: unknown[];
    standardCache?: unknown;
    standardSummary?: unknown;
  };
}
```

首个项目接入后，需要基于真实源码确认：

- 每类数据的真实来源。
- 是否存在循环引用。
- 是否需要处理 Vue Proxy。
- 哪些字段无法序列化。
- 格式化 DTO 的获取是否会产生副作用。
- Snapshot 生成时机和数据一致性。

## 8. 单一 DevTools Panel 设计

Extension 只注册一个：

```text
BOE Inspector
```

所有功能在 Panel 内部通过菜单切换。

```text
┌──────────────────────────────────────────────┐
│ BOE Inspector   已连接  CL02  状态：25       │
│ [刷新快照] [执行检查] [AI 检查] [导出报告]   │
├──────────────┬───────────────────────────────┤
│ 单据概览     │                               │
│ 运行时数据   │         当前功能内容          │
│ 配置检查     │                               │
│ 校验规则     │                               │
│ 差旅标准     │                               │
│ 问题列表     │                               │
│ AI 检查      │                               │
│ 设置         │                               │
└──────────────┴───────────────────────────────┘
```

### 8.1 单据概览

- 项目编码和环境。
- BOE 类型、状态、操作类型和来源系统。
- Vue、ZFS、Adapter、Rule Pack 版本。
- Runtime Adapter 连接状态。
- 当前活动 BOE 实例。

### 8.2 运行时数据

- 原始单据数据树。
- 格式化提交 DTO。
- 字段名称和值搜索。
- 字段路径复制。
- 原始值和格式化值对比。

### 8.3 配置检查

- 字段配置。
- 数据源配置。
- `trans` 配置。
- 显示、必填、只读配置。
- 校验配置。
- 差旅配置。
- 配置来源和覆盖关系。

### 8.4 校验规则

- 当前配置了哪些校验。
- 是否满足执行条件。
- 校验依赖哪些字段。
- 当前运行时字段值。
- 是否可以静态分析。
- 已执行校验的运行时结果。

### 8.5 差旅标准

- 行程明细。
- 每日标准请求。
- 每日标准返回结果。
- 缓存状态。
- 匹配项和控制等级。
- 去重及汇总过程。
- 缺失日期和异常证据。

### 8.6 问题列表

统一展示确定性 Rule Engine 结果：

```text
ERROR  TRAVEL_STANDARD_DATE_MISSING

日期 2026-07-15 已进入请求缓存，但标准结果不存在。

证据：
travel.cachedDates[4] = "2026-07-15"
travel.standardResults["上海_2026-07-15"] = undefined

影响：
住宿标准汇总金额可能偏低。
```

### 8.7 AI 检查

- 显示即将发送给模型的上下文。
- 用户主动触发检查。
- 展示模型建议和置信度。
- AI 结果与确定性结果分开展示。

### 8.8 设置

- Inspector 基础设置。
- Snapshot 显示设置。
- Model Provider 配置。
- API Key 配置。
- 请求超时和输出长度配置。

## 9. 首批确定性规则

### 9.1 字段与配置规则

- 配置字段在运行时数据中不存在。
- 必填字段同时被隐藏。
- 必填字段不可编辑且没有可用默认值。
- `trans.from` 字段不存在。
- `trans.to` 字段不存在。
- 嵌套字段路径被按普通字符串 key 读取。
- 数据源返回字段未声明在 `trans` 中，选择后被转换层丢弃。
- 单据状态配置存在数字和字符串比较不一致。
- 多选配置返回分隔字符串，但业务逻辑按 Array 处理。
- 配置引用了不存在的组件、field code 或明细区域。

### 9.2 实际生效配置规则

- local wrapper 存在，但组件注册仍然指向依赖组件。
- 页面 import、alias 或注册链绕过了项目 local wrapper。
- 父子 watcher 同时执行，导致项目配置没有真正覆盖父逻辑。
- 本地 method 覆盖父 method 后遗漏必要父级行为。
- 页面配置值与格式化提交 DTO 不一致。
- 同一字段存在多个配置来源，最终覆盖结果不明确。

### 9.3 差旅规则

- 行程日期缺失、重复或顺序异常。
- 每个差旅日期是否都有标准请求。
- 标准请求日期与返回日期不一致。
- 请求缓存存在日期，但标准结果缺少该日期。
- `staySite + expenseDate` 无法命中标准。
- 指定标准类型在过滤、去重过程中丢失。
- 去重前后数量异常。
- 汇总金额不能由逐日标准重新计算得到。
- `ALLOW/WARNING/FORBID` 控制等级汇总异常。
- 当天往返和跨天返程的补贴地点选择异常。
- 行程人员与报账人员不一致。
- 提交前差旅校验顺序或返回值无效。

规则正式实现前，必须基于目标 Vue3 项目的真实数据结构、已安装 ZFS 依赖和运行时结果确认，不应只根据规则名称猜测实现。

## 10. 规则结果协议

```typescript
interface DiagnosticResult {
  ruleId: string;
  category: 'config' | 'validation' | 'travel' | 'runtime';
  severity: 'info' | 'warning' | 'error';
  summary: string;
  reason?: string;
  expected?: unknown;
  actual?: unknown;
  evidencePaths: string[];
  suggestion?: string;
}
```

每个问题必须尽可能提供：

- 问题是什么。
- 为什么判定为问题。
- 实际值。
- 预期值。
- 对应数据路径。
- 可能影响。
- 建议排查位置。

## 11. 函数型配置处理边界

BOE 配置中可能存在 function、computed、watcher 和异步校验方法，这些内容无法像普通 JSON 一样直接传递给 Extension。

首版按以下方式处理：

1. JSON 型配置由 Rule Engine 直接检查。
2. function 型配置只采集方法名称、所属组件和可识别元数据。
3. 已经由 BOE 页面执行的校验结果，可以由 Adapter 收集后展示。
4. Inspector 不主动调用未知校验函数，避免触发弹窗、接口请求和数据修改。
5. 无法分析的配置明确标记为“需要运行时观察”或“需要人工检查”。

## 12. AI 模型扩展

### 12.1 定位

AI 是 Rule Engine 的补充，不替代确定性检查。

确定性规则负责：

- 可明确判断的问题。
- 稳定、可测试的结果。
- 正式问题数量和等级。

AI 负责：

- 多个配置之间的潜在逻辑冲突。
- 当前数据没有命中配置的可能原因。
- 差旅标准计算链的综合分析。
- 根据历史问题模式提供排查建议。
- 对复杂问题进行自然语言解释。

界面应明确区分：

```text
确定性问题：5 个
AI 建议：3 个
```

### 12.2 Provider 接口

```typescript
interface ModelProvider {
  id: string;
  name: string;

  check(
    context: ModelInspectionContext,
    options: ModelRequestOptions,
  ): Promise<ModelDiagnosticResult[]>;
}
```

未来可以实现：

```text
DeepSeekProvider
CustomModelProvider
```

不同模型通过各自 Provider 处理请求构造和响应解析，Panel 不直接依赖具体厂商协议。

### 12.3 模型配置

```typescript
interface ModelSettings {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeout: number;
  maxOutputTokens: number;
}
```

建议存储在 `chrome.storage.local`。

### 12.4 调用流程

```text
刷新当前 Snapshot
    ↓
执行本地 Rule Engine
    ↓
生成 AI 检查上下文
    ↓
展示即将发送的数据范围
    ↓
用户确认
    ↓
Background Service Worker 请求模型
    ↓
解析结构化结果
    ↓
显示为 AI 建议
```

### 12.5 AI 结果协议

```typescript
interface ModelDiagnosticResult {
  category: string;
  severity: 'info' | 'warning';
  summary: string;
  reason: string;
  evidencePaths: string[];
  suggestion: string;
  confidence: number;
}
```

AI 结果不直接产生确定性的 `error`，也不能修改配置或单据数据。

## 13. API Key 与模型请求

当前系统为纯前端，因此需要明确以下边界：

- API Key 不写死在 Extension 源码或构建产物中。
- 使用者自行配置 API Key。
- API Key 保存到 `chrome.storage.local`。
- API Key 不传递给 BOE 页面。
- API Key 不写入日志和导出报告。
- 不适合在 Extension 中内置多人共享的公司级密钥。

模型请求建议从 Background Service Worker 发起：

```text
DevTools Panel
    ↓ chrome.runtime.sendMessage
Background Service Worker
    ↓ fetch
Model API
```

Background 统一处理：

- `host_permissions`。
- API Key。
- 超时和取消。
- 错误码。
- 重试策略。
- 流式响应。
- 结构化结果解析。

## 14. 权限和数据边界

生产环境允许安装具有较宽权限的 Extension，但产品能力仍保持只读。

原因：

- 修改单据会改变被诊断对象，导致结果不可信。
- 接口重放可能产生生产数据影响。
- 任意 JavaScript 执行会扩大误操作范围。

首版禁止：

- 修改 BOE 数据。
- 修改配置。
- 自动调用提交、保存或删除接口。
- 请求重放。
- 任意 JavaScript 执行入口。

BOE 数据默认只在当前页面和 Extension 本地内存中流转。除手动导出或用户主动调用模型外，不上传外部系统。

当前不做字段脱敏，但调用外部模型时应明确展示即将发送的数据范围，由用户主动确认。

## 15. MVP 范围

### 15.1 首版包含

- Vue3。
- PC。
- 纯前端实现。
- 一个 `BOE Inspector` DevTools Panel。
- `main.js` 安装 Runtime Adapter。
- `billTemplate.vue` 注册运行时上下文。
- 单个活动 BOE 实例。
- 原始单据数据查看。
- 格式化 DTO 查看和对比。
- 字段、状态、`trans` 和数据源配置检查。
- 差旅标准逐日检查和汇总检查。
- 问题证据链。
- JSON 诊断报告导出。
- Model Provider、AI 上下文和结果协议预留。

### 15.2 首版暂不包含

- Vue2。
- H5。
- 后端服务。
- 配置管理平台。
- 配置编辑。
- 自动修复。
- 自动触发 AI。
- 多标签页联合诊断。
- 服务端报告存储。
- 集中式 API Key 管理。

## 16. 推荐项目结构

可以先采用 Monorepo：

```text
zfs-boe-inspector/
├─ apps/
│  └─ extension/
│     ├─ src/devtools/
│     ├─ src/panel/
│     ├─ src/background/
│     ├─ src/bridge/
│     └─ manifest.json
├─ packages/
│  ├─ adapter-vue3/
│  ├─ core/
│  ├─ rule-base/
│  └─ shared-types/
├─ docs/
│  ├─ architecture.md
│  ├─ snapshot-protocol.md
│  ├─ rule-development.md
│  └─ project-integration.md
├─ examples/
│  └─ vue3-boe-integration/
├─ package.json
└─ README.md
```

是否使用 pnpm workspace、npm workspace 或其他工具，应结合团队现有规范决定，不在未检查实际环境时预设。

## 17. Implementation Plan

### 阶段一：真实项目证据梳理

1. 选择一个 Vue3 PC BOE 项目。
2. 确认 Vue、ZFS、构建工具和状态管理版本。
3. 梳理 `main.js` 安装链。
4. 梳理 BOE 组件注册和 local wrapper。
5. 梳理 `billTemplate.vue` 的数据、配置和生命周期。
6. 梳理差旅标准请求、缓存、结果和汇总链。
7. 确认格式化提交 DTO 的安全读取方式。

### 阶段二：协议设计

1. 完成 Snapshot 协议。
2. 完成 DiagnosticResult 协议。
3. 定义 Bridge 请求和响应协议。
4. 定义 Adapter 版本兼容机制。
5. 定义不可序列化数据的处理策略。

### 阶段三：最小 Extension

1. 创建 Manifest V3 Extension。
2. 注册唯一的 `BOE Inspector` Panel。
3. 完成连接状态和 Snapshot 获取。
4. 完成运行时数据树展示。
5. 完成刷新和导出功能。

### 阶段四：规则引擎

1. 实现 Rule Engine 基础框架。
2. 实现字段和 `trans` 检查。
3. 实现状态类型检查。
4. 实现配置冲突检查。
5. 为每条规则增加确定性测试数据。

### 阶段五：差旅标准诊断

1. 接入 `NEW_TRAVEL_BOE` 运行时数据。
2. 展示行程和逐日标准。
3. 检查请求、缓存和结果一致性。
4. 检查标准匹配、去重和汇总结果。
5. 输出完整证据链。

### 阶段六：AI 能力

1. 实现 Model Provider 接口。
2. 实现设置页面和 API Key 存储。
3. 实现 Background 模型请求。
4. 实现 AI 上下文预览和用户确认。
5. 实现结构化结果解析。
6. 将 AI 建议与确定性问题分开展示。

### 阶段七：Vue2 和 H5

1. 在 Snapshot 协议稳定后实现 Vue2 Adapter。
2. 保持 Extension 和 Rule Engine 不变。
3. 后续基于 H5 实际数据源增加 H5 Adapter。

## 18. MVP 验收标准

满足以下条件可认为首版 MVP 完成：

1. Extension 能在 Chrome DevTools 中显示唯一的 `BOE Inspector` Panel。
2. 打开受支持的 Vue3 PC BOE 页面时能够识别当前单据。
3. 能够读取并展示原始单据数据和格式化 DTO。
4. 能够展示首批实际生效配置。
5. 能够执行字段、状态、`trans` 和数据源基础检查。
6. 能够展示差旅逐日标准、缓存、结果和汇总。
7. 每个问题包含明确证据路径。
8. Inspector 不修改单据、配置或接口数据。
9. 能够导出本次 Snapshot 和诊断结果。
10. 未接入模型时，所有核心诊断能力仍可独立运行。

## 19. 当前风险

### 19.1 ZFS 版本差异

不同 Vue3 ZFS 项目中的组件注册、数据位置和 local wrapper 结构可能不同。Adapter 必须基于真实项目建立版本兼容层，不能假设所有项目结构一致。

### 19.2 实际生效配置难以直接获取

配置可能经过组件继承、computed、watcher 和运行时转换。首版应优先展示可验证的数据和最终结果，对无法还原的部分明确标记，不制造确定性结论。

### 19.3 Snapshot 副作用

某些格式化或校验方法可能会修改状态、弹窗或请求接口。Adapter 不能为了采集数据主动调用具有未知副作用的方法。

### 19.4 函数无法序列化

function 型配置无法直接跨 Extension Bridge 传递，需要通过元数据和运行时结果逐步覆盖。

### 19.5 纯前端 API Key

本机使用者可以读取自己保存的模型 API Key。纯前端版本不适合保存多人共享的高权限密钥。

### 19.6 AI 误判

AI 结果只能作为建议，必须与确定性规则结果分开，不能直接触发修复或业务操作。

## 20. 启动新项目需要的输入

开始实现前，需要提供一个首批 Vue3 BOE 项目：

1. 项目绝对路径。
2. 优先支持的 BOE 类型，建议从 `NEW_TRAVEL_BOE` 开始。
3. 对应的 `main.js`、`billTemplate.vue` 和 local wrapper。
4. 当前安装的 `@zfs` package 和版本。
5. 一份可在浏览器中复现的单据配置与差旅标准数据。

首轮只读分析链路：

```text
main.js 安装
→ BOE 组件注册
→ billTemplate 实例
→ 单据数据来源
→ 配置加载
→ 差旅标准请求
→ 标准缓存
→ 标准汇总
→ beforeSubmit 校验
```

完成真实项目分析后，再冻结 Runtime Adapter API、Snapshot 协议和首批规则，避免新项目从未经验证的假设开始。
