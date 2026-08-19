# Skill Development Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish `xuanjinchen/skill-development-scaffold`, an executable Node.js template repository that turns one concrete Skill objective into a ready development workspace without recreating structure, tests, evaluation records, or quality gates.

**Architecture:** A dependency-free Node.js initializer renders a closed set of templates into the current repository, records versioned state, and commits all file changes through a rollback-capable transaction. Deterministic validation supports scaffold-source and initialized-draft modes, while a stricter delivery gate verifies mature Skill evidence without invoking a model.

**Tech Stack:** Node.js 22+, ES modules, `node:test`, npm lockfile, GitHub Actions on Windows/macOS/Ubuntu, GitHub REST API for repository creation/template configuration, Markdown/YAML/JSON templates.

## Global Constraints

- Target local repository: sibling directory `skill-development-scaffold` under the current GitHub workspace.
- Target remote repository: public `xuanjinchen/skill-development-scaffold`.
- Use only Node.js standard library modules; no runtime or development package dependencies.
- Use UTF-8 without BOM and LF for all newly created text files.
- Default license is Apache-2.0; initializer also supports MIT and UNLICENSED.
- Initialization never modifies Git remotes, deletes Git history, pushes, publishes, or calls external models.
- All target paths are declared in code; reject absolute paths, traversal, duplicate targets, directories occupying file targets, and symlink file targets.
- `--dry-run` executes full preflight and rendering with zero file-system side effects.
- Same initialization arguments are an idempotent success; different arguments fail without writes.
- State is the final transaction target; its digests record provenance but never authorize overwriting later Agent edits.
- `npm run check` passes in source and initialized draft modes; `npm run gate:delivery` is deterministic and never fabricates live evaluation evidence.
- Optional Skill engineering tracks remain disabled until the concrete Skill Brief records their enabling evidence.
- Preserve unrelated changes in the source repository and never copy `chinese-code-comments` business rules into the scaffold.
- Before any code edit in either repository, load and use `$chinese-code-comments`; review the complete diff and untracked delivery files before completion.

## Evidence Contract v1

All evidence objects use `schema_version: 1`, reject unknown keys, and reject leading/trailing whitespace in string values. IDs are unique within their collection and match `CONFLICT-[0-9]+`, `REQ-[0-9]+`, `DEC-[0-9]+`, `EVAL-[0-9]+`, or `ASSERT-[0-9]+` as applicable.

- Skill Brief contract keys are exactly `schema_version`, `status`, `conflicts`, `acceptance_criteria`, `tracks`, and `prompt_budget`. Status is `draft` or `ready`. A conflict is `{ id, summary, status, resolution }`, where status is `open` or `resolved`, summary is non-empty, open requires an empty resolution, and resolved requires a non-empty resolution. An acceptance criterion is `{ id, requirement, verification, status }`, where status is `pending`, `pass`, or `blocked`; requirement is non-empty and delivery requires a non-empty verification plus `pass`.
- `tracks` has exactly `references`, `scripts`, `assets`, `implicit-trigger`, `multi-agent`, `installer`, and `open-source-release`. Each value is `{ status, evidence, unblock_condition }`; status is `enabled`, `disabled`, or `blocked`, evidence is always non-empty, blocked requires a non-empty unblock condition, and other statuses require an empty unblock condition.
- `prompt_budget` is `{ limit_tokens, measured_tokens, evidence }`. Draft values are `{ limit_tokens: null, measured_tokens: null, evidence: "" }`; delivery requires a positive integer limit, a non-negative integer measurement no greater than the limit, and non-empty evidence.
- Decision contract keys are `schema_version` and `decisions`. A decision is `{ id, status, scope, decision, evidence, supersedes }`; status is `active` or `superseded`, the three text fields are non-empty, and `supersedes` is `null` or a prior `DEC-*` ID without cycles.
- Evaluation contract keys are `schema_version`, `skill`, and `evals`. A case is `{ id, category, prompt, assertions, result }`; category is `positive`, `negative`, or `boundary`; prompts are unique, contain at least 20 Unicode code points, and contain no scaffold placeholder marker. Assertions are non-empty arrays of `{ id, text }`. Result is `{ status, evidence }`; `not-run` requires empty evidence, while `pass` or `fail` requires non-empty evidence. Delivery requires every case to pass.
- Delivery Report contract keys are `schema_version`, `requirements`, and `capability_claims`. A requirement trace is `{ id, implementation, verification, status }`, references one `REQ-*`, and uses status `pass` or `blocked`. A capability claim is `{ name, track, evidence }`, references one exact track key, and has non-empty strings. Delivery requires each acceptance ID exactly once with `pass`; claims may reference only enabled tracks.

Draft contracts may use empty conflicts, acceptance, decisions, evaluations, traces, and claims. Delivery requires at least one acceptance criterion, no open conflicts, and the stricter rules above. Markdown contracts use the exact markers declared in Task 9 followed immediately by one fenced JSON object; prose outside the contract is never treated as evidence.

---

