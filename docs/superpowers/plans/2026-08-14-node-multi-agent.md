# Node.js Multi-Agent Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every PowerShell user and maintainer entry point with a Node.js 22+ CLI that installs, uninstalls, diagnoses, tests, evaluates, and smoke-tests the same code-comment Skill across six formally supported Agents.

**Architecture:** Keep `SKILL.md` as the only comment policy and use a dependency-free ESM Node CLI for distribution. A shared transaction engine writes three Skill storage groups and six adapter-specific global policy blocks; deterministic Node tests protect behavior while explicitly selected live runners invoke external Agent CLIs.

**Tech Stack:** Node.js 22+, ESM, `node:test`, `node:assert/strict`, Node standard library, GitHub Actions.

## Global Constraints

- The project only generates, updates, and reviews code comments; no unrelated capability may be added.
- Runtime and deterministic maintenance require Node.js 22 or newer on Windows, macOS, and Linux.
- The installer has no runtime third-party dependencies and does not use PowerShell, Python, or language-specific toolchains.
- `SKILL.md` remains one Agent Skills-compatible source of truth; adapter policy files may only express loading and automatic-trigger behavior.
- Default installation targets Codex, Claude Code, Gemini CLI, Grok CLI, OpenCode, and Hermes; `--agent` narrows the target set.
- The full installer copies to three storage groups and must not use symbolic links.
- Existing accurate comments and non-managed user content remain untouched.
- Install and uninstall preflight every target, stage changes, commit transactionally, and reverse committed changes after failure.
- Live eval and smoke commands require an explicit `--agent` and are excluded from deterministic CI.
- Do not create Git commits unless the user explicitly authorizes them; each task ends with a review checkpoint instead.

---

## File Map

### Runtime

- `package.json`: package metadata, Node floor, `bin`, and all user/maintenance scripts.
- `package-lock.json`: reproducible npm package metadata.
- `bin/chinese-code-comments.js`: executable ESM entry point and exit-code boundary.
- `src/cli.js`: argument parsing, command dispatch, help, and version output.
- `src/adapters/*.js`: one declarative adapter per supported Agent.
- `src/adapters/index.js`: adapter aliases, selection, and shared storage-group lookup.
- `src/policies/render.js`: render the shared policy body with adapter invocation wording and markers.
- `src/files/text.js`: strict UTF-8 decoding and BOM/newline preservation.
- `src/files/managed-block.js`: validate, insert, replace, and remove one managed policy block.
- `src/transaction.js`: stage, commit, rollback, cleanup, and test-only fault injection.
- `src/state.js`: versioned installation state and shared Skill reference sets.
- `src/install.js`: build and execute an installation transaction.
- `src/uninstall.js`: build and execute a selected or complete uninstall transaction.
- `src/doctor.js`: read-only installation consistency diagnostics.
- `resources/global-policy.md`: marker-free shared automatic-comment policy template.

### Deterministic Tests

- `tests/helpers/fs-fixture.js`: isolated temporary homes and byte snapshots.
- `tests/unit/cli.test.js`: command and `--agent` parsing.
- `tests/unit/adapters.test.js`: six path and policy contracts.
- `tests/unit/text.test.js`: encoding and newline behavior.
- `tests/unit/managed-block.test.js`: block validation and preservation.
- `tests/integration/install.test.js`: full, selected, idempotent, and legacy installs.
- `tests/integration/uninstall.test.js`: reference-aware partial and full removal.
- `tests/integration/transaction.test.js`: every commit failure, rollback failure, and cleanup warning.
- `tests/integration/doctor.test.js`: healthy and drifted installation reports.
- `tests/contract/skill.test.js`: current Skill workflow contract.
- `tests/contract/behavior-cases.test.js`: current 19-case classification and grader regression suite.
- `tests/validate.js`: package, repository, docs, and no-PowerShell validation.

### Live Evaluation

