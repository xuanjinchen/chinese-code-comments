# Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复安装器所有权和并发安全，增强真实代码验证，并清理发布与评测冗余。

**Architecture:** 使用 schema v2 保存路径和所有权，由用户级锁串行化状态事务；评测通过 Node.js 编排真实语言工具链。保持六个适配器和现有 CLI 命令不变。

**Tech Stack:** Node.js 22 ESM、`node:test`、GitHub Actions、目标语言编译器。

## Global Constraints

- 项目只负责自动生成规范、简洁、清晰的代码注释。
- 默认使用简体中文高价值注释，保留准确的现有注释。
- 所有安装、卸载、测试和维护入口均为 Node.js 命令。
- 生产修复严格执行失败测试、最小实现、回归测试。

---

### Task 1: 所有权状态与并发锁

**Files:**
- Create: `src/installer-lock.js`
- Modify: `src/state.js`, `src/install.js`, `src/uninstall.js`, `src/doctor.js`, `src/cli.js`
- Test: `tests/unit/state.test.js`, `tests/integration/install.test.js`, `tests/integration/uninstall.test.js`, `tests/integration/doctor.test.js`

**Interfaces:**
- Produces: `withInstallerLock(context, operation)`；schema v2 `storageGroups[group] = { members, root, files }`。
- Consumes: 现有 adapter 的 `skillRoot()`、`policyFile()` 和事务 API。

- [ ] 添加失败测试：并发安装合并状态；改根卸载不删除外部文件；无状态完整卸载保留独立 Skill；双入口同内容文件保持外部所有权；未知 Agent 状态被拒绝。
- [ ] 单独运行相关测试并确认因旧状态模型和缺少锁而失败。
- [ ] 实现锁、v1 迁移、v2 校验、所有权记录和保守卸载。
- [ ] 运行状态及安装生命周期测试并确认通过。
- [ ] 请求独立代码审查并修复重要发现。

### Task 2: HTTPS 入口与真实评测

**Files:**
- Modify: `README.md`, `tests/validate.js`, `tests/eval/run.js`, `tests/eval/smoke.js`, `tests/eval/syntax.js`, `tests/eval/grader.js`
- Test: `tests/eval/agents.test.js`, `tests/eval/smoke.test.js`, `tests/contract/behavior-cases.test.js`

**Interfaces:**
- Produces: 真实语法检查结果 `{ valid, tool, error }`；smoke 运行验证结果。
- Consumes: Agent runner 的 normalized output 和隔离 workspace。

- [ ] 添加失败测试：无 Skill 轨迹不能标记直接证据；改名 Java 方法失败；非法 Python 失败；C 容量不匹配失败。
- [ ] 运行定向测试并确认旧实现产生假阳性。
- [ ] 将 README 命令改成 `git+https://github.com/xuanjinchen/chinese-code-comments.git`。
- [ ] 通过 Node 子进程调用真实解析器/编译器，Java smoke 编译并执行测试夹具。
- [ ] 运行全部 eval/smoke 确定性测试并请求独立审查。

### Task 3: 权限与链接兼容

**Files:**
- Modify: `src/transaction.js`
- Test: `tests/integration/transaction.test.js`, `tests/integration/install.test.js`

**Interfaces:**
- Consumes: `executeTransaction(entries, options)` 原接口。
- Produces: 保留 mode、允许链接目录且拒绝链接目标的事务行为。

- [ ] 添加 POSIX mode 和目录链接失败测试，并确认旧实现失败。
- [ ] 使用跟随链接的目录检查，暂存文件继承现有文件 mode。
- [ ] 运行事务和生命周期测试并请求独立审查。

### Task 4: 发布白名单与案例单一来源

**Files:**
- Modify: `package.json`, `package-lock.json`, `evals/evals.json`, `tests/behavior-cases.json`, `tests/eval/run.js`, `tests/eval/grader.js`, `tests/contract/behavior-cases.test.js`, `tests/validate.js`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: 以字符串 `case_id` 关联的评测目录；最小 npm 发布文件集合。

- [ ] 添加失败测试：eval 与行为案例必须一一对应且不依赖位置；发布包不得包含测试和历史文档。
- [ ] 显式写入 `case_id`，从目录数据派生默认案例列表并覆盖只读解释案例。
- [ ] 增加 npm `files` 和标准项目元数据，CI 检查打包结果。
- [ ] 运行契约、validate 和 pack 检查并请求独立审查。

### Task 5: 完整验证与注释审查

**Files:**
- Review: 本次完整 `git diff` 和未跟踪文件。

- [ ] 运行 `npm run check`、`npm pack --dry-run`、`git diff --check`。
- [ ] 显式使用 `$chinese-code-comments` 审查完整 diff，删除重复或低价值注释并补齐非直观约束。
- [ ] 请求最终代码审查，修复全部 Critical/Important 问题。
- [ ] 确认工作树只包含本次范围内改动并汇报未运行的外部 live 测试。