### Task 1: Bootstrap the Independent Repository

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `README.md`
- Create: `docs/mature-skill-development-design.md`
- Create: `docs/mature-skill-development-plan.md`
- Create: `src/.gitkeep`
- Create: `scripts/.gitkeep`
- Create: `tests/.gitkeep`

**Interfaces:**
- Consumes: approved scaffold design
- Produces: clean Git repository, Node package metadata, deterministic command names

- [ ] **Step 1: Verify the target path is safe**

Resolve the target parent and confirm the final absolute target is exactly the approved sibling directory. If the target exists and is non-empty, stop and inspect it; do not delete or overwrite it.

- [ ] **Step 2: Create and initialize the repository**

Create the target directory, run `git init -b main`, and configure the local commit identity to the repository-approved GitHub noreply identity if it is not already configured.

- [ ] **Step 3: Write package metadata**

Create:

```json
{
  "name": "skill-development-scaffold",
  "version": "0.1.0",
  "description": "Executable Node.js scaffold for developing mature Agent Skills.",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "init:skill": "node scripts/init-skill.js",
    "test": "node --test",
    "validate": "node scripts/validate.js",
    "check": "npm test && npm run validate",
    "gate:delivery": "node scripts/delivery-gate.js"
  },
  "files": [
    "AGENTS.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "docs",
    "scripts",
    "src",
    "templates"
  ],
  "license": "Apache-2.0",
  "scaffold": {
    "mode": "source",
    "version": "0.1.0"
  }
}
```

- [ ] **Step 4: Generate the lockfile without scripts**

Run:

```bash
npm install --package-lock-only --ignore-scripts
```

Expected: package-lock v3 records the same name, version, license, engine, and zero dependencies.

- [ ] **Step 5: Add baseline public files**

Ignore `node_modules/`, coverage, temporary evaluation workspaces, transaction stage/backup files, logs, and OS/editor files. Use the canonical Apache-2.0 text without author email or local paths.

Create a minimal source README whose first line is the unique marker `<!-- skill-development-scaffold:source -->`; Task 10 will expand it into the user-first guide. Copy and sanitize the approved generic mature Skill design and implementation plan into their stable `docs/` paths now so source validation and isolated repository fixtures are executable before Task 10. Remove source-repository-specific links, private paths, release versions, and domain behavior while preserving layered tracks, requirement-change handling, evaluation, security, and acceptance gates.

- [ ] **Step 6: Verify metadata**

Run:

```bash
node --version
npm install --package-lock-only --ignore-scripts
git diff --check
```

Expected: Node major version is at least 22, second lock generation is byte-identical, and whitespace check passes.

- [ ] **Step 7: Commit bootstrap**

```bash
git add package.json package-lock.json .gitignore LICENSE README.md docs src scripts tests
git commit -m "chore: bootstrap skill scaffold"
```

---

### Task 2: Implement CLI Argument Parsing

**Files:**
- Create: `src/cli.js`
- Create: `scripts/init-skill.js`
- Create: `tests/cli.test.js`

**Interfaces:**
- Produces: `parseInitArgs(argv) -> { name, description, license, dryRun, help }`
- Produces: `formatInitHelp() -> string`
- Consumes later: Task 7 initializer orchestration

- [ ] **Step 1: Write failing parser tests**

Cover:

```js
test('parses required arguments and defaults', () => {
  assert.deepEqual(parseInitArgs([
    '--name', 'example-skill',
    '--description', 'Create consistent example outputs',
  ]), {
    name: 'example-skill',
    description: 'Create consistent example outputs',
    license: 'Apache-2.0',
    dryRun: false,
    help: false,
  });
});
```

Also test `--dry-run`, all three license values, `--help`, unknown options, positional arguments, duplicate scalar options, missing values, empty values, uppercase/underscore/adjacent-hyphen names, multiline descriptions, descriptions over 500 Unicode characters, and descriptions containing Markdown/YAML/JSON syntax characters.

- [ ] **Step 2: Run the focused test and confirm failure**

```bash
node --test tests/cli.test.js
```

Expected: module or exported function is missing.

- [ ] **Step 3: Implement strict parsing**

Use a single forward pass over `argv`. Reject unknown or duplicate inputs immediately. Validate names with:

```js
/^[a-z0-9]+(?:-[a-z0-9]+)*$/u
```

Measure description length with `[...value].length`, not UTF-16 code units. Normalize no user data except trimming option values; reject descriptions changed by trimming at either edge so stored input remains explicit.

- [ ] **Step 4: Implement the script wrapper**

`scripts/init-skill.js` calls the parser and prints help without importing the initializer. For non-help input, use a dynamic import of `initializeSkill` from `src/initialize.js`; Task 6 supplies that module and Task 7 completes result formatting and end-to-end behavior. Convert expected input errors to concise stderr plus exit code 2; unexpected errors retain stack output and exit code 1.

- [ ] **Step 5: Run tests**

```bash
node --test tests/cli.test.js
```

Expected: all parser and help tests pass.

- [ ] **Step 6: Commit CLI parsing**

```bash
git add src/cli.js scripts/init-skill.js tests/cli.test.js
git commit -m "feat: parse scaffold initialization options"
```

---