- `tests/eval/process.js`: cross-platform process discovery, spawning, timeout, and UTF-8 capture.
- `tests/eval/agents/*.js`: six official headless command builders and output normalizers.
- `tests/eval/agents/index.js`: live runner selection.
- `tests/eval/comments.js`: source comment extraction and normalized inventory comparison.
- `tests/eval/syntax.js`: dependency-free structural and language-specific checks.
- `tests/eval/schema.js`: exact validation of behavior-eval JSON output.
- `tests/eval/grader.js`: port of every current per-case assertion.
- `tests/eval/run.js`: 19-case selected-Agent runner.
- `tests/eval/smoke.js`: no-comment-word real write smoke for one selected Agent.

### Repository and Documentation

- `.github/workflows/ci.yml`: Node 22 matrix for Windows, macOS, and Linux.
- `README.md`: GitHub `npx`, Agent Skills, adapters, commands, limits, and troubleshooting.
- `.gitignore`: Node coverage, logs, and local result artifacts.
- Delete `scripts/*.ps1` and `tests/*.ps1` only after their Node replacements pass.

---

### Task 1: Node Package and CLI Contract

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `bin/chinese-code-comments.js`
- Create: `src/cli.js`
- Create: `tests/unit/cli.test.js`

**Interfaces:**
- Produces: `main({ argv, env, stdout, stderr }): Promise<number>`.
- Produces: `parseArgs(argv): { command, agents }` where `command` is `install | uninstall | doctor | help | version` and `agents` is `null | string[]`.
- Later tasks register `installCommand`, `uninstallCommand`, and `doctorCommand` without changing the public CLI grammar.

- [ ] **Step 1: Write CLI tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../../src/cli.js';

test('install defaults to every adapter', () => {
  assert.deepEqual(parseArgs(['install']), { command: 'install', agents: null });
});

test('--agent accepts repeated and comma-separated ids', () => {
  assert.deepEqual(
    parseArgs(['install', '--agent', 'codex,claude', '--agent', 'gemini']),
    { command: 'install', agents: ['codex', 'claude', 'gemini'] },
  );
});

test('unknown options fail before dispatch', () => {
  assert.throws(() => parseArgs(['install', '--force']), /Unknown option: --force/);
});
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

Run: `node --test tests/unit/cli.test.js`

Expected: FAIL because `src/cli.js` does not exist.

- [ ] **Step 3: Add the package and minimal CLI**

```json
{
  "name": "chinese-code-comments",
  "version": "0.1.0",
  "description": "Install automatic, concise code-comment rules for coding agents.",
  "type": "module",
  "bin": { "chinese-code-comments": "./bin/chinese-code-comments.js" },
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test",
    "validate": "node tests/validate.js",
    "check": "npm test && npm run validate",
    "eval": "node tests/eval/run.js",
    "smoke": "node tests/eval/smoke.js"
  },
  "license": "Apache-2.0"
}
```

Implement `parseArgs` as a single forward scan. Normalize aliases later in the adapter registry; at this layer trim IDs, reject an empty value, and preserve first-seen order while removing exact duplicates. The executable calls `main`, writes uncaught messages to stderr, and assigns `process.exitCode` without calling `process.exit()`.

- [ ] **Step 4: Generate the lock file and verify the CLI**

Run: `npm install --package-lock-only --ignore-scripts`

Run: `node --test tests/unit/cli.test.js`

Run: `node bin/chinese-code-comments.js --help`

Expected: tests pass and help lists `install`, `uninstall`, `doctor`, and `--agent`.

- [ ] **Step 5: Review checkpoint**

Review `git diff -- package.json package-lock.json bin src/cli.js tests/unit/cli.test.js`; confirm no command performs file writes yet.

### Task 2: Adapter Registry and Shared Policy Rendering

**Files:**
- Create: `src/adapters/codex.js`
- Create: `src/adapters/claude.js`
- Create: `src/adapters/gemini.js`
- Create: `src/adapters/grok.js`
- Create: `src/adapters/opencode.js`
- Create: `src/adapters/hermes.js`
- Create: `src/adapters/index.js`
- Create: `src/policies/render.js`
- Replace: `resources/global-agents-block.md` with `resources/global-policy.md`
- Create: `tests/unit/adapters.test.js`

