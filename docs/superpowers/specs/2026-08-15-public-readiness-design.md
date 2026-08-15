# Public Repository Readiness Design

## Goal

在不扩展项目能力边界的前提下，清除 Git 历史中的个人元数据，补齐最小开源治理与供应链防护，并将仓库安全地切换为公开状态。项目继续只解决自动生成规范、简洁、清晰代码注释的问题。

## Scope

- 恢复 Git HTTPS 证书校验，并将未来提交身份固定为 GitHub noreply 地址。
- 重写全部公开引用中的作者、提交者邮箱和历史文档本机绝对路径。
- 协调重写后的 `main`、Release Please 分支、`v0.1.0`、`v0.1.1`、GitHub Releases 与 `CHANGELOG.md`。
- 增加漏洞报告、贡献指南、行为准则、所有者、Issue/PR 模板和依赖更新配置。
- 将第三方 GitHub Actions 固定到不可变提交 SHA，并在公开后启用 CodeQL Default Setup。
- 稳定安装命令固定到 `v0.1.1`，`main` 只作为明确标注的开发入口。
- 在历史改写完成后公开仓库，随即启用分支、标签、Actions 和 GitHub 安全保护，再执行匿名验证。

不新增 MCP、编辑器插件、注释之外的 Agent 能力、运行时依赖或遥测。

## History Rewrite

改写前在仓库外创建完整 bundle，并验证其中包含全部分支和标签。历史清理采用可审计的脚本一次完成：所有作者和提交者邮箱改为 `120694391+xuanjinchen@users.noreply.github.com`，历史文档中的真实用户目录与仓库绝对路径改为 `<repo>` 或 `$HOME` 等中性占位符。

改写覆盖本地 `main`、远程 Release Please 引用和两个版本标签。标签继续指向各自原有版本对应的重写提交；标签类型不在本次处理中改变。改写后的提交哈希用于修正 `CHANGELOG.md` 链接，再删除或替换失效的 Release Please 分支。

## Repository Files

治理文件保持最小且与项目规模匹配：

- `SECURITY.md` 使用 GitHub Private Vulnerability Reporting 作为保密渠道，不公开个人邮箱。
- `CONTRIBUTING.md` 约束项目边界、Node.js 22+、Conventional Commits 和验证命令。
- 合并的 Issue 表单与 PR 模板覆盖复现、兼容性、测试和敏感信息检查，避免重复模板。
- `.github/dependabot.yml` 仅维护 npm 与 GitHub Actions。

单维护者阶段不增加没有实际审批收益的 `CODEOWNERS`。在具备独立的私密行为投诉渠道前不增加行为准则，避免把漏洞报告渠道错误用于行为投诉。

## GitHub Configuration

GitHub Free 私有仓库不能创建所需 Rulesets，因此所有强制推送和 Release 协调完成后先公开仓库，再立即创建保护规则。`main` 要求 Pull Request、CI 通过、禁止删除和非快进更新；版本标签 `v*` 禁止删除和更新。Actions 默认权限设为只读，仅允许选定的官方与已固定 SHA 的第三方 Action。

在仓库尚未配置独立的 `RELEASE_PLEASE_TOKEN` 时，保留 Actions 创建 Pull Request 的权限，避免破坏 Release Please。只有配置并验证仓库专用细粒度 PAT 后才关闭该权限。

仓库公开后启用依赖漏洞提醒、Secret Scanning、Push Protection、Private Vulnerability Reporting 和 JavaScript/TypeScript CodeQL Default Setup。可用性以 GitHub API 的实际返回为准，不假设私有仓库阶段的免费功能状态。

## Verification

公开前必须通过：

- `npm ci --ignore-scripts`
- `npm run check`
- `npm pack --dry-run`
- `git diff --check`
- 全历史、工作区和 Release 资产敏感信息扫描
- 完整 diff 的代码注释审查
- 独立子代理代码审查

公开后以未认证请求验证仓库、Release 和固定版本安装入口可访问，并确认 CI、Rulesets、Actions 权限与安全功能状态。

## Recovery

任何历史重写、推送或 Release 协调失败时，停止公开操作。使用仓库外 bundle 恢复原引用，或根据已记录的新旧引用映射重建分支、标签和 Releases。只有全部验证通过后才将可见性切换为 public。