### Task 3: Define and Render the Closed Template Set

**Files:**
- Create: `src/templates.js`
- Create: `templates/project/SKILL.md.template`
- Create: `templates/project/README.md.template`
- Create: `templates/project/skill-brief.md.template`
- Create: `templates/project/decisions.md.template`
- Create: `templates/project/delivery-report.md.template`
- Create: `templates/project/evals.json.template`
- Create: `templates/licenses/Apache-2.0.txt`
- Create: `templates/licenses/MIT.txt`
- Create: `tests/templates.test.js`

**Interfaces:**
- Produces: `TEMPLATE_DEFINITIONS`
- Produces: `renderProjectTemplates(values, context) -> Array<{ target, content: Buffer | null }>`
- Consumes later: Task 7 initializer

- [ ] **Step 1: Write failing template inventory tests**

Assert the target set is exactly:

```js
[
  'SKILL.md',
  'README.md',
  'LICENSE',
  'docs/skill-brief.md',
  'docs/decisions.md',
  'docs/delivery-report.md',
  'evals/evals.json',
]
```

Test unknown token, missing token value, unresolved token, duplicate target, absolute target, `..` segment, and rendering for Apache-2.0, MIT, and UNLICENSED.

- [ ] **Step 2: Run tests and confirm failure**

```bash
node --test tests/templates.test.js
```

- [ ] **Step 3: Write the templates**

Use only `{{SKILL_NAME}}`, `{{SKILL_DESCRIPTION}}`, `{{INITIALIZED_DATE}}`, and `{{LICENSE_ID}}`.

The Skill template must have valid frontmatter, describe the concrete target, and include compact draft sections for preparation, execution, boundaries, and output. It must not contain invalid placeholder markers or claim completed evaluation.

The Brief, decisions, delivery, and evaluation templates implement Evidence Contract v1 exactly. Brief status is `draft`, every optional track is `disabled` with an explicit initialization reason, conflicts are empty, and prompt measurements are null. The evaluation template contains the concrete Skill name and an empty `evals` array.

- [ ] **Step 4: Implement deterministic rendering**

Declare templates in a frozen array. Read source templates as UTF-8, reject BOM, NUL, malformed UTF-8, and unknown tokens in template source. Tokenize each source once and replace only those source spans so token-like user input is never interpreted a second time. Normalize generated output to LF and one final newline.

Encode values for their destination context: JSON outputs are built through `JSON.stringify` from structured data; YAML frontmatter uses JSON-quoted scalars, which are valid YAML 1.2; Markdown text escapes control characters and syntax that could create headings, links, tables, fences, or HTML. Test `:`, `#`, quotes, backslashes, braces, pipes, backticks, angle brackets, Unicode, and token-like input while asserting that every generated format remains parseable and preserves the intended plain text.

For UNLICENSED, return `{ target: 'LICENSE', content: null }`; for MIT, use neutral `Skill contributors` attribution and the initialization year.

- [ ] **Step 5: Run template tests**

```bash
node --test tests/templates.test.js
```

- [ ] **Step 6: Commit templates**

```bash
git add src/templates.js templates tests/templates.test.js
git commit -m "feat: add deterministic skill templates"
```

---

### Task 4: Implement Versioned State and Digests

**Files:**
- Create: `src/state.js`
- Create: `tests/state.test.js`

**Interfaces:**
- Produces: `readScaffoldState(root) -> Promise<State | null>`
- Produces: `serializeScaffoldState(state) -> Buffer`
- Produces: `buildInitialState(options, initializedAt, outputs) -> State`
- Produces: `assertScaffoldState(value) -> void`

- [ ] **Step 1: Write failing state tests**

Test missing state, valid schema 1, unsupported schema, invalid status, invalid Skill fields, invalid date, relative/non-normalized digest keys, missing/invalid SHA-256, duplicate logical paths, stable key order, LF, and no BOM.

- [ ] **Step 2: Run the focused test**

```bash
node --test tests/state.test.js
```

- [ ] **Step 3: Implement strict state validation**

Use this exact schema: top-level keys `schema_version`, `scaffold_version`, `status`, `skill`, `initialized_at`, and `initial_files`; `status` is `draft` or `ready`; `skill` has exactly `name`, `description`, and `license`. Validate Skill fields with the same helpers as CLI. `initial_files` contains every non-null initialized output plus `package.json` and `package-lock.json`; `.scaffold/state.json` is deliberately absent because state cannot contain its own digest.

- [ ] **Step 4: Build stable state**

Hash rendered bytes with SHA-256. Sort digest keys using ordinal comparison and serialize JSON with two-space indentation plus LF. Use a UTC `YYYY-MM-DD` date supplied by context so tests remain deterministic.

- [ ] **Step 5: Run tests**

```bash
node --test tests/state.test.js
```

