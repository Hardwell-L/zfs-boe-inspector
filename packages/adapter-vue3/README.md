# @zfs-boe-inspector/adapter-vue3

ZFS BOE Vue3 Runtime Adapter，用于从真实 BOE 页面采集最终模板、区域配置、字段配置和差旅标准运行时数据。

## 安装

```bash
npm install @zfs-boe-inspector/adapter-vue3
```

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
