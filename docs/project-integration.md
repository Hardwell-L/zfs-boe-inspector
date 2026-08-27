# Vue3 BOE 项目接入

首版使用项目 local wrapper 接入，不修改 `node_modules`。项目只需直接安装 Adapter；`shared-types` 会由 npm 自动安装。

```bash
npm install @zfs-boe-inspector/adapter-vue3
```

## 1. Options API / Mixin

适用于现有 BOE 项目，也是湖北联投 4.2.0 当前采用的方式。在 local `billTemplate.vue` 中增加一个 Mixin：

```javascript
import { createBillTemplateInspectorMixin } from '@zfs-boe-inspector/adapter-vue3/zfs-boe';

export default {
  // 保留当前 extends、components、其他 mixins 和业务逻辑
  mixins: [createBillTemplateInspectorMixin()],
};
```

Mixin 会在 `mounted` 后注册最终 `this.template`，并在 `beforeUnmount` 自动注销。

## 2. Composition API / setup

适用于使用 Composition API 的 local wrapper：

```javascript
import { useBillTemplateInspector } from '@zfs-boe-inspector/adapter-vue3/zfs-boe';

export default {
  setup() {
    useBillTemplateInspector();
  },
};
```

Composable 必须在组件 `setup()` 内调用，同样会自动管理注册和注销生命周期。

## 3. 自动读取与可选覆盖

Mixin 和 Composable 均可零参数使用，并自动读取：

- `projectCode`：当前页面 `window.location.host`。
- `environment`：优先读取 `process.env.NODE_ENV`，否则按页面 host 推断。
- `vueVersion`：当前 Vue app 的版本。
- `@zfs/boe`：已安装包的版本。
- `@zfs/ui-plus`：`@zfs/boe` 声明的依赖版本。
- `areaConfig`、`fieldConfig`、`getDynamicConfig`：直接从已安装的 `@zfs/boe` 引入。

仅在自动值不符合项目识别要求时传入覆盖项：

```javascript
createBillTemplateInspectorMixin({
  projectCode: 'hblt-zfs-boe-prj',
});
```

当前 BOE 启动链路由 `@zfs/boe` 内部创建并挂载 Vue app，因此不要求、也不建议只在项目 `main.js` 中执行 `app.use()`。

不要默认传入 `getFormattedBoeDto: () => this.dataFormat()`。只有逐分支确认目标版本的 `dataFormat()` 不请求接口、不弹窗且不修改状态后，才允许显式开启。

如需定位关联申请在“源申请数据 → 转换结果 → 当前字段值”中的具体阶段，可选传入只读快照回调：

```javascript
createBillTemplateInspectorMixin({
  getApplySnapshot: () => ({
    lastApplyBoeData: this.lastApplyBoeData,
    lastTransData: this.lastTransData,
    flowStatus: this.lastApplyFlowStatus,
  }),
});
```

未配置回调时仍会展示模板 `dataTrans` 和当前单据值；回调抛错只会写入 Snapshot warning，不影响页面。回调必须直接返回宿主页面已经持有的证据，不应在其中请求接口或重新执行 `transApplyBoeData`。

## 4. NEW_TRAVEL_BOE.vue 注册差旅数据

差旅组件应使用 `zfs-boe` 入口提供的 Mixin 或 Composable。它会先安装 Runtime，再注册差旅采集器，避免父组件 mounted 早于 billTemplate 子组件时出现 Runtime 未安装异常：

```javascript
import { createTravelInspectorMixin } from '@zfs-boe-inspector/adapter-vue3/zfs-boe';

export default {
  // 保留当前 extends、components、beforeSubmit 和其他业务逻辑
  mixins: [createTravelInspectorMixin()],
};
```

Composition API 使用方式：

```javascript
import { useTravelInspector } from '@zfs-boe-inspector/adapter-vue3/zfs-boe';

export default {
  setup() {
    useTravelInspector();
  },
};
```

底层 `attachTravelInspector()` 仍可使用，但调用前必须先通过 `installBoeInspector()` 安装 Runtime；普通 local wrapper 推荐使用上面的 Mixin 或 Composable。

Adapter 只读取 `calendarData`、`standardAmountParamsObj`、`standardAmount`、`standardDates` 和可用汇总；不会调用 `checkStandard()`。

## 5. 验证接入

1. 启动 BOE 项目并打开一张 `NEW_TRAVEL_BOE` 单据。
2. 在 Console 执行只读检查：`window.__ZFS_BOE_INSPECTOR__.getStatus()`。
3. 打开浏览器 Side Panel 的 `BOE Inspector`，确认状态为“已连接”。
4. 刷新 Snapshot，确认模板字段数和页面一致。
5. 在“字段配置”中点击区域名称，确认按 `boeDesign areaConfig` 展示区域基本、高级和原始配置。
6. 通过“选择页面字段”分别选择普通字段、table-search 字段和明细行字段。
7. 确认选择期间只增加边框与遮罩，不改变原页面内容；选择完成后跳转到对应字段。
8. 打开差旅标准页，核对当前人员标准和请求元数据，且 Inspector 没有新增业务 Network 请求。
9. 导出 JSON，确认问题均带有证据路径。