**Interfaces:**
- Produces: `ADAPTER_IDS`, exactly `['codex', 'claude', 'gemini', 'grok', 'opencode', 'hermes']`.
- Produces: `selectAdapters(ids, context): Adapter[]`.
- `Adapter` fields: `{ id, aliases, storageGroup, skillRoot(context), policyFile(context), invocation, markers }`.
- Produces: `renderPolicy(adapter, template, eol): string`.

- [ ] **Step 1: Write adapter path and rendering tests**

```js
test('formal adapters resolve approved global paths', () => {
  const context = { home: '/home/tester', env: {}, platform: 'linux' };
  const adapters = selectAdapters(null, context);
  assert.deepEqual(adapters.map((item) => item.id), ADAPTER_IDS);
  assert.equal(adapters.find((item) => item.id === 'codex').policyFile(context), '/home/tester/.codex/AGENTS.md');
  assert.equal(adapters.find((item) => item.id === 'claude').policyFile(context), '/home/tester/.claude/CLAUDE.md');
  assert.equal(adapters.find((item) => item.id === 'gemini').policyFile(context), '/home/tester/.gemini/GEMINI.md');
  assert.equal(adapters.find((item) => item.id === 'grok').policyFile(context), '/home/tester/.grok/AGENTS.md');
  assert.equal(adapters.find((item) => item.id === 'opencode').policyFile(context), '/home/tester/.config/opencode/AGENTS.md');
  assert.equal(adapters.find((item) => item.id === 'hermes').policyFile(context), '/home/tester/.hermes/SOUL.md');
});

test('Hermes policy has visible markers and no HTML comments', () => {
  const output = renderPolicy(adapter('hermes'), template, '\n');
  assert.match(output, /^## chinese-code-comments managed policy: start/m);
  assert.doesNotMatch(output, /<!--/);
});
```

- [ ] **Step 2: Run the adapter tests and confirm failure**

Run: `node --test tests/unit/adapters.test.js`

Expected: FAIL because the adapter registry does not exist.

- [ ] **Step 3: Implement six declarative adapters**

Use `path.join`, never hand-built separators. The four shared adapters return `~/.agents/skills`; Claude and Hermes return native roots. Respect documented environment overrides (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `GEMINI_CLI_HOME`, `GROK_HOME`, `XDG_CONFIG_HOME`, and `HERMES_HOME`) only in the corresponding adapter and fall back to `context.home`.

The marker-free template retains the current policy clauses. `renderPolicy` substitutes `{{skill_invocation}}`; Codex uses `$chinese-code-comments`, and all other adapters use `the skill named chinese-code-comments`.

- [ ] **Step 4: Verify adapter selection and policy snapshots**

Run: `node --test tests/unit/adapters.test.js`

Expected: all six paths, aliases, storage groups, invocations, and marker styles pass.

- [ ] **Step 5: Review checkpoint**

Confirm each adapter only contains integration metadata and that all comment behavior remains in `SKILL.md` plus the shared policy template.

### Task 3: Strict UTF-8 and Managed Blocks

**Files:**
- Create: `src/files/text.js`
- Create: `src/files/managed-block.js`
- Create: `tests/unit/text.test.js`
- Create: `tests/unit/managed-block.test.js`

**Interfaces:**
- Produces: `decodeText(buffer, label): { text, bom, eol, finalNewline }`.
- Produces: `encodeText(text, metadata): Buffer`.
- Produces: `upsertManagedBlock(current, block, markers): string`.
- Produces: `removeManagedBlock(current, markers): { text, removed }`.

- [ ] **Step 1: Write byte-preservation and malformed-marker tests**

```js
test('UTF-8 BOM and CRLF metadata round-trip', () => {
  const input = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('用户规则\r\n')]);
  const decoded = decodeText(input, 'rules');
  assert.equal(decoded.bom, true);
  assert.equal(decoded.eol, '\r\n');
  assert.deepEqual(encodeText(decoded.text, decoded), input);
});

test('incomplete markers are rejected without changing text', () => {
  assert.throws(
    () => upsertManagedBlock('before\n<!-- chinese-code-comments:start -->\n', 'policy', HTML_MARKERS),
    /incomplete chinese-code-comments block/,
  );
});
```

