# @zfs-boe-inspector/adapter-vue3

ZFS BOE Runtime Adapter，用于从真实 BOE 页面采集最终模板、字段值、区域/字段配置和可用的差旅运行时数据。统一入口会根据宿主 Vue 和 BOE 结构自动选择高版本或低版本基础模式；低版本缺失的增强能力会标记为未采集，不影响业务页面。

## 安装

```bash
npm install @zfs-boe-inspector/adapter-vue3
```

BOE 宿主版本范围为 `3.x`、`4.x`，包括 `4.2.0-4`、`4.1.2-100`、`3.3.0-beta.1` 等项目后缀版本。宿主项目需自行安装 `@zfs/boe`；Adapter 不声明该包的 npm peer 约束，以避免预发布后缀导致安装冲突。`/zfs-boe` 入口在注册采集前校验宿主主版本，其他版本或无法识别的版本会提示并跳过采集；具体采集能力仍取决于宿主结构和所选入口。

## Options API / Mixin

```js
import { createBillTemplateInspectorMixin } from '@zfs-boe-inspector/adapter-vue3/zfs-boe';

export default {
  mixins: [createBillTemplateInspectorMixin()],
};
```

## Composition API / setup

```js
import { useBillTemplateInspector } from '@zfs-boe-inspector/adapter-vue3/zfs-boe';

export default {
  setup() {
    useBillTemplateInspector();
  },
};
```

两种方式都支持可选的 `projectCode` 等元数据覆盖，并自动管理注册和注销生命周期。关联申请三段对比可选传入 `getApplySnapshot(component)`；未传入时仍保留模板映射和当前值诊断，回调异常只生成采集 warning。

Vue2.6/2.7 项目使用同一个 Mixin 导入，无需安装 Composition API 插件。低版本默认提供最终模板、原始数据、字段值和可定位字段；运行态字段扫描、过程记录和无法确认请求历史的差旅规则会按能力降级。Vue3 原有 Mixin、Composable、动态配置和过程记录行为保持不变。

同一导入路径会由宿主构建器选择入口：支持 `exports` 的构建器进入 Vue3 高版本入口，webpack 4 的物理子路径进入 Vue2 基础入口；业务代码不需要手动选择版本。

需要提供过程记录业务条件时，可传入只读同步 `getTraceConditions({ eventId, method, args, component, instanceId })`，返回带 `definition.key`、可选 `ruleId`/`label`/`expression` 和 `result` 的条件数组。第一个条件作为主分组条件；不要在回调中调用被观察方法或执行异步操作。回调异常、重入或超过约 20 ms 会自动降级，不影响 BOE 原方法。

## 差旅组件自动发现

通用 Mixin 或 Composable 会从 `billTemplate` 向上定位标准差旅宿主，自动注册 Travel Collector。标准项目不需要逐个修改差旅 wrapper。

组件结构经过定制时，可以显式指定差旅宿主：

```js
createBillTemplateInspectorMixin({
  resolveTravelComponent: (billTemplate) => billTemplate.$parent,
});
```

传入 `autoTravelCollector: false` 可关闭自动发现。旧项目已有的差旅 Mixin 或 Composable 继续兼容：

```js
import { createTravelInspectorMixin } from '@zfs-boe-inspector/adapter-vue3/zfs-boe';

export default {
  mixins: [createTravelInspectorMixin()],
};
```

```js
import { useTravelInspector } from '@zfs-boe-inspector/adapter-vue3/zfs-boe';

export default {
  setup() {
    useTravelInspector();
  },
};
```

底层 `attachTravelInspector` 需要先调用 `installBoeInspector` 安装 Runtime，普通 BOE local wrapper 不建议直接调用。

## License

Proprietary software. See `LICENSE`.
