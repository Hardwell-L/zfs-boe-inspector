# 发布流程

GitHub 仓库为 `Hardwell-L/zfs-boe-inspector`。npm 只发布以下两个 public package：

- `@zfs-boe-inspector/shared-types`
- `@zfs-boe-inspector/adapter-vue3`

`core`、`rule-base` 和 `extension` 始终保持 `private: true`。Chrome Extension 只作为 ZIP 上传到 GitHub Release。

## 首次发布与 Trusted Publisher 配置

npm Trusted Publisher 必须绑定一个已经存在的 package。当前两个 package 的 `0.1.0` 首发已完成；如果以后新增 package，需要先通过一次交互式 2FA 首发，这不是绕过 2FA，也不需要创建长期 Token：

```bash
npm login
pnpm pack:npm
npm publish release/npm/zfs-boe-inspector-shared-types-<version>.tgz --access public
npm publish release/npm/zfs-boe-inspector-adapter-vue3-<version>.tgz --access public
```

禁止直接在 workspace package 目录执行 `npm publish`。正式发布和交互式首发都必须发布 `pnpm pack:npm` 生成的 tarball，避免将 `workspace:` 协议写入 registry 元数据。

首发完成后，在 npm 的每个 package 设置中分别添加 Trusted Publisher：

- Provider：GitHub Actions
- Organization or user：`Hardwell-L`
- Repository：`zfs-boe-inspector`
- Workflow filename：`release.yml`
- Environment：留空
- Allowed action：`npm publish`

两个 package 都要单独配置。确认 Trusted Publisher 生效后，可以删除 GitHub 的 `NPM_TOKEN` secret，并在 npm 的 Publishing access 中选择“Require two-factor authentication and disallow tokens”。

Trusted Publishing 使用 GitHub OIDC 短期凭证，不会在 workflow 中保存 npm Token；GitHub-hosted runner 上的 npm CLI 由 workflow 固定使用 Node.js 24。public repository + public package 还会自动生成 provenance；如果仓库改为 private，Trusted Publishing 仍可用，但 npm 不生成 provenance。

## 本地发布前校验

```bash
pnpm install --frozen-lockfile
pnpm release:check
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm pack:npm
pnpm pack:extension
```

`release/npm` 中只应有两个 `.tgz`；`release` 中会生成 Extension ZIP 和对应 `.sha256`。

## 正式发布

### 完整发布

更新所有 package、Extension manifest 和 `CHANGELOG.md` 的版本，提交并推送 `main` 后创建同版本 Tag：

```bash
git tag v0.1.0
git push origin main
git push origin v0.1.0
```

Tag 会触发 Release workflow。流水线先执行完整质量校验，再按依赖顺序使用 Trusted Publishing 发布两个 npm package，最后创建 GitHub Release 并上传 Extension ZIP。相同 npm 版本已存在时会自动跳过，支持失败后重跑。

### 仅发布 Extension

只更新 `apps/extension/package.json`、`apps/extension/public/manifest.json` 和 `CHANGELOG.md`，提交并推送 `main` 后创建 `extension-v<version>` Tag：

```bash
git tag extension-v0.2.3
git push origin main
git push origin extension-v0.2.3
```

`extension-v*` Tag 会触发独立 Extension Release workflow。流水线执行质量校验、构建 Extension、生成 ZIP 和 SHA-256，并创建 GitHub Release；不会执行 `publish:npm`，也不会更新 npm package。

## 安装 Extension

1. 从对应 GitHub Release 下载 ZIP 和 `.sha256`。
2. 校验 SHA-256 后解压。
3. 打开 `chrome://extensions`，启用开发者模式。
4. 选择“加载已解压的扩展程序”，选择解压目录。