Also cover UTF-16 BOM, NUL, invalid UTF-8, duplicate starts, duplicate ends, reversed markers, no final newline, an empty file, and user text before and after a valid block.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test tests/unit/text.test.js tests/unit/managed-block.test.js`

Expected: FAIL because the file helpers do not exist.

- [ ] **Step 3: Implement strict decoding and block operations**

Use `new TextDecoder('utf-8', { fatal: true })`; detect UTF-16 BOM and NUL before decoding. Preserve BOM and dominant newline metadata for existing files. New files use `{ bom: false, eol: '\n', finalNewline: true }`.

`upsertManagedBlock` counts literal start and end markers, validates one ordered pair at most, and either replaces the exact inclusive range or appends one blank-line-separated block. `removeManagedBlock` removes the inclusive range and at most the separator introduced by installation.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/unit/text.test.js tests/unit/managed-block.test.js`

Expected: PASS with byte-identical preservation outside the managed block.

- [ ] **Step 5: Review checkpoint**

Check that no decoding path falls back to a local code page and Hermes markers never pass through HTML-marker constants.

### Task 4: Transaction Engine, State, and Install

**Files:**
- Create: `src/transaction.js`
- Create: `src/state.js`
- Create: `src/install.js`
- Create: `tests/helpers/fs-fixture.js`
- Create: `tests/integration/transaction.test.js`
- Create: `tests/integration/install.test.js`
- Modify: `src/cli.js`

**Interfaces:**
- Produces: `executeTransaction(entries, options): Promise<{ warnings: string[] }>`.
- `entries` contain `{ target, content: Buffer | null, kind }`; `null` means delete.
- Produces: `readState(context): Promise<InstallState>` and `serializeState(state): Buffer`.
- `InstallState` is `{ schemaVersion: 1, installerVersion, agents: string[], storageGroups: Record<string, string[]> }`.
- Produces: `install({ agents, context, sourceRoot, fault }): Promise<InstallResult>`.

- [ ] **Step 1: Write transaction failure tests**

```js
test('a commit failure restores every earlier target byte-for-byte', async (t) => {
  const fixture = await createFixture(t, { 'a.txt': 'old-a', 'b.txt': 'old-b' });
  const before = await fixture.snapshot();
  await assert.rejects(
    executeTransaction(fixture.entries(['new-a', 'new-b']), { fault: { phase: 'commit', index: 1 } }),
    /Injected commit failure at index 1/,
  );
  assert.deepEqual(await fixture.snapshot(), before);
  assert.deepEqual(await fixture.transactionArtifacts(), []);
});
```

Cover every entry index, new files, existing files, rollback failure aggregation, and cleanup failure returning a warning after committed content remains installed.

- [ ] **Step 2: Write install lifecycle tests**

Create a temporary home and source root. Assert default install creates three Skill copies, six policy blocks, and state references; `--agent codex,gemini` creates one shared Skill and two policies; a second install is byte-identical; an occupied directory/file target fails before any write; and the legacy Codex HTML block upgrades in place.

- [ ] **Step 3: Run integration tests and confirm failure**

Run: `node --test tests/integration/transaction.test.js tests/integration/install.test.js`

Expected: FAIL because transaction and install modules do not exist.

- [ ] **Step 4: Implement transaction and state primitives**

Stage unique files beside each target using `crypto.randomUUID()`. Snapshot existing bytes to same-directory backups, create missing directories while recording them, commit in stable target-path order, and roll back committed entries in reverse order. Cleanup warnings are returned after successful commit; rollback errors are appended to the original error.

Store state at `~/.chinese-code-comments/state.json`. Installing a subset unions its adapters into existing state. Recompute each storage-group member list from installed adapters instead of incrementing counters, which keeps repeated installs idempotent.

- [ ] **Step 5: Implement install plan construction and CLI dispatch**

For every selected storage group, install `SKILL.md`; include `agents/openai.yaml` only in the shared `agents` copy. For every selected adapter, decode its policy file, render with that file's newline, and upsert its block. Add the state file as the final transaction entry.