- [ ] **Step 6: Commit state support**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat: record scaffold initialization state"
```

---

### Task 5: Implement Transactional File Writes

**Files:**
- Create: `src/transaction.js`
- Create: `tests/transaction.test.js`

**Interfaces:**
- Produces: `withRepositoryLock(root, operation) -> Promise<Result>`
- Produces: `executeTransaction(entries, { root, faults }) -> Promise<{ warnings: string[] }>`
- Entry shape: `{ target: repositoryRelativePath, content: Buffer | null, expected: { kind: 'absent' | 'sha256', digest?: string } }`
- Consumes later: Task 7 initialization plan

- [ ] **Step 1: Write failure-injection tests**

Cover successful create/replace/delete, duplicate targets, absolute/traversal/outside-root targets, directory target, symlink file target, symlink or Windows junction parent, file ancestor, stage failure, commit failure at each index, rollback failure, cleanup failure, POSIX mode preservation, removal of newly created empty directories, retention of recovery backup when rollback fails, repository-lock contention, and a target changed after planning.

- [ ] **Step 2: Confirm tests fail**

```bash
node --test tests/transaction.test.js
```

- [ ] **Step 3: Implement preflight**

Canonicalize `root`, resolve every repository-relative target beneath it, and reject absolute paths, traversal, case-insensitive duplicates on Windows, non-file targets, linked targets, and symlink/junction ancestors. Re-check the nearest existing ancestor after creating each missing directory. Require `Buffer` or `null` content and a valid expected-ownership contract.

- [ ] **Step 4: Implement stage, commit, rollback, and cleanup**

Use random transaction IDs. For real initialization, acquire an exclusive `.scaffold-init.lock` with `fs.open(..., 'wx')` before ownership planning and remove it in `finally`; never auto-delete an existing lock. Stage beside each target with exclusive creation. Install every created or replacement file with `fs.link(stage, target)`, which fails instead of overwriting an existing target, then unlink the stage name.

For replacement or deletion, create the backup first with exclusive `fs.link(target, backup)`, verify original and backup share the same stable file identity from BigInt `lstat`, hash the bytes, and re-check identity/size/mtime before unlinking the original name. Verify the backup digest again after detachment, then install replacement content through the same no-clobber hard-link operation. Keep all backups through commit and post-commit digest checks; if a backup or installed target changed, rollback or preserve the backup and fail. Register touched targets before mutation, rollback in reverse order, and preserve original POSIX mode. State is ordered last by the caller. Filesystems that cannot provide same-volume hard links fail safely before mutation and are documented as unsupported for initialization.

Cleanup failures after a successful commit become warnings. Rollback failures are combined with the original error and preserve remaining backups.

- [ ] **Step 5: Run transaction tests**

```bash
node --test tests/transaction.test.js
```

- [ ] **Step 6: Commit transaction support**

```bash
git add src/transaction.js tests/transaction.test.js
git commit -m "feat: add atomic scaffold transactions"
```

---

### Task 6: Build Initialization Planning and Collision Safety

**Files:**
- Create: `src/initialize.js`
- Create: `tests/initialize.test.js`
- Create: `tests/helpers/repository-fixture.js`

**Interfaces:**
- Produces: `planInitialization(options, context) -> Promise<InitializationPlan>`
- Produces: `initializeSkill(options, context) -> Promise<InitializationResult>`
- `InitializationPlan`: `{ mode, operations, state, warnings }`
- `InitializationResult`: `{ status: 'initialized' | 'already-initialized' | 'dry-run', files, warnings }`

- [ ] **Step 1: Create isolated repository fixtures**

Fixture copies package metadata, source README, Apache license, templates, and docs into a temporary repository root. It accepts fake dates and transaction faults and never reads the real checkout as a target.

- [ ] **Step 2: Write failing preflight tests**

Cover uninitialized success, existing root `SKILL.md`, occupied `docs/skill-brief.md`, state without outputs, outputs without state, source README without scaffold marker, changed Apache license during license replacement, package without `scaffold.mode=source`, symlink target, dry run, same-state idempotency, and different arguments.

- [ ] **Step 3: Define source ownership checks**

Source README begins with a unique `skill-development-scaffold` marker. Source `package.json` must contain matching scaffold mode/version. Apache license replacement/removal requires exact match with `templates/licenses/Apache-2.0.txt`. New target files must be absent.

- [ ] **Step 4: Build package outputs structurally**

Parse `package.json` and `package-lock.json` as JSON. In initialized mode update name, description, license, root lock metadata, `scaffold.mode` to `initialized`, and package `files` to the initial publish whitelist `['SKILL.md']`. Preserve scripts, engine, private flag, version, and unrelated fields.

- [ ] **Step 5: Build the complete operation plan**

Render templates, package metadata, lock metadata, and state in memory. Reject any conflict before transaction execution. Attach `absent` ownership to new files and the just-read SHA-256 to every replacement or deletion. Sort operations with state last. Dry run returns repository-relative paths and operation kinds without acquiring a lock or calling the transaction.

- [ ] **Step 6: Execute and test initialization**

For real writes, acquire the repository lock, rebuild the full plan under that lock, then call `executeTransaction`. After commit, return warnings and stable relative file order. Re-read state for idempotency; do not compare later file digests or overwrite Agent edits. Document that the lock coordinates scaffold processes and digest detachment prevents overwriting pre-existing concurrent edits; an external process that ignores the lock may still cause a clean failure.

Run:

```bash
node --test tests/initialize.test.js tests/transaction.test.js
```

- [ ] **Step 7: Commit initialization logic**

```bash
git add src/initialize.js tests/initialize.test.js tests/helpers/repository-fixture.js
git commit -m "feat: initialize skills safely in place"
```

---

### Task 7: Complete the Initialization CLI and End-to-End Tests

**Files:**
- Modify: `scripts/init-skill.js`
- Modify: `src/cli.js`
- Create: `tests/init-cli.test.js`

**Interfaces:**
- Consumes: Tasks 2-6 public interfaces
- Produces: `runInitCli(argv, context) -> Promise<{ exitCode, stdout, stderr }>`
- Produces: stable user-facing initialization command and exit behavior

- [ ] **Step 1: Write failing end-to-end CLI tests**

Spawn Node with the script and a temporary repository. Verify help, successful output, dry-run JSON or concise text, idempotent output, input error exit 2, collision exit 1, warning when `origin` still targets `xuanjinchen/skill-development-scaffold`, and no remote mutation.

- [ ] **Step 2: Implement repository-root discovery**

Export `runInitCli(argv, context)` for tests; its context accepts an explicit root and injected streams while the executable wrapper supplies the root resolved from its own script location. Verify package scaffold metadata before planning; do not expose a production environment variable that redirects writes to an arbitrary repository.

- [ ] **Step 3: Implement stable output**

Success reports status, Skill name, license, created/updated/removed files, warnings, and next commands:

```text
npm run check
Read docs/skill-brief.md and docs/mature-skill-development-plan.md
```

Dry run labels every operation and explicitly reports that no files were changed. Never print complete rendered content.

- [ ] **Step 4: Run CLI tests**

```bash
node --test tests/cli.test.js tests/init-cli.test.js
```

- [ ] **Step 5: Manually inspect a temporary initialization**

Run the public npm command in a copied fixture for Apache-2.0, MIT, and UNLICENSED. Confirm Git remote output before and after is byte-identical.

- [ ] **Step 6: Commit the executable initializer**

```bash
git add scripts/init-skill.js src/cli.js tests/init-cli.test.js
git commit -m "feat: expose executable skill initializer"
```

---

### Task 8: Implement Source and Draft Repository Validation

**Files:**
- Create: `src/validate.js`
- Create: `scripts/validate.js`
- Create: `tests/validate.test.js`

**Interfaces:**
- Produces: `validateRepository(root, context) -> Promise<ValidationReport>`
- `ValidationReport`: `{ mode: 'source' | 'initialized', errors: Issue[], warnings: Issue[] }`
- Issue: `{ code, path, message }`

- [ ] **Step 1: Write failing validation tests**

Source mode checks templates, docs, scripts, package metadata, lock consistency, license, and absence of state/root Skill. Initialized mode checks state, package/lock name and license, root Skill frontmatter, README name, Brief sections, decision table, delivery report, eval JSON, token removal, and path safety.

Each test asserts named issue codes rather than complete prose.

- [ ] **Step 2: Implement text and frontmatter validation**

Use fatal UTF-8 decoding, reject BOM/NUL/CRLF for generated files, and parse the simple frontmatter shape without a third-party YAML dependency. Require exactly one `name` and one one-line `description`.

- [ ] **Step 3: Implement source mode**

Require `package.scaffold.mode === 'source'`, no `.scaffold/state.json`, no root `SKILL.md`, all declared templates/docs present, and package-lock metadata consistent.

- [ ] **Step 4: Implement initialized mode**

Require valid state, root Skill name/description consistency, actual selected license behavior, all core files, valid JSON, no unresolved template tokens, and package `files` that excludes templates, state, tests, development docs, and evaluation workspaces.

State digest drift is informational because Agent edits are expected; missing initialized files are errors.

- [ ] **Step 5: Implement the validation script**

Print one issue per line as `ERROR code path message` or `WARN ...`; exit 1 on errors and 0 otherwise. Do not mutate files.

- [ ] **Step 6: Run validation tests**

```bash
node --test tests/validate.test.js
node scripts/validate.js
```

Expected: tests pass and the real scaffold checkout reports source mode valid.

- [ ] **Step 7: Commit validation**

```bash
git add src/validate.js scripts/validate.js tests/validate.test.js
git commit -m "feat: validate scaffold and initialized skills"
```

---

### Task 9: Implement the Deterministic Delivery Gate

**Files:**
- Create: `src/delivery-gate.js`
- Create: `scripts/delivery-gate.js`
- Create: `tests/delivery-gate.test.js`
- Create: `tests/fixtures/complete-skill/`

**Interfaces:**
- Produces: `evaluateDelivery(root, context) -> Promise<DeliveryReport>`
- `DeliveryReport`: `{ errors: Issue[], warnings: Issue[], evidence: Evidence[] }`
- Evidence: `{ requirement, source, status }`

- [ ] **Step 1: Write failing gate tests**

Test source-mode rejection, draft status, missing acceptance evidence, unresolved conflict, fewer than three evals, missing positive/negative/boundary categories, empty assertions where required, absent prompt budget, optional track without evidence, missing delivery trace, forbidden package path, claimed live support without recorded evidence, and a complete fixture that passes.

- [ ] **Step 2: Define deterministic evidence locations**

Each Markdown evidence file contains exactly one marker followed immediately by a fenced JSON object. Parse only Evidence Contract v1; prose outside it is for humans:

- `<!-- scaffold-contract:skill-brief:v1 -->` in `docs/skill-brief.md`.
- `<!-- scaffold-contract:decisions:v1 -->` in `docs/decisions.md`.
- The whole `evals/evals.json` file for evaluation evidence.
- `<!-- scaffold-contract:delivery-report:v1 -->` in `docs/delivery-report.md`.

Reject duplicate IDs, dangling references, invalid status/evidence combinations, and incomplete delivery relationships. Draft templates contain valid minimal contracts. The gate never searches arbitrary prose for model success claims.

- [ ] **Step 3: Implement gate checks**

Call initialized-mode validation first. Require state and Brief status `ready`, at least three unique evaluation cases satisfying the contract's deterministic prompt checks, category coverage, non-empty assertions, passing result evidence, explicit verification per acceptance criterion, and status/evidence for every optional track. Every `REQ-*` must have one passing delivery trace. Any blocked acceptance criterion is an error; a blocked optional track is allowed only when its unblock condition is recorded and capability claims exclude that track.

- [ ] **Step 4: Implement the script**

Use the same issue output protocol as validation. Exit 1 for unmet delivery requirements. Never write state, invoke models, inspect Agent login, or access network.

- [ ] **Step 5: Run tests**

```bash
node --test tests/delivery-gate.test.js
```

- [ ] **Step 6: Commit the gate**

```bash
git add src/delivery-gate.js scripts/delivery-gate.js tests/delivery-gate.test.js tests/fixtures/complete-skill
git commit -m "feat: enforce mature skill delivery evidence"
```

---

### Task 10: Add Agent Instructions and User Documentation

**Files:**
- Create: `AGENTS.md`
- Modify: `README.md`
- Create: `docs/scaffold-usage.md`
- Modify: `docs/mature-skill-development-design.md`
- Modify: `docs/mature-skill-development-plan.md`
- Modify: template README and Brief as needed
- Create: `tests/documentation.test.js`

**Interfaces:**
- Consumes: approved generic design/plan and public commands
- Produces: autonomous Agent entrypoint and user-first clone/init workflow

- [ ] **Step 1: Review and finalize generic documents**

Review the baseline generic design and plan created in Task 1 against the implemented commands and repository structure. Remove any remaining source-repository-specific links, local absolute paths, release versions, and `chinese-code-comments` business behavior. Preserve layered tracks, change protocol, evaluation workflow, security, and final acceptance.

- [ ] **Step 2: Write root Agent instructions**

Keep root instructions compact. They must require state inspection, initialization before Skill edits, reading the design/plan/Brief, latest-user-requirement priority, evidence-gated optional tracks, deterministic tests, paired behavior evaluation, Brief/decision updates, `check`, `gate:delivery`, complete diff review, and authorization for paid/destructive/publishing actions.

- [ ] **Step 3: Write the source README**

Use this user order:

1. What the scaffold does.
2. GitHub Template workflow.
3. Direct clone workflow and origin warning.
4. Node.js 22 prerequisite.
5. Initialization and dry-run examples.
6. Generated files.
7. Development and delivery commands.
8. Safety, limitations, structure, contribution, security, and license.

- [ ] **Step 4: Write scaffold usage details**

Document CLI contract, state schema, source vs initialized modes, transaction recovery, license switching, package whitelist, upgrading scaffold tooling, and the fact that there is no reset/uninstall command.

- [ ] **Step 5: Add documentation tests**

Assert README commands exist in package scripts, all internal links resolve, AGENTS points to real docs, source README retains its unique source marker, templates reference actual commands, and no file contains private local paths or source-project business rules.

- [ ] **Step 6: Run tests**

```bash
node --test tests/documentation.test.js
npm run check
```

- [ ] **Step 7: Commit documentation**

```bash
git add AGENTS.md README.md docs templates tests/documentation.test.js
git commit -m "docs: guide autonomous skill development"
```

---

### Task 11: Add Open-Source Governance and Cross-Platform CI

**Files:**
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/audit.js`
- Create: `scripts/audit.js`
- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/pull_request_template.md`
- Create: `tests/audit.test.js`
- Create: `tests/repository.test.js`

**Interfaces:**
- Produces: public-repository governance and immutable CI supply chain

- [ ] **Step 1: Write failing repository contract tests**

Assert CI runs `npm ci --ignore-scripts` and `npm run check` on `windows-latest`, `macos-latest`, and `ubuntu-latest` with Node 22. Assert every external Action uses a full 40-character commit SHA. Assert Dependabot covers npm and GitHub Actions.

- [ ] **Step 2: Add CI**

Use checkout and setup-node pinned to reviewed full SHAs with version comments. Grant read-only contents permission, use one matrix job, disable fail-fast, and set npm cache using `package-lock.json`.

- [ ] **Step 3: Add governance**

SECURITY uses GitHub Private Vulnerability Reporting without personal email. CONTRIBUTING states scope, Node 22, Conventional Commits, checks, no model costs in default CI, and sensitive information rules. Issue/PR forms ask for reproduction, platform, validation, compatibility claims, and secret review.

- [ ] **Step 4: Add deterministic public audit**

Register `"audit": "node scripts/audit.js"` in package metadata and regenerate the lockfile. Implement it with Node.js standard modules. Scan tracked worktree files, reachable commit blobs, refs, author/committer emails, and `npm pack --json --dry-run` entries for credential patterns, private absolute paths, forbidden sensitive filenames, traversal paths, and dangerous links. Redact matched values, report stable issue codes and locations, and exit 1 on confirmed or unallowlisted findings. Tests use synthetic repositories and fake secrets; no scanner output may echo secret values.

- [ ] **Step 5: Run repository tests**

```bash
node --test tests/audit.test.js tests/repository.test.js
npm run check
npm run audit
npm pack --dry-run
```

Inspect the package list: it must contain scaffold runtime/templates/docs but exclude tests, `.scaffold`, evaluation workspaces, logs, and local state.

- [ ] **Step 6: Commit governance**

```bash
git add SECURITY.md CONTRIBUTING.md src/audit.js scripts/audit.js .github tests/audit.test.js tests/repository.test.js package.json package-lock.json
git commit -m "chore: prepare public scaffold repository"
```

---

### Task 12: Run Full End-to-End and Safety Verification

**Files:**
- Create: `tests/end-to-end.test.js`
- Modify: implementation and tests for discovered defects
- Create outside repository: temporary cloned fixtures and audit outputs

**Interfaces:**
- Consumes: all scaffold commands and docs
- Produces: reproducible evidence for source mode, three licenses, draft mode, and delivery gate

- [ ] **Step 1: Write a temporary-clone end-to-end test**

Copy the declared source-repository file set to a temporary directory, run `git init`, create a neutral local commit, and add a harmless HTTPS test origin. Run `npm ci --ignore-scripts`, capture bytes before dry run, run dry run, verify byte identity, initialize, run `npm run check`, rerun identical initialization, and compare `.git/config` bytes before/after. Never depend on the source checkout's `.git` directory or hard links.

- [ ] **Step 2: Test every license mode**

Use separate temporary clones. Apache keeps known text, MIT contains the current year and neutral attribution, and UNLICENSED removes only the known scaffold license. Every mode keeps package and lock metadata consistent.

- [ ] **Step 3: Test recovery and collisions end to end**

Inject a commit failure, verify original README/package/license restoration, no state publication, and no temporary files. Add unmanaged Skill/Brief/license changes and verify initialization refuses without writes.

- [ ] **Step 4: Test draft and delivery modes**

After initialization, `npm run check` passes and `npm run gate:delivery` fails with named draft/evidence errors. Run the gate against the complete fixture and confirm success.

- [ ] **Step 5: Run all deterministic gates**

```bash
npm ci --ignore-scripts
npm run check
npm pack --dry-run
git diff --check
```

- [ ] **Step 6: Audit comments, secrets, and package content**

Review the complete diff and untracked delivery files with `$chinese-code-comments`. Run `npm run audit`, inspect only redacted findings, and resolve every unallowlisted result. Verify npm/custom archive entries have no absolute/traversal paths or dangerous links and extracted content matches the whitelist; GitHub-generated source archives are full-source snapshots and are not subject to the npm/custom-asset whitelist.

- [ ] **Step 7: Request independent review**

Review against the design in two passes: specification compliance first, code quality/security second. Fix every P1/P2 finding and rerun affected tests plus the full gate.

- [ ] **Step 8: Commit final verification**

```bash
git add tests/end-to-end.test.js src scripts templates docs README.md AGENTS.md
git diff --cached --check
git commit -m "test: verify scaffold lifecycle end to end"
```

Only add files actually changed by defect fixes; do not create an empty commit.

---

### Task 13: Create the GitHub Template Repository

**Files:**
- Modify: local Git configuration only as required
- Create remotely: `xuanjinchen/skill-development-scaffold`

**Interfaces:**
- Consumes: clean local `main`, GitHub credential from Git credential manager
- Produces: public remote repository marked as a template

- [ ] **Step 1: Verify pre-push state**

Require clean worktree, `main`, expected commit identity, no remotes, passing `npm run check`, passing package dry run, and zero confirmed secret findings.

- [ ] **Step 2: Create the public repository through GitHub API**

Use a temporary Node.js HTTPS maintenance script outside the repository and delete it in that invocation's `finally`. Read the credential from `git credential fill` in-process without printing it, call `POST /user/repos`, and require HTTP 201. Create `xuanjinchen/skill-development-scaffold` with public visibility, issues enabled, no auto-generated README/license/gitignore, and description matching package metadata. On HTTP 422, call `GET /repos/xuanjinchen/skill-development-scaffold` and continue only when ownership and existing repository state exactly match the intended target; otherwise stop without modifying it.

- [ ] **Step 3: Add and verify origin**

```bash
git remote add origin https://github.com/xuanjinchen/skill-development-scaffold.git
git remote -v
git push -u origin main
```

Confirm the unauthenticated repository endpoint returns public metadata and the pushed SHA matches local `main`.

- [ ] **Step 4: Mark the repository as a template**

Call `PATCH /repos/xuanjinchen/skill-development-scaffold` and require HTTP 200 with `is_template: true`. Re-read public metadata and verify template status, visibility, default branch, license detection, and description.

- [ ] **Step 5: Configure available protections**

Create a fresh temporary Node maintenance script, use documented REST endpoints to enable Private Vulnerability Reporting, secret scanning/push protection, and CodeQL when available, and delete it in `finally`. Treat HTTP 2xx as success, 403/404 with a documented plan/availability response as unavailable, and every other response as failure. Add a `main` ruleset requiring PRs and CI only after confirming the release flow uses a branch and PR. Record unavailable features rather than claiming success.

- [ ] **Step 6: Verify CI on all platforms**

Wait for the pushed workflow and confirm Windows, macOS, and Ubuntu jobs succeed. Fix failures through normal commits; do not bypass required checks.

---

### Task 14: Publish and Verify v0.1.0

**Files:**
- Create: `CHANGELOG.md`
- Create: `.github/workflows/release.yml` only if deterministic custom assets are included
- Modify: `README.md` version examples if needed

**Interfaces:**
- Consumes: public template repository and passing CI
- Produces: immutable `v0.1.0` Tag and GitHub Release

- [ ] **Step 1: Decide the minimum Release assets**

Prefer GitHub-generated source archives only. Add a deterministic scaffold archive and `.sha256` only if offline use is materially improved; never publish to npm Registry.

- [ ] **Step 2: Add release notes and version evidence**

Create CHANGELOG entry for initializer, templates, source/draft validation, delivery gate, safety, platform support, and known limitations. Ensure package/scaffold/state version constants all equal `0.1.0`.

- [ ] **Step 3: Commit release preparation on a branch**

Create `codex/release-v0.1.0`, commit the prepared files, push the branch, and open a pull request. Only include `.github/workflows/release.yml` if Task 14 Step 1 enabled custom assets.

```bash
git switch -c codex/release-v0.1.0
git add CHANGELOG.md README.md .github package.json package-lock.json
git commit -m "chore: prepare v0.1.0"
git push -u origin codex/release-v0.1.0
```

- [ ] **Step 4: Merge through protected main**

Require the pull request checks and review policy, merge it without bypassing branch protection, update local `main`, and record the resulting merge SHA.

- [ ] **Step 5: Verify the exact Tag candidate**

```bash
git switch main
git pull --ff-only origin main
npm ci --ignore-scripts
npm run check
npm run audit
npm pack --dry-run
git diff --check
```

Wait for Windows, macOS, and Ubuntu CI on this exact SHA. Scan the same commit and any custom archive contents; abort if HEAD changes before tagging.

- [ ] **Step 6: Create the immutable Tag and Release**

Create annotated Tag `v0.1.0` at the verified commit, push it, and create the GitHub Release with concise user-facing notes. Never move the Tag or replace a different-digest asset under this version.

- [ ] **Step 7: Verify public use from a fresh location**

Clone by Tag and verify source mode. Create a repository from the GitHub Template API or UI-equivalent endpoint, initialize `example-skill`, run `npm run check`, and confirm origin belongs to the new project rather than the scaffold.

- [ ] **Step 8: Record final repository state**

Report public URL, Release URL, Tag SHA, CI results, template status, security feature status, deterministic commands, package contents, and remaining limitations.

---

## Final Verification Checklist

- [ ] Local and remote repository names are exactly `skill-development-scaffold`.
- [ ] Repository is public and `is_template` is true.
- [ ] Source mode has no root `SKILL.md` or initialized state.
- [ ] Initializer accepts only the documented arguments and writes only declared targets.
- [ ] Dry run performs no writes and reports the real operation set.
- [ ] Initialization is transactional, idempotent for matching arguments, and conservative for conflicts.
- [ ] Apache-2.0, MIT, and UNLICENSED behavior is tested.
- [ ] Package and lock metadata remain consistent after initialization.
- [ ] `npm run check` passes in source mode and initialized draft mode.
- [ ] `npm run gate:delivery` rejects drafts and passes the complete fixture without calling a model.
- [ ] Root AGENTS lets an unfamiliar Agent initialize and start the mature Skill plan from one objective.
- [ ] Generic design and plan contain no source-project business rules or private local paths.
- [ ] CI passes on Node 22 for Windows, macOS, and Ubuntu.
- [ ] Actions are pinned to full SHAs and permissions are minimal.
- [ ] Worktree, history, Tag, Release text, and assets have zero confirmed secret findings.
- [ ] Published npm package or custom Release asset excludes tests, state, evaluation workspaces, logs, and credentials; GitHub-generated source archives intentionally contain the full tracked source.
- [ ] `v0.1.0` is immutable and publicly installable/cloneable.
