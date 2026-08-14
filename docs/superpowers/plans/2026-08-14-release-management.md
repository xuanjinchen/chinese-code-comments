# GitHub Release Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个正式版本自动维护 SemVer、CHANGELOG、Git Tag、GitHub Release、npm tarball 和 SHA-256 校验文件。

**Architecture:** Release Please 维护版本 PR 和后续 Release；同一 GitHub Actions 工作流以远端 `v0.1.0` Tag 为幂等边界完成首次引导。独立 Node.js 脚本负责跨平台构建和校验发布资产，契约测试约束配置与工作流关键权限。

**Tech Stack:** Node.js 22 ESM、`node:test`、npm pack、GitHub Actions、release-please-action v4。

## Global Constraints

- 项目只负责自动生成规范、简洁、清晰的代码注释，不增加产品能力。
- 所有本地安装、卸载、测试和维护命令继续使用 Node.js/npm。
- 正式版本严格使用 `vX.Y.Z`，已发布 Tag 不移动、不覆盖。
- 不发布到 npm Registry。
- 代码注释模式锁定为 `SCOPED`，默认使用简体中文高价值注释。
- 新行为执行失败测试、最小实现、完整回归和独立审查。

---

### Task 1: 版本与 Release 配置契约

**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
- Create: `CHANGELOG.md`
- Create: `tests/contract/release-management.test.js`
- Modify: `tests/validate.js`

**Interfaces:**
- Produces: 根包 Release Please 配置；manifest `{ ".": "0.1.0" }`。
- Consumes: `package.json.version` 和 Conventional Commits。

- [ ] **Step 1: 添加失败契约测试**

```js
test('Release Please 与当前包版本保持一致', () => {
  assert.equal(config.packages['.']['release-type'], 'node');
  assert.equal(config.packages['.']['include-v-in-tag'], true);
  assert.equal(config.packages['.']['include-component-in-tag'], false);
  assert.equal(manifest['.'], packageJson.version);
  assert.match(changelog, /^# Changelog/mu);
  assert.match(changelog, /^## \[0\.1\.0\]/mu);
});
```

- [ ] **Step 2: 运行测试并确认缺少配置而失败**

Run: `node --test tests/contract/release-management.test.js`

Expected: FAIL，报告缺少 release-please 配置或 CHANGELOG。

- [ ] **Step 3: 写入最小配置和初始 CHANGELOG**

```json
{
  "packages": {
    ".": {
      "release-type": "node",
      "package-name": "chinese-code-comments",
      "include-v-in-tag": true,
      "include-component-in-tag": false
    }
  }
}
```

初始 CHANGELOG 仅记录 `0.1.0` 已具备的 Skill、六个适配器、Node 安装器、安全卸载和真实评测能力。

- [ ] **Step 4: 运行契约和仓库校验**

Run: `node --test tests/contract/release-management.test.js`

Run: `npm run validate`

Expected: PASS。

- [ ] **Step 5: 请求独立审查并修复 Critical/Important**

审查版本单一来源、Tag 格式和初始 CHANGELOG 是否与现状一致。

### Task 2: Node.js 发布资产构建器

**Files:**
- Create: `scripts/release-pack.js`
- Modify: `package.json`
- Modify: `tests/contract/release-management.test.js`

**Interfaces:**
- Produces: `buildReleaseArtifacts({ outputRoot }): Promise<{ tarballPath, checksumPath, digest }>`；CLI `node scripts/release-pack.js --output <dir>`。
- Consumes: `npm pack --ignore-scripts --json` 输出和 `package.json` 元数据。

- [ ] **Step 1: 添加真实打包失败测试**

```js
test('发布脚本生成 tarball 和匹配的 SHA-256', async (t) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'ccc-release-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const result = await buildReleaseArtifacts({ outputRoot });
  const bytes = await readFile(result.tarballPath);
  assert.equal(result.digest, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(await readFile(result.checksumPath, 'utf8'), `${result.digest}  ${path.basename(result.tarballPath)}\n`);
});
```

- [ ] **Step 2: 运行测试并确认模块不存在而失败**

Run: `node --test tests/contract/release-management.test.js`

Expected: FAIL，报告缺少 `scripts/release-pack.js`。