Wire `main` to call `install` and print one line per installed storage group and updated policy. Unknown adapter IDs fail before filesystem access.

- [ ] **Step 6: Run integration and CLI tests**

Run: `node --test tests/unit/cli.test.js tests/integration/transaction.test.js tests/integration/install.test.js`

Expected: PASS, including injected failure rollback.

- [ ] **Step 7: Review checkpoint**

Inspect the full install diff for preflight side effects, unstable ordering, accidental user-file replacement, and state updates committed before policy files.

### Task 5: Reference-Aware Uninstall and Doctor

**Files:**
- Create: `src/uninstall.js`
- Create: `src/doctor.js`
- Create: `tests/integration/uninstall.test.js`
- Create: `tests/integration/doctor.test.js`
- Modify: `src/cli.js`

**Interfaces:**
- Produces: `uninstall({ agents, context, fault }): Promise<UninstallResult>`.
- Produces: `doctor({ agents, context, sourceRoot }): Promise<{ healthy, checks }>`.
- `checks` entries are `{ agent, subject, status: 'ok' | 'missing' | 'drift' | 'invalid', path, message }`.

- [ ] **Step 1: Write partial/full uninstall tests**

```js
test('partial uninstall keeps a shared Skill used by another adapter', async (t) => {
  const fixture = await installedFixture(t, ['codex', 'gemini']);
  await uninstall({ agents: ['codex'], context: fixture.context });
  assert.equal(await fixture.exists('.agents/skills/chinese-code-comments/SKILL.md'), true);
  assert.equal(await fixture.hasPolicy('codex'), false);
  assert.equal(await fixture.hasPolicy('gemini'), true);
});
```

Also assert full removal, repeated uninstall, preservation of extra Skill files, conservative shared-group retention when state is missing, empty-directory cleanup, and transactional rollback.

- [ ] **Step 2: Write doctor drift tests**

Test a healthy all-Agent install; a stale `SKILL.md`; a missing policy; malformed markers; state/reference mismatch; and a missing Agent executable reported as informational rather than installation drift.

- [ ] **Step 3: Run tests and confirm failure**

Run: `node --test tests/integration/uninstall.test.js tests/integration/doctor.test.js`

Expected: FAIL because the commands are not implemented.

- [ ] **Step 4: Implement uninstall and doctor**

Uninstall removes selected policy blocks, subtracts selected adapters from state, and deletes a storage group's managed files only when its recomputed member list is empty. Without valid state, partial uninstall retains shared files; full uninstall removes declared managed files but preserves unknown files and non-empty directories.

Doctor computes SHA-256 for managed runtime files, validates one complete block per selected adapter, checks state references, and probes executables with `spawnSync`-free PATH lookup that handles Windows `PATHEXT`. It prints a compact table and returns exit code 1 for missing, drifted, or invalid managed content.

- [ ] **Step 5: Run lifecycle tests**

Run: `node --test tests/integration/install.test.js tests/integration/uninstall.test.js tests/integration/doctor.test.js`

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Verify uninstall cannot delete a user-created file and doctor never writes state while diagnosing a missing or damaged installation.

### Task 6: Port Skill Contract and 19-Case Deterministic Grader

**Files:**
- Create: `tests/contract/skill.test.js`
- Create: `tests/contract/behavior-cases.test.js`
- Create: `tests/eval/comments.js`
- Create: `tests/eval/syntax.js`
- Create: `tests/eval/schema.js`
- Create: `tests/eval/grader.js`
- Keep: `tests/behavior-cases.json`
- Keep: `tests/behavior-eval-output.schema.json`
- Keep: `evals/evals.json`

**Interfaces:**
- Produces: `extractComments(language, code): CommentRecord[]`.
- Produces: `validateResponse(value): string[]` returning exact schema errors.
- Produces: `gradeCase(caseDefinition, response): GradingResult`.
- `GradingResult` retains `{ caseId, passed, checks, summary }` used by live eval.

- [ ] **Step 1: Port Skill contract assertions**

Translate every assertion in `skill-contract.tests.ps1` to `node:test`, including frontmatter, default language, SCOPED/GROUPED/STRICT rules, negative universal phrases, two-stage diff review, preservation of accurate comments, unsupported formats, and conditional auxiliary-skill use.

