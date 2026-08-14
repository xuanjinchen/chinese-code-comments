# GitHub Release 版本维护设计

## 目标

为单包 Node.js 仓库建立可重复的版本维护流程。每个正式版本必须同时具备一致的 `package.json` 版本号、不可移动的 `vX.Y.Z` Git Tag、`CHANGELOG.md` 记录和 GitHub Release，并附带可校验的发布包。

本设计只管理本仓库的 GitHub Release，不发布到 npm Registry，也不扩展项目生成代码注释之外的产品能力。

## 版本模型

- 遵循 Semantic Versioning。
- `fix:` 产生补丁版本，`feat:` 产生次版本，带 `!` 或 `BREAKING CHANGE:` 的提交产生主版本。
- `package.json` 是当前版本号的代码来源。
- `.release-please-manifest.json` 记录最近一次已发布版本，必须与最新 Release 一致。
- 正式 Tag 使用 `vX.Y.Z`，不创建可移动的主版本或次版本别名。
- 已发布 Tag 不修改、不覆盖；修复通过新补丁版本发布。

## 自动化组件

### Release Please

根目录新增 `release-please-config.json` 和 `.release-please-manifest.json`。`googleapis/release-please-action@v4` 在 `main` 更新后读取 Conventional Commits，维护 Release PR。合并 Release PR 后由同一 Action 更新版本与 `CHANGELOG.md`，创建 Tag 和 GitHub Release。

Action 优先使用仓库 Secret `RELEASE_PLEASE_TOKEN`，未配置时回退到 `GITHUB_TOKEN`。使用回退 Token 时，Release PR 触发其他工作流会受到 GitHub 的递归触发限制，因此仓库维护者应配置细粒度 PAT，并允许 Actions 创建 Pull Request。

### 发布资产

新增 Node.js 维护脚本，将 `npm pack` 产物写入指定目录，并为 tarball 生成同名 `.sha256` 文件。脚本必须：

- 仅接受仓库内或显式传入的输出目录；
- 每次执行前清理目标目录，避免上传旧资产；
- 使用 `npm pack --ignore-scripts --json` 获取真实文件名；
- 以小写十六进制 SHA-256 和标准双空格文件名格式输出校验文件；
- 在 Windows、macOS 和 Linux 使用同一个 Node.js 入口。

Release 工作流只在 Release 创建成功后上传这两个资产，不发布到 npm Registry。

## 首次发布

当前版本为 `0.1.0`，远端尚无版本 Tag。工作流在首次运行时查询 `v0.1.0`：

1. Tag 已存在时不执行引导逻辑。
2. Tag 不存在时，检验 `package.json` 与 manifest 均为 `0.1.0`。
3. 运行完整仓库检查并构建发布资产。
4. 以当前已验证提交创建 `v0.1.0` Tag 和 GitHub Release。
5. 使用初始 `CHANGELOG.md` 作为 Release 说明并上传资产。

该判断以远端 Tag 为幂等边界。首次发布完成后，所有后续版本只由 Release Please 创建，避免两个流程竞争同一 Release。

## Release 信息

初始 `CHANGELOG.md` 概述正式适配器、全局安装器、注释策略和验证能力。后续版本说明由 Release Please 从 Conventional Commits 生成，并在 Release PR 中人工审核。Release PR 合并前必须补充或修正以下信息：

- 主要变化；
- 修复内容；
- 兼容性或破坏性变化；
- 安装与升级影响；
- 已知问题。

README 增加版本维护入口、提交类型和发版步骤，但不复制完整 CHANGELOG。

## 权限与失败处理

- Workflow 权限限制为 `contents: write`、`pull-requests: write` 和 `issues: write`。
- 测试、打包或校验失败时不得创建初始 Release。
- 后续 Release 只通过合并已审核的 Release PR 触发。
- 资产上传失败时工作流失败，保留已创建 Release 以便重跑同一工作流补齐资产，不移动 Tag。
- 同名资产重跑时允许覆盖，内容必须来自对应 Tag 的检出状态。

## 测试与验收

- 契约测试校验 release-please 配置、manifest、Workflow 权限、触发条件和 npm scripts。
- 发布脚本测试在临时目录构建真实 tarball，验证文件名、SHA-256 和包内白名单。
- `npm run check`、`npm run release:pack -- --output <dir>`、`npm pack --dry-run` 和 `git diff --check` 通过。
- 首次推送后远端存在 `v0.1.0` Tag 与同名 GitHub Release，Release 包含 `.tgz` 和 `.sha256` 两个资产。
- 后续 `fix:` 或 `feat:` 提交能够更新 Release PR；只有合并该 PR 才创建新版本。
