# ZFS BOE Inspector

ZFS BOE Inspector 是面向开发和实施人员的只读 Chrome Side Panel 扩展，同时保留 DevTools Panel 兼容入口。当前检查以下问题：

- 单据最终生效的字段配置，包括显示、编辑、必填、数据源、`trans`、级联和计算依赖。
- 差旅标准的日期、请求、缓存、结果、去重、汇总和控制等级一致性。
- 校验、计算和动态规则的配置完整性、字段依赖、循环依赖与已有运行态。
- 关联申请的 `dataTrans` 映射、当前单据值，以及可选的源申请数据、转换结果和当前值三段对比。

Inspector 不修改单据或配置，不调用提交/保存/删除接口，不重放数据源，也不执行校验、计算、关联申请转换或未知函数型配置。

## 工程要求

- Node.js `>=22.12.0`，仓库提供 `.nvmrc`。
- pnpm `10.14.0`。
- Chrome/Chromium `114+`，Manifest V3 与 Side Panel API。

## 本地开发

```bash
nvm use
pnpm install
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

构建产物位于 `apps/extension/dist`。在 Chrome 的 `chrome://extensions` 中开启开发者模式，选择“加载已解压的扩展程序”，加载该目录。打开已接入 Adapter 的 BOE 页面后点击扩展图标，即可在浏览器 Side Panel 中使用；也可以在 DevTools 中选择 `BOE Inspector`。

## BOE 项目接入

只需要安装 Adapter，`shared-types` 会作为依赖自动安装：

```bash
npm install @zfs-boe-inspector/adapter-vue3
```

在 BOE 项目的 local `billTemplate.vue` 中选择一种方式接入：

```javascript
import { createBillTemplateInspectorMixin } from '@zfs-boe-inspector/adapter-vue3/zfs-boe';

export default {
  mixins: [createBillTemplateInspectorMixin()],
};
```

```javascript
import { useBillTemplateInspector } from '@zfs-boe-inspector/adapter-vue3/zfs-boe';

export default {
  setup() {
    useBillTemplateInspector();
  },
};
```

两种方式都可零参数使用，Adapter 会从当前应用、页面地址和已安装的 `@zfs/boe` 自动读取项目与版本元数据。详细说明见[项目接入](docs/project-integration.md)。

## Workspace

```text
apps/extension                  Manifest V3 Side Panel（兼容 DevTools Panel）
packages/shared-types          Snapshot、Bridge、Rule、AI 预留协议
packages/core                  Snapshot 校验与规则执行器
packages/rule-base             字段配置和差旅标准规则包
packages/adapter-vue3          Vue3 Collector、Bridge、字段选择器
docs                           架构、协议、规则和项目接入文档
examples/vue3-boe-integration  真实项目接入片段
```

详细说明：

- [架构设计](docs/architecture.md)
- [Snapshot 协议](docs/snapshot-protocol.md)
- [规则开发](docs/rule-development.md)
- [项目接入](docs/project-integration.md)
- [湖北联投 4.2.0 证据记录](docs/evidence-hblt-4.2.0.md)
- [发布流程](docs/release.md)

## 首版边界

AI 仅冻结 `ModelProvider`、请求上下文和结果协议，没有 API Key 设置或真实模型调用。Vue2、H5、跨域 iframe、多单据联合诊断、配置编辑和自动修复不在首版范围内。