- [ ] **Step 2: Port grader regression fixtures before implementation**

Move the valid and intentionally invalid response fixtures currently embedded in `behavior-cases.tests.ps1` into JavaScript objects. For each fixture, assert the same pass/fail result and named failed check. Include the regression that rejects extra source comments omitted from `response.comments`.

- [ ] **Step 3: Run contract tests and confirm grader imports fail**

Run: `node --test tests/contract/skill.test.js tests/contract/behavior-cases.test.js`

Expected: Skill text assertions pass; grader tests fail because the Node grader is absent.

- [ ] **Step 4: Port schema, comment inventory, syntax, and per-case checks**

Keep the JSON schema exact: reject unknown keys, wrong primitive types, invalid mode/language/kind values, negative counts, and incomplete comment objects. Port every case branch from `Invoke-CaseGrading`, including Java callback idempotency, C bounds/ownership, grouped/strict Python metrics, React synchronization, C++ move ordering, PostgreSQL partial uniqueness, Terraform availability, JSON comment prohibition, preserved English comments, stale-comment replacement, and read-only no-diff reporting.

Replace Python/JDK parser subprocesses with deterministic Node structural checks already represented by the current regex and delimiter assertions. The grader must not claim compiler-level validation when it performs structural validation.

- [ ] **Step 5: Run contract and grader tests**

Run: `node --test tests/contract/skill.test.js tests/contract/behavior-cases.test.js`

Expected: all current positive and negative grader fixtures pass with no external executable.

- [ ] **Step 6: Review checkpoint**

Compare every `Add-AssertionResult` call in the PowerShell grader with a named Node assertion; record a one-to-one checklist in the review notes before deleting the old file.

### Task 7: Six Live Agent Runners and Behavior Eval

**Files:**
- Create: `tests/eval/process.js`
- Create: `tests/eval/agents/codex.js`
- Create: `tests/eval/agents/claude.js`
- Create: `tests/eval/agents/gemini.js`
- Create: `tests/eval/agents/grok.js`
- Create: `tests/eval/agents/opencode.js`
- Create: `tests/eval/agents/hermes.js`
- Create: `tests/eval/agents/index.js`
- Create: `tests/eval/run.js`
- Create: `tests/eval/agents.test.js`

**Interfaces:**
- Produces: `runProcess({ command, args, cwd, stdin, env, timeoutMs }): Promise<ProcessResult>`.
- Each runner produces `buildInvocation({ prompt, cwd, outputFile }): { command, args, stdin, env }` and `normalizeOutput(result): { finalText, events }`.
- Produces: `runBehaviorEval({ agent, resultsRoot, caseIds }): Promise<EvalSummary>`.

- [ ] **Step 1: Write command-builder tests with fake executables**

Assert exact non-interactive invocations:

```js
assert.deepEqual(buildCodex(input).args.slice(0, 6), ['-a', 'never', 'exec', '--ephemeral', '-s', 'workspace-write']);
assert.deepEqual(buildClaude(input).args, ['-p', input.prompt, '--output-format', 'json', '--permission-mode', 'acceptEdits']);
assert.deepEqual(buildGemini(input).args, ['-p', input.prompt, '--output-format', 'stream-json', '--approval-mode', 'yolo']);
assert.deepEqual(buildGrok(input).args, ['--no-auto-update', '-p', input.prompt, '--output-format', 'streaming-json', '--always-approve']);
assert.deepEqual(buildOpenCode(input).args, ['run', '--format', 'json', input.prompt]);
assert.deepEqual(buildHermes(input).args, ['chat', '--quiet', '--toolsets', 'terminal,skills', '-q', input.prompt]);
```

Fake executables emit representative JSON/JSONL/plain output so normalizers can be tested without model calls. Windows tests use a temporary `.cmd` shim and POSIX tests use an executable Node shim.

- [ ] **Step 2: Run runner tests and confirm failure**

Run: `node --test tests/eval/agents.test.js`

Expected: FAIL because runners do not exist.

- [ ] **Step 3: Implement process and runner modules**

