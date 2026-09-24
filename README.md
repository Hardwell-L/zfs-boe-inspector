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

## 构建、提交与发布

发布前先使用仓库指定的 Node.js 版本并安装锁定依赖：

```bash
nvm use
pnpm install --frozen-lockfile
```

### 提交与推送代码

提交前检查工作区和实际 diff，只暂存本次修改文件：

```bash
git status
git diff
git diff --check

git add path/to/changed-file
git commit -m "fix(extension): 修复具体问题"
git push origin main
```

### 本地检查与打包

```bash
pnpm release:check
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

生成 npm tarball：

```bash
pnpm pack:npm
```

产物位于 `release/npm`，只包含：

- `zfs-boe-inspector-shared-types-<version>.tgz`
- `zfs-boe-inspector-adapter-vue3-<version>.tgz`

生成 Extension ZIP 和 SHA-256：

```bash
pnpm pack:extension
```

产物位于 `release`：

- `zfs-boe-inspector-extension-v<version>.zip`
- `zfs-boe-inspector-extension-v<version>.zip.sha256`

可在 `release` 目录校验 ZIP：

```bash
cd release
shasum -a 256 -c zfs-boe-inspector-extension-v0.2.3.zip.sha256
cd ..
```

### 发布 npm

更新根 `package.json`、`packages/*/package.json`、lockfile 和 `CHANGELOG.md`，然后执行：

```bash
RELEASE_VERSION=0.2.4

pnpm release:check
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm pack:npm

git add package.json \
  packages/shared-types/package.json \
  packages/adapter-vue3/package.json \
  packages/core/package.json \
  packages/rule-base/package.json \
  CHANGELOG.md
git commit -m "chore(npm): 发布 npm ${RELEASE_VERSION}"
git push origin main
```

推送后在 GitHub Actions 中手动运行 `npm Release` workflow，输入 `${RELEASE_VERSION}`。npm 发布不创建 Git Tag 或 GitHub Release。

### 仅发布 Extension

只更新 `apps/extension/package.json`、`apps/extension/public/manifest.json` 和 `CHANGELOG.md`，npm package 版本保持不变：

```bash
EXTENSION_VERSION=0.2.4

pnpm release:check "extension-v${EXTENSION_VERSION}"
pnpm lint
pnpm build
pnpm pack:extension

git add apps/extension/package.json \
  apps/extension/public/manifest.json \
  CHANGELOG.md
git commit -m "chore(extension): 发布 Extension ${EXTENSION_VERSION}"
git push origin main

git tag "extension-v${EXTENSION_VERSION}"
git push origin "extension-v${EXTENSION_VERSION}"
```

`extension-v*` Tag 只构建并上传 Extension ZIP 和 SHA-256，不执行 `publish:npm`。当前项目仅为 Extension 打 Tag，格式必须是小写 `extension-v<SemVer>`，版本规则参考 [Semantic Versioning](https://semver.org/)。

### 手动发布 npm 兜底

仅在 GitHub Trusted Publishing 无法使用时，发布 `pnpm pack:npm` 生成的 tarball：

```bash
RELEASE_VERSION=0.2.4

npm publish "release/npm/zfs-boe-inspector-shared-types-${RELEASE_VERSION}.tgz" --access public
npm publish "release/npm/zfs-boe-inspector-adapter-vue3-${RELEASE_VERSION}.tgz" --access public
```

必须先发布 `shared-types`，再发布 `adapter-vue3`。禁止直接在 workspace package 目录执行 `npm publish`，避免把 `workspace:` 依赖写入 npm registry。Trusted Publisher 和发布约定见[发布流程](docs/release.md)。

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

两种方式都可零参数使用，Adapter 会从当前应用、页面地址和已安装的 `@zfs/boe` 自动读取项目与版本元数据；标准差旅组件也会从 `billTemplate` 的父级链自动发现，无需单独注册。详细说明见[项目接入](docs/project-integration.md)。

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
- [BOE 4.2 Vue3 接入证据](docs/evidence-boe-4.2.md)
- [发布流程](docs/release.md)

## 首版边界

AI 仅冻结 `ModelProvider`、请求上下文和结果协议，没有 API Key 设置或真实模型调用。Vue2、H5、跨域 iframe、多单据联合诊断、配置编辑和自动修复不在首版范围内。
