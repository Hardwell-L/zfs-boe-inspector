# 发布流程

GitHub 仓库为私有仓库 `hardwell/zfs-boe-inspector`。npm 只发布以下两个 public package：

- `@zfs-boe-inspector/shared-types`
- `@zfs-boe-inspector/adapter-vue3`

`core`、`rule-base` 和 `extension` 始终保持 `private: true`。Chrome Extension 只作为内部 ZIP 上传到 GitHub Release。

## 首次配置

1. 在 GitHub 创建 private repository `hardwell/zfs-boe-inspector`。
2. 在仓库 `Settings > Secrets and variables > Actions` 新增 `NPM_TOKEN`。
3. Token 必须有发布 `@zfs-boe-inspector` scope public package 的权限；不要把 Token 写入仓库文件。

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

更新所有 package、Extension manifest 和 `CHANGELOG.md` 的版本，提交并推送 `main` 后创建同版本 Tag：

```bash
git tag v0.1.0
git push origin main
git push origin v0.1.0
```

Tag 会触发 Release workflow。流水线先执行完整质量校验，再按依赖顺序发布两个 npm package，最后创建 GitHub Release 并上传 Extension ZIP。相同 npm 版本已存在时会自动跳过，支持失败后重跑。

## 安装 Extension

1. 从对应 GitHub Release 下载 ZIP 和 `.sha256`。
2. 校验 SHA-256 后解压。
3. 打开 `chrome://extensions`，启用开发者模式。
4. 选择“加载已解压的扩展程序”，选择解压目录。
