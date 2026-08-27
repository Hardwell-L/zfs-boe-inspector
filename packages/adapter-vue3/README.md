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

## 差旅组件

差旅单据同样应使用 `zfs-boe` 入口提供的 Mixin 或 Composable，使 Runtime 在采集器注册前自动安装：

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
