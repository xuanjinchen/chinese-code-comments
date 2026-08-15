# Token Usage Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变代码注释行为的前提下，将运行时提示负担至少降低 33%，并将默认 live eval 从 20 次模型调用降到 8 次。

**Architecture:** 让 `SKILL.md` 成为行为规则唯一权威，全局策略只负责自动触发与两阶段流程，frontmatter 只负责发现，Codex metadata 只负责调用。live eval 分为默认 8 案例核心集和显式 20 案例完整集，保留全部 grader 与定点运行能力。

**Tech Stack:** Node.js 22+ ESM、`node:test`、npm scripts、Markdown/YAML、现有六个 Agent Runner。

## Global Constraints

- 项目仍只负责自动生成规范、简洁、清晰且耐维护的代码注释。
- 不删除自动触发、默认简体中文、用户指定语言优先、`SCOPED/GROUPED/STRICT`、现有注释保留或两阶段完整 diff 审查。
- 四层运行时提示合计不得超过 6,200 UTF-8 字节。
- 默认 live eval 恰好选择 8 个案例；完整集继续包含 20 个案例。
- 不增加运行时依赖，不引入特定模型 tokenizer，不批量合并模型案例。
- 所有安装、测试、维护和验证入口继续使用 Node.js/npm。
- 产生代码写入时使用 `$chinese-code-comments` 的 `SCOPED` 模式，结束前审查完整 diff 并报告结果。

---

## File Map

- `SKILL.md`: 代码注释行为唯一权威，压缩重复章节但保留全部语义。
- `resources/global-policy.md`: 常驻自动触发、单次加载和两阶段审查规则。
- `agents/openai.yaml`: Codex 显示信息、短调用提示和隐式调用开关。
- `tests/contract/skill.test.js`: 按层验证职责，并继续验证 Skill 正文不可退化语义。
- `tests/contract/prompt-budget.test.js`: 新增运行时提示与 eval 协议预算门禁。
- `tests/validate.js`: 校验精简 frontmatter 和新增 npm script。
- `tests/eval/run.js`: 核心/完整案例选择、参数冲突和紧凑输出协议。
- `tests/eval/agents.test.js`: eval 参数、默认选择和运行次数契约。
- `tests/contract/behavior-cases.test.js`: 全部 20 案例与默认 8 案例的集合一致性。
- `package.json`: 新增 `eval:full` 维护命令。
- `README.md`: 记录提示预算、8/20 案例命令和费用边界。

---

### Task 1: Runtime Prompt Layering and Budgets

**Files:**
- Create: `tests/contract/prompt-budget.test.js`
- Modify: `tests/contract/skill.test.js`
- Modify: `tests/validate.js`
- Modify: `SKILL.md`
- Modify: `resources/global-policy.md`
- Modify: `agents/openai.yaml`

**Interfaces:**
- Consumes: `renderPolicy(adapter, template, eol)` and `selectAdapters(ids, context)`.
- Produces: canonical compressed Skill; prompt budget contract used by all later tasks.

- [ ] **Step 1: Write failing prompt-budget tests**

Create `tests/contract/prompt-budget.test.js` with these exact measurements:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { selectAdapters } from '../../src/adapters/index.js';
import { renderPolicy } from '../../src/policies/render.js';