Use `spawn` with argument arrays, UTF-8 pipes, concurrent stdout/stderr collection, timeout termination, and exit diagnostics. Never invoke a shell. Resolve `.cmd`/`.exe` on Windows through `PATHEXT`; when npm exposes a `.ps1` wrapper, prefer its sibling `.cmd` or the package's Node entry point so the project does not require PowerShell.

Preserve each Agent's raw output under the selected result directory. Normalizers extract assistant text and tool/file events without assuming every Agent emits Codex JSONL fields.

- [ ] **Step 4: Implement the 19-case run loop**

Require `--agent <one-id>` before checking credentials. Initialize one isolated workspace per case, write input fixtures and nearest project language rules, invoke the selected runner, parse the requested structured response, call `gradeCase`, and write `response.json`, `grading.json`, raw stdout, raw stderr, and a summary JSON.

- [ ] **Step 5: Run deterministic runner tests**

Run: `node --test tests/eval/agents.test.js tests/contract/behavior-cases.test.js`

Expected: PASS without contacting an Agent.

- [ ] **Step 6: Run one explicitly selected live case when credentials are available**

Run: `npm run eval -- --agent codex --case self-explanatory-write`

Expected: one passing grading result or a clear nonzero authentication/CLI protocol error. Do not run all 19 cases until the single-case protocol is verified.

- [ ] **Step 7: Review checkpoint**

Check each command against its official headless documentation and verify no runner uses a mode that suppresses user rules or Skill discovery.

### Task 8: Cross-Agent Global Write Smoke

**Files:**
- Create: `tests/eval/smoke.js`
- Create: `tests/eval/smoke.test.js`
- Modify: `tests/eval/agents/*.js` only if smoke exposes a normalized-event gap.

**Interfaces:**
- Produces: `runSmoke({ agent, resultsRoot }): Promise<SmokeResult>`.
- `SmokeResult` contains policy/Skill discovery evidence, diff evidence, comment inventory, side-effect count, final review evidence, and raw result paths.

- [ ] **Step 1: Port the existing smoke regression tests**

Use the current Java payment fixture and prompt, preserving the requirement that the prompt contains no Chinese or English word for comments. Feed fixture JSONL through the new event normalizer and assert event ordering, full diff inclusion, one actual callback side effect, restrained Chinese comment count, and final review reporting.

- [ ] **Step 2: Run smoke regression tests and confirm failure**

Run: `node --test tests/eval/smoke.test.js`

Expected: FAIL because `runSmoke` does not exist.

- [ ] **Step 3: Implement selected-Agent smoke**

Require one `--agent`, verify its installed runtime with `doctor`, create and commit the isolated fixture, invoke the runner, inspect `git diff -- PaymentService.java`, and grade source comments plus the final response. Use a Node-side behavioral assertion instead of requiring `javac`: inspect the edited method and execute an equivalent callback-count fixture maintained by the test harness.

- [ ] **Step 4: Run deterministic smoke regression tests**

Run: `node --test tests/eval/smoke.test.js`

Expected: PASS on all three operating systems without an external Agent.

- [ ] **Step 5: Run one real smoke after its adapter install is current**

Run: `node bin/chinese-code-comments.js install --agent codex`

Run: `npm run smoke -- --agent codex`

Expected: real file diff, valid high-value comment, one callback side effect, and complete comment-review report.

- [ ] **Step 6: Review checkpoint**

Verify the smoke proves automatic triggering rather than embedding a Skill invocation or comment request in its prompt.

### Task 9: Validation, CI, and PowerShell Removal

