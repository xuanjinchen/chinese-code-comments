# Public Repository Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理仓库历史中的个人元数据，补齐最小开源与供应链防护，并在验证后公开仓库。

**Architecture:** 先在仓库外保留完整恢复点，再一次性重写所有公开引用。仓库内容与 GitHub 配置分开处理：文件变更先经本地验证和独立审查，远程强制更新完成后公开仓库，并立即启用不可变保护。

**Tech Stack:** Git、Node.js 22+、npm、GitHub Actions、GitHub REST API、Gitleaks

## Global Constraints

- 项目只解决自动生成规范、简洁、清晰代码注释的问题。
- 不新增运行时依赖、遥测、MCP、编辑器插件或无关注释能力。
- 安装、卸载、测试和维护命令继续只依赖 Node.js/npm。
- 默认代码注释模式为 `SCOPED`，结束前审查完整 diff。
- 所有破坏性远程操作前必须存在验证通过的仓库外 bundle。

---

### Task 1: Secure Local Git And Preserve Recovery Point

**Files:** None

- [ ] 将全局 `http.sslVerify` 设为 `true`，提交身份设为 `xuanjinchen` 和 GitHub noreply 邮箱。
- [ ] 使用 `git bundle create <outside-repo>.bundle --all` 创建仓库外备份。
- [ ] 使用 `git bundle verify <outside-repo>.bundle` 验证全部分支和标签可恢复。

### Task 2: Rewrite Sensitive History

**Files:**
- Modify in history: `docs/superpowers/plans/2026-08-12-chinese-code-comments.md`
- Modify in history: `docs/superpowers/specs/2026-08-12-chinese-code-comments-design.md`

- [ ] 记录 `main`、Release Please 分支和两个标签的旧对象 ID。
- [ ] 在临时 bare mirror 中把全部作者和提交者邮箱改为 GitHub noreply 地址。
- [ ] 将历史文档中的真实本机绝对路径替换为 `<repo>` 或 `$HOME`。
- [ ] 重写所有分支与标签，并输出新旧引用映射。
- [ ] 扫描改写后的全部对象，确认个人邮箱和本机路径均不存在。

### Task 3: Reconcile Repository Content And Release References

**Files:**
- Modify: `CHANGELOG.md`
- Modify/Delete: Release Please remote branch

- [ ] 将本地工作副本切换到重写后的 `main`。
- [ ] 将 `CHANGELOG.md` 中的旧提交链接替换为对应的新提交哈希。
- [ ] 检查 Release Please 分支是否仍有有效增量；无有效增量则删除，存在有效增量则基于重写历史重建。
- [ ] 验证 `v0.1.0` 和 `v0.1.1` 仍分别包含正确的版本内容。

### Task 4: Add Minimal Open Source Governance

**Files:**
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Create: `.github/ISSUE_TEMPLATE/bug-or-compatibility.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

- [ ] 写入只围绕代码注释、安装兼容和安全问题的最小模板，合并重复的 Bug 与兼容性表单。
- [ ] 使用 GitHub 私密漏洞报告，不发布个人联系邮箱。
- [ ] 在贡献指南中固定 `npm ci --ignore-scripts`、`npm run check`、`npm pack --dry-run` 和 `git diff --check`。

### Task 5: Harden Dependency And Workflow Supply Chain

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Create: `.github/dependabot.yml`
- Test: `tests/contract/release-management.test.js`

- [ ] 先增加会因可变 Action 标签而失败的契约测试，并确认失败原因正确。
- [ ] 将所有 `uses:` 固定到对应主版本当前指向的完整提交 SHA，并在行尾保留版本注释。
- [ ] 添加 npm/GitHub Actions Dependabot 月度更新；CodeQL 在公开后使用 Default Setup。
- [ ] 运行契约测试并确认通过。

### Task 6: Pin Stable Installation Documentation

**Files:**
- Modify: `README.md`
- Modify: `tests/validate.js`

- [ ] 先增加会因稳定命令引用 `main` 而失败的验证断言，并确认失败原因正确。
- [ ] 将稳定 GitHub `npx` 命令固定为当前 Release，并配置 Release Please 在后续发布时同步升级 README。
- [ ] 保留单独标注的 `#main` 开发安装命令，并说明其不保证稳定。
- [ ] 运行 `npm run validate` 并确认通过。

### Task 7: Verify And Review Local Result

**Files:** All changed files

- [ ] 运行 `npm ci --ignore-scripts`、`npm run check`、`npm pack --dry-run` 和 `git diff --check`。
- [ ] 对全部可达对象、工作区和待上传 Release 资产执行敏感信息扫描。
- [ ] 使用 `chinese-code-comments` 以 `SCOPED` 模式审查完整 diff。
- [ ] 请求独立子代理按规格、测试、安全性和项目边界进行代码审查，并修复 Critical/Important 问题。

### Task 8: Publish Rewritten References And Releases

**Files:** Remote Git references and GitHub Releases

- [ ] 使用启用 TLS 校验的 Git 强制更新 `main` 和保留的 Release Please 分支。
- [ ] 强制更新两个版本标签，并删除不再需要的远程 Release Please 分支。
- [ ] 使 GitHub Releases 重新绑定到新标签，重建 tarball 与 SHA-256 资产。
- [ ] 下载并校验两个 Release 的资产和清单。

### Task 9: Make Public And Apply GitHub Protections

**Files:** GitHub repository settings

- [ ] 将仓库可见性切换为 public，并立即创建 `main` 分支 Ruleset 和 `v*` 标签 Ruleset。
- [ ] 将 Actions 默认权限设为只读并限制允许的 Actions；配置专用 `RELEASE_PLEASE_TOKEN` 前保留创建 PR 权限。
- [ ] 启用依赖漏洞提醒、Private Vulnerability Reporting、Secret Scanning、Push Protection 和 CodeQL Default Setup。

### Task 10: Verify Anonymous Use

**Files:** GitHub repository settings

- [ ] 使用未认证 GitHub API 验证仓库元数据、源码、标签和 Releases 可访问。
- [ ] 在隔离临时目录从 `#v0.1.1` 执行匿名安装、`doctor` 和卸载验证。
- [ ] 确认 CI、CodeQL、Dependabot、Rulesets 和安全功能处于预期状态。