- [ ] **Step 3: 实现跨平台打包入口**

脚本解析 `--output`，拒绝仓库根目录和文件系统根目录，清理目标目录，执行 npm pack，校验只返回一个 tarball，再写入 `.sha256`。`package.json` 新增：

```json
"release:pack": "node scripts/release-pack.js"
```

- [ ] **Step 4: 运行发布脚本测试和现有包白名单测试**

Run: `node --test tests/contract/release-management.test.js tests/contract/release-package.test.js`

Expected: PASS，且测试临时目录被清理。

- [ ] **Step 5: 请求独立审查并修复 Critical/Important**

重点审查清理边界、Windows npm 调用和摘要格式。

### Task 3: GitHub Release 工作流与维护文档

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `README.md`
- Modify: `tests/contract/release-management.test.js`
- Modify: `tests/validate.js`

**Interfaces:**
- Produces: `main` push 触发的 Release Please 工作流；初始 `v0.1.0` 引导；Release 资产上传。
- Consumes: `RELEASE_PLEASE_TOKEN` 可选 Secret、`GITHUB_TOKEN` 回退、Task 2 的 `npm run release:pack`。

- [ ] **Step 1: 添加工作流失败契约测试**

```js
test('Release 工作流限制权限并上传两个资产', () => {
  assert.match(workflow, /googleapis\/release-please-action@v4/u);
  assert.match(workflow, /contents:\s*write/u);
  assert.match(workflow, /pull-requests:\s*write/u);
  assert.match(workflow, /npm run release:pack/u);
  assert.match(workflow, /\.tgz/u);
  assert.match(workflow, /\.sha256/u);
});
```

- [ ] **Step 2: 运行测试并确认工作流不存在而失败**

Run: `node --test tests/contract/release-management.test.js`

Expected: FAIL，报告缺少 `.github/workflows/release.yml`。

- [ ] **Step 3: 实现幂等 Release 工作流**

Workflow 顺序固定为：检出完整历史、配置 Node 22、查询 `v0.1.0`、首次发布前运行 `npm ci && npm run check && npm run release:pack`、创建初始 Release、运行 Release Please、为新 Release 构建并上传资产。后续流程不得再次进入初始发布分支。

- [ ] **Step 4: 更新 README 维护说明**

记录 Conventional Commits、Release PR 审核、PAT Secret 配置、首次引导和失败重跑方式；不复制完整 CHANGELOG。

- [ ] **Step 5: 运行契约、validate 和完整测试**

Run: `npm run check`

Expected: 全部确定性测试通过；Windows 仅跳过 POSIX mode 测试。

- [ ] **Step 6: 请求独立审查并修复 Critical/Important**

重点审查 GitHub Token 递归触发限制、Release 重复创建、Tag 不可变性和资产对应提交。

### Task 4: 最终验证与首次 v0.1.0 Release

**Files:**
- Review: 本次完整 diff 和所有新增文件。

**Interfaces:**
- Consumes: Tasks 1-3 全部产物。
- Produces: 提交并推送的发布自动化；远端 `v0.1.0` Tag、GitHub Release 和两个资产。

- [ ] **Step 1: 执行完整门禁**

Run: `npm run check`

Run: `npm run release:pack -- --output .release-check`

Run: `npm pack --dry-run`

Run: `git diff --check`

Expected: 全部通过，并在核验后删除 `.release-check`。

- [ ] **Step 2: 执行完整 diff 注释审查**

显式使用 `$chinese-code-comments`，模式 `SCOPED`。删除重复、显而易见或失真的注释，补齐发布资产清理边界等非直观约束。

- [ ] **Step 3: 请求最终独立代码审查**

修复全部 Critical/Important，重新运行 Step 1。

- [ ] **Step 4: 提交并推送 main**

```bash
git add --all
git commit -m "ci: automate GitHub release management"
git push origin main
```

- [ ] **Step 5: 验证首次发布结果**

确认远端出现 `v0.1.0`，GitHub Release 标题为 `v0.1.0`，并包含 `chinese-code-comments-0.1.0.tgz` 与对应 `.sha256`。若仓库未配置 `RELEASE_PLEASE_TOKEN`，报告 Release PR 的 CI 触发限制但不伪造成功状态。
