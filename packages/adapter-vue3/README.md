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

两种方式都支持可选的 `projectCode` 等元数据覆盖，并自动管理注册和注销生命周期。

## License

Proprietary software. See `LICENSE`.