const skill = readFileSync(new URL('../../SKILL.md', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../../resources/global-policy.md', import.meta.url), 'utf8');
const metadata = readFileSync(new URL('../../agents/openai.yaml', import.meta.url), 'utf8');
const sections = skill.match(/^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---\r?\n(?<body>[\s\S]*)$/u);
const description = sections.groups.frontmatter.match(/^description:\s+(.+)$/mu)[1];
const defaultPrompt = metadata.match(/^\s*default_prompt:\s+"(.*)"$/mu)[1];
const chars = (value) => [...value].length;
const bytes = (value) => Buffer.byteLength(value, 'utf8');

test('runtime prompt payload stays within the approved budget', () => {
  assert.ok(chars(description) <= 170, `description chars=${chars(description)}`);
  assert.ok(chars(skill) <= 2_100, `SKILL.md chars=${chars(skill)}`);
  assert.ok(chars(policy) <= 360, `global policy chars=${chars(policy)}`);
  assert.ok(chars(metadata) <= 300, `openai metadata chars=${chars(metadata)}`);
  assert.ok(
    bytes(description) + bytes(sections.groups.body) + bytes(policy) + bytes(defaultPrompt) <= 6_200,
    'combined runtime prompt exceeds 6200 UTF-8 bytes',
  );
});

test('every rendered Agent policy stays within the constant-context budget', () => {
  const context = { home: '/home/tester', env: {}, platform: 'linux' };
  for (const adapter of selectAdapters(null, context)) {
    assert.ok(chars(renderPolicy(adapter, policy, '\n')) <= 450, adapter.id);
  }
});
```

Task 3 再导入 `evaluationProtocol` 并添加协议预算，避免在生产导出尚不存在时让 Task 1 的测试模块无法加载。Task 1 的运行时预算测试必须直接对当前 9,360 字节负担失败。

- [ ] **Step 2: Run the new budget test and verify RED**

Run: `node --test tests/contract/prompt-budget.test.js`

Expected: FAIL because current description, Skill, policy, metadata, rendered policy, and combined payload exceed the approved limits.

- [ ] **Step 3: Refactor semantic contract tests before changing prose**

In `tests/contract/skill.test.js`:

- 保留 `bodyContracts` 覆盖的每项语义，但把依赖旧句式的正则改为匹配压缩后的规范表达；不得删除语言优先级、模式锁定、正向/否定模式分类、只读例外、两阶段流程、高价值基准、跨调用契约、无需新增注释、按需联动、格式边界和行为安全检查。
- Replace frontmatter assertions with trigger-only checks for code writes, explicit comment requests, and the ordinary read-only exclusion.
- Replace metadata assertions with only `$chinese-code-comments` invocation and `allow_implicit_invocation: true`.
- Require the global policy to mention code writes, one Skill load before editing, implementation intent, complete diff review, the read-only exception, and final reporting.
- Add negative assertions that frontmatter, metadata, and global policy do not restate `GROUPED` or `STRICT` algorithms.

In `tests/validate.js`, replace the exact description with:

```js
'在创建、修改、重构或修复代码时使用，也用于用户明确要求生成、更新或审核代码注释；支持任意语言及逐行、代码块、方法、类、API 文档等粒度。普通只读解释或代码审查不隐式触发，明确审核注释除外。'
```

- [ ] **Step 4: Run Skill contracts and verify RED against old layering**

Run: `node --test tests/contract/skill.test.js tests/contract/prompt-budget.test.js`

Expected: FAIL because old frontmatter, metadata and global policy still duplicate behavior rules and exceed budgets.

- [ ] **Step 5: Replace runtime prompt files with the compressed hierarchy**

Use this frontmatter description exactly:

```yaml
description: 在创建、修改、重构或修复代码时使用，也用于用户明确要求生成、更新或审核代码注释；支持任意语言及逐行、代码块、方法、类、API 文档等粒度。普通只读解释或代码审查不隐式触发，明确审核注释除外。
```

Use a compact `SKILL.md` with these sections and exact decisions:

```markdown
## 确定策略

先读取用户要求、就近项目规范、代码与测试，并锁定模式、语言、粒度和关注点，后续不重新解释。

- `STRICT`：仅当用户以任意语言正向、显式要求每一行或每条可执行语句都必须独立注释。否定式提及不触发。
- `GROUPED`：仅当用户正向提出逐行等价请求，如“逐行注释”、`line-by-line`、`一行ずつ`，且没有全称约束；按连续语义块注释。缺少全称约束本身、普通“添加注释”和否定式逐行提及都保持 `SCOPED`。
- `SCOPED`：其他情况，只处理用户指定范围或默认高价值注释；纯只读任务也使用此模式。

语言优先级为用户明确指定、项目就近规范、简体中文；范围与粒度优先级为用户明确指定、项目就近规范、默认高价值维护注释。逐行请求在编辑前说明模式与依据；只返回代码时只需在工作记录中锁定。

## 执行

代码写入任务分两阶段：实现时在相关代码附近记录关键意图；结束前获取完整 diff 和未跟踪交付文件（非 Git 项目检查本次实际改动），结合周边代码、测试和文档修正缺失、重复、显而易见、错误或失真的注释，运行必要验证，并在最终回复报告审查结果。没有维护上下文时允许不新增注释，但仍须报告已审查。

纯只读解释或普通代码审查不执行两阶段流程；用户明确审核注释时只检查现状，不虚构改动。

## 注释准则

- 默认解释业务意图、约束、边界、异常、并发、资源管理、兼容性和非直观原因；不逐句翻译赋值、循环或普通调用，不猜测无法验证的业务事实，也不用注释替代命名、重构或测试。
- 终止符或哨兵容量、失败路径释放资源、成功后转移所有权等跨调用契约必须贴近对应分支或转移点分别记录，不能合并成远离约束的一条注释。
- 保留准确的现有注释及其语言；只更新失真、错误或与改动冲突的注释。使用目标语言和项目惯用的行、块或文档注释格式。
- `GROUPED` 的一条注释原则上覆盖至少两条相关语句，不单独注释声明、显然赋值或简单返回；若几乎一行一注，合并连续注释。`STRICT` 分别覆盖每条可执行语句，但 `else`、`catch`、`finally` 等结构行不单独注释，并在结束前补齐遗漏。
- 用户指定代码块、函数、类、API、参数、返回值、异常或其他基准时，只围绕该范围处理。
- 不向标准 JSON、锁文件、生成代码、第三方依赖、压缩文件或不支持注释的格式写入非法内容。注释不得改变代码逻辑、破坏语法、泄露秘密或承诺未经验证的行为。

## 按需联动

本 Skill 只负责代码注释。仅复用已正常触发的 `systematic-debugging`、`requesting-code-review`、`technical-writer` 或技术栈 Skill 所确认的根因、风险、契约和术语；不为注释强制触发辅助 Skill，不重复分析或复制冗长结论。
```

Use this compact global policy:

```markdown
## Global Code Comment Policy

- 对创建、修改、重构、修复或会改写文件的代码任务，即使用户未提及注释，也必须在编辑前加载并使用 `{{skill_invocation}}`。同一次加载贯穿两阶段：实现时记录关键维护意图，结束前按该 Skill 审查完整 diff 和未跟踪交付文件。
- 纯只读解释或代码审查不强制两阶段流程；明确审核注释时按 Skill 只检查现状。
- 即使无需新增注释，代码写入任务的最终回复也必须报告已完成注释审查。
```

Use this Codex metadata prompt:

```yaml
interface:
  display_name: "Chinese Code Comments"
  short_description: "生成并审查准确、简洁、耐维护的代码注释"
  default_prompt: "Use $chinese-code-comments and follow its mode, language, and review rules."

policy:
  allow_implicit_invocation: true
```

- [ ] **Step 6: Run Task 1 tests and verify GREEN**

Run: `node --test tests/contract/skill.test.js tests/contract/prompt-budget.test.js tests/unit/adapters.test.js`

Expected: PASS；协议预算尚未加入，留给 Task 3 的独立 RED/GREEN 周期。

- [ ] **Step 7: Commit runtime prompt optimization**

```bash
git add SKILL.md resources/global-policy.md agents/openai.yaml tests/contract/skill.test.js tests/contract/prompt-budget.test.js tests/validate.js
git commit -m "perf: reduce runtime prompt payload"
```

---

### Task 2: Core and Full Live-Eval Profiles

**Files:**
- Modify: `tests/eval/run.js`
- Modify: `tests/eval/agents.test.js`
- Modify: `tests/contract/behavior-cases.test.js`
- Modify: `package.json`
- Modify: `tests/validate.js`

**Interfaces:**
- Produces: `ALL_CASE_IDS`, `CORE_CASE_IDS`, `parseRunArgs(argv)` with `full`, and `runBehaviorEval({ full })`.
- Preserves: `--case`, one-Agent-only execution, all 20 behavior definitions and grader coverage.

- [ ] **Step 1: Write failing profile-selection tests**

Add assertions equivalent to:

```js
assert.equal(ALL_CASE_IDS.length, 20);
assert.deepEqual(CORE_CASE_IDS, [
  'java-high-value-write',
  'c-buffer-fix',
  'english-grouped-line-comments',
  'strict-english-per-line',
  'self-explanatory-write',
  'preserve-existing-english',
  'json-no-comments',
  'read-only-explanation',
]);
assert.deepEqual(parseRunArgs(['--agent', 'codex']), {
  agent: 'codex', caseIds: null, full: false, resultsRoot: null, timeoutMs: 120_000,
});
assert.equal(parseRunArgs(['--agent', 'codex', '--full']).full, true);
assert.throws(
  () => parseRunArgs(['--agent', 'codex', '--full', '--case', 'json-no-comments']),
  /--full cannot be combined with --case/,
);
```

Update behavior-case contracts so `ALL_CASE_IDS` equals every eval definition while `CORE_CASE_IDS` is a unique subset of it.

Update `tests/validate.js` to expect:

```js
'eval:full': 'node tests/eval/run.js --full',
```

- [ ] **Step 2: Run profile tests and verify RED**

Run: `node --test tests/eval/agents.test.js tests/contract/behavior-cases.test.js`

Expected: FAIL because profile constants and `--full` do not exist.

- [ ] **Step 3: Implement case profiles and argument validation**

In `tests/eval/run.js`, define the approved core IDs in the listed order and all IDs from the catalog. Parse `--full` as a boolean, reject repeated `--full`, and reject `--full` with any `--case` before starting a Runner.

Selection must be:

```js
function selectedCaseIds(caseIds, full) {
  const selected = caseIds == null
    ? [...(full ? ALL_CASE_IDS : CORE_CASE_IDS)]
    : [...new Set(caseIds)];
  for (const id of selected) {
    if (!ALL_CASE_ID_SET.has(id)) throw new Error(`Unknown behavior eval case: ${id}`);
  }
  return selected;
}
```

Pass `full` from `main` through `runBehaviorEval`. Add to `package.json`:

```json
"eval:full": "node tests/eval/run.js --full"
```

- [ ] **Step 4: Verify core defaults, full selection and explicit cases**

Run: `node --test tests/eval/agents.test.js tests/contract/behavior-cases.test.js`

Run: `node tests/validate.js`

Expected: PASS. Fake Runner tests must observe 8 default invocations, 20 full invocations, and only requested IDs for `--case`.

- [ ] **Step 5: Commit eval profiles**

```bash
git add tests/eval/run.js tests/eval/agents.test.js tests/contract/behavior-cases.test.js package.json tests/validate.js
git commit -m "perf: add core live eval profile"
```

---

### Task 3: Compact Evaluation Output Protocol

**Files:**
- Modify: `tests/eval/run.js`
- Modify: `tests/eval/agents.test.js`
- Modify: `tests/contract/prompt-budget.test.js`

**Interfaces:**
- Produces: `evaluationProtocol(caseDefinition, invocation)` and `buildEvaluationPrompt(caseDefinition, evalDefinition, runner)`.
- Preserves: existing response schema, grader fields and raw-JSON-only output.

- [ ] **Step 1: Enable the skipped protocol budget and add behavior assertions**

Require the protocol to remain within 500 Unicode characters and contain:

```js
for (const required of [
  'case_id', 'SCOPED', 'GROUPED', 'STRICT', 'code', 'comments',
  'covered_executable_lines', 'comment_count',
  'executable_statement_count', 'independently_commented_statement_count',
  'json_comments_added', 'explanation',
]) assert.match(protocol, new RegExp(required));
```

Add one positive invocation test and one read-only negative-case test.

- [ ] **Step 2: Run protocol tests and verify RED**

Run: `node --test tests/contract/prompt-budget.test.js tests/eval/agents.test.js`

Expected: FAIL because the current repeated protocol is about 831 characters and is not exported.

- [ ] **Step 3: Extract and compact the protocol**

Implement one concise paragraph that keeps every required field and dynamic rule:

```js
export function evaluationProtocol(caseDefinition, invocation) {
  const useRule = caseDefinition.should_invoke
    ? `Use ${invocation}.`
    : 'Read-only case: do not edit or claim a full-diff workflow.';
  return `${useRule} Return one raw JSON object: case_id="${caseDefinition.id}"; mode=SCOPED|GROUPED|STRICT; language; code without fences; explanation with the mode and review result; comments with each added/updated comment text, kind, covered_executable_lines; matching comment_count, executable_statement_count, independently_commented_statement_count, json_comments_added. JSON cases add no comments.`;
}
```

`buildEvaluationPrompt` must append only this protocol to the original case prompt. If the exact string exceeds 500 characters after formatting, shorten punctuation or field connectors without removing any required field.

- [ ] **Step 4: Run protocol, schema and grader tests**

Run: `node --test tests/contract/prompt-budget.test.js tests/eval/agents.test.js tests/contract/behavior-cases.test.js`

Expected: PASS with the same schema and grader behavior.

- [ ] **Step 5: Commit protocol compression**

```bash
git add tests/eval/run.js tests/eval/agents.test.js tests/contract/prompt-budget.test.js
git commit -m "perf: compact live eval protocol"
```

---

### Task 4: Documentation, Full Verification and Candidate Installation

**Files:**
- Modify: `README.md`
- Review: all files changed since `990aae1`

**Interfaces:**
- Documents: core eval, full eval, prompt budgets and model-cost boundary.
- Verifies: package, installation state, implicit invocation and comment quality.

- [ ] **Step 1: Update README with accurate commands and counts**

Document:

```bash
npm run eval -- --agent codex
npm run eval:full -- --agent codex
npm run eval -- --agent codex --case json-no-comments,read-only-explanation
```

State that default eval runs 8 core cases, full eval runs all 20, smoke runs one model session, and deterministic checks never call a model. Replace both stale references to 19 cases with 20.

- [ ] **Step 2: Run the complete deterministic gate**

Run: `npm run check`

Expected: all deterministic tests and validation pass without model calls.

Run: `npm pack --dry-run`

Expected: package contains only the approved runtime files and succeeds on Node.js 22+.

- [ ] **Step 3: Measure and record the final reduction**

Run the prompt-budget test and report actual before/after values for description, Skill body, global policy, Codex default prompt, rendered policies, combined UTF-8 bytes, protocol characters, and default/full model call counts. Acceptance requires combined bytes `<= 6_200`, default calls `8`, and full calls `20`.

- [ ] **Step 4: Install the candidate from the local Node CLI**

Run: `node bin/chinese-code-comments.js install`

Expected: six agents and three Skill groups update successfully.

Run: `node bin/chinese-code-comments.js doctor`

Expected: every Skill, policy and state row is `ok`; missing external Agent CLIs remain informational.

- [ ] **Step 5: Run one real Codex smoke**

Run: `npm run smoke -- --agent codex`

Expected: one model session passes implicit prompt, Skill read before edit, atomic callback guard, restrained Chinese comments, complete diff evidence and final review report.

- [ ] **Step 6: Execute the required complete-diff comment review**

Use `$chinese-code-comments` in `SCOPED` mode. Review `git diff 990aae1..HEAD` plus untracked files, preserve accurate comments, remove redundant or stale comments, and confirm code comments explain only non-obvious constraints. Re-run only checks affected by any review edits.

- [ ] **Step 7: Commit documentation and final verification state**

```bash
git add README.md
git commit -m "docs: explain token-efficient evaluation"
```

- [ ] **Step 8: Push commits and verify the remote branch**

Run: `git -c http.sslVerify=true push origin main`

Expected: `origin/main` advances to the final local commit and the worktree is clean.