**Files:**
- Create: `tests/validate.js`
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore`
- Delete: `scripts/install.ps1`
- Delete: `scripts/uninstall.ps1`
- Delete: `tests/assert-installed-runtime.ps1`
- Delete: `tests/behavior-cases.tests.ps1`
- Delete: `tests/global-write-smoke.ps1`
- Delete: `tests/global-write-smoke.tests.ps1`
- Delete: `tests/install.tests.ps1`
- Delete: `tests/run-all.ps1`
- Delete: `tests/run-behavior-evals.ps1`
- Delete: `tests/skill-contract.tests.ps1`

**Interfaces:**
- Produces: `npm run validate` with zero model calls and nonzero status for any repository contract failure.
- Produces: `npm run check` as the complete deterministic gate.

- [ ] **Step 1: Write validation checks before deleting PowerShell**

`tests/validate.js` checks Node major version, package name/version/bin/engine/scripts, executable shebang, parseable JSON files, exact Skill frontmatter name/description, `agents/openai.yaml` required keys, all README command references, and every expected runtime/test file. Add a temporary expected failure while `.ps1` files still exist.

- [ ] **Step 2: Add the three-platform workflow**

```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  check:
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci --ignore-scripts
      - run: npm run check
```

- [ ] **Step 3: Run every Node replacement before deletion**

Run: `npm test`

Expected: all unit, integration, contract, runner, and smoke regression tests pass.

- [ ] **Step 4: Delete PowerShell sources and update ignore rules**

Delete only the listed `.ps1` files after their corresponding Node suites pass. Ignore `coverage/`, `*.log`, and local eval/smoke result directories without ignoring committed JSON fixtures.

- [ ] **Step 5: Run the deterministic gate**

Run: `npm run check`

Run: `git diff --check`

Expected: both pass and `rg --files -g '*.ps1'` returns no paths.

- [ ] **Step 6: Review checkpoint**

Compare deleted PowerShell entry points against package scripts and ensure every previous user or maintainer operation has one Node replacement.

### Task 10: User-First README, Migration Notes, and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-12-chinese-code-comments-design.md`
- Modify: `docs/superpowers/plans/2026-08-12-chinese-code-comments.md`
- Modify: `docs/superpowers/specs/2026-08-14-node-multi-agent-design.md` only if implementation reveals an approved factual correction.

**Interfaces:**
- Documents the exact CLI and npm script interfaces implemented in Tasks 1-9.

- [ ] **Step 1: Rewrite Quick Start around the two installation entries**

Lead with Node.js 22+ and the complete GitHub command:

```bash
npx --yes github:xuanjinchen/chinese-code-comments install
```

Immediately contrast it with `npx skills add xuanjinchen/chinese-code-comments -g --all`, stating that the standard entry installs the Skill but not global automatic-trigger policies.

- [ ] **Step 2: Document supported Agents and lifecycle commands**

Include the six policy paths, three Skill storage groups, default-all behavior, comma/repeated `--agent`, upgrade-by-install, partial/full uninstall, `doctor`, Hermes `SOUL.md` visible block, and the rule that model APIs require a concrete Agent host.

- [ ] **Step 3: Replace all maintenance and troubleshooting commands**

Use `npm test`, `npm run validate`, `npm run check`, `npm run eval -- --agent <id>`, and `npm run smoke -- --agent <id>`. Explain that live commands require the selected CLI and login and never run in default CI.

- [ ] **Step 4: Mark historical PowerShell documents as superseded**

Keep historical decisions intact but add a prominent note linking to the 2026-08-14 design and plan. Remove any current-tense claim that users should run `.ps1` files.

- [ ] **Step 5: Run final deterministic and packaging checks**

Run: `npm run check`

Run: `npm pack --dry-run`

Run: `node bin/chinese-code-comments.js install --agent codex`

Run: `node bin/chinese-code-comments.js doctor --agent codex`

Run: `git diff --check`

Expected: deterministic checks pass; the package contains `SKILL.md`, `agents/openai.yaml`, `resources/global-policy.md`, `bin`, and `src`; Codex install and doctor are healthy; no whitespace errors exist.

- [ ] **Step 6: Perform the mandatory code-comment review**

Read the complete `git diff` plus untracked deliverable files using `$chinese-code-comments`. Confirm comments only explain non-obvious encoding, transaction, rollback, process, compatibility, and ownership constraints; remove narration of obvious assignments and update any stale English comments affected by the migration.

- [ ] **Step 7: Final review checkpoint**

Report changed files, deterministic verification, any explicitly run live Agent result, skipped live Agents, and the completed full-diff comment review. Do not commit or push without explicit authorization.
