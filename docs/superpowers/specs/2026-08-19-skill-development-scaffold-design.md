# Skill Development Scaffold Design

## Status

- Date: 2026-08-19
- Status: Approved
- Source repository: `chinese-code-comments`
- Target repository: `xuanjinchen/skill-development-scaffold`
- Local target: sibling directory `skill-development-scaffold`
- Visibility: Public GitHub Template Repository

## Goal

Build an executable, domain-neutral Node.js scaffold that lets a user clone a repository, provide one concrete Skill objective, and let an Agent immediately initialize and implement a new mature Skill without recreating repository structure, requirement records, tests, evaluation data, quality gates, security checks, or release preparation from zero.

The scaffold packages the approved mature Skill development design and plan together with deterministic initialization and validation tooling. It must support a small prompt-only Skill without forcing installer or multi-Agent complexity, while leaving explicit extension points for evidence-driven engineering tracks.

## Non-Goals

- Do not create a globally installed generator CLI or package registry service.
- Do not create child repositories outside the cloned working directory.
- Do not implement domain behavior for any specific Skill.
- Do not automatically modify Git remotes, erase Git history, push, publish, or create Releases.
- Do not make installers, global activation rules, multiple Agent adapters, or public releases mandatory for generated Skills.
- Do not call external models from deterministic checks or default CI.
- Do not promise official compatibility for an Agent that has not been exercised with its real CLI.

## User Journey

1. The user clones or creates a repository from `xuanjinchen/skill-development-scaffold`.
2. The Agent reads root `AGENTS.md` and the scaffold state.
3. If uninitialized, the Agent derives a valid Skill name and concise description from the user's objective.
4. The Agent runs `npm run init:skill -- --name ... --description ...`.
5. The initializer creates the Skill draft, requirement records, evaluation catalog, user README, and state without modifying Git remotes or history.
6. The Agent reads the bundled mature Skill design and implementation plan, updates the concrete Skill Brief, and executes the core track.
7. Optional tracks remain disabled unless the Skill Brief records evidence for enabling them.
8. Deterministic `check` stays available throughout development; `gate:delivery` is used when the Skill is ready for delivery.

GitHub's “Use this template” flow is the preferred way to create a clean project history. A direct clone remains supported, but the initializer warns when `origin` still points to the scaffold repository and never changes it automatically.

## Repository Architecture

```text
skill-development-scaffold/
├── AGENTS.md
├── README.md
├── LICENSE
├── SECURITY.md
├── CONTRIBUTING.md
├── package.json
├── package-lock.json
├── src/
│   ├── cli.js
│   ├── initialize.js
│   ├── templates.js
│   ├── state.js
│   ├── transaction.js
│   ├── validate.js
│   └── delivery-gate.js
├── scripts/
│   ├── init-skill.js
│   ├── validate.js
│   └── delivery-gate.js
├── templates/
│   ├── project/
│   │   ├── SKILL.md.template
│   │   ├── README.md.template
│   │   ├── skill-brief.md.template
│   │   ├── decisions.md.template
│   │   ├── delivery-report.md.template
│   │   └── evals.json.template
│   └── licenses/
│       ├── Apache-2.0.txt
│       └── MIT.txt
├── docs/
│   ├── mature-skill-development-design.md
│   ├── mature-skill-development-plan.md
│   └── scaffold-usage.md
├── tests/
│   ├── cli.test.js
│   ├── initialize.test.js
│   ├── templates.test.js
│   ├── validate.test.js
│   ├── delivery-gate.test.js
│   └── helpers/
├── .github/
│   ├── workflows/ci.yml
│   └── dependabot.yml
└── .gitignore
```

The source repository has no root `SKILL.md`; the project is a scaffold, not an installable domain Skill. Initialization materializes `SKILL.md` and the concrete development files in the current repository.

## Runtime and Dependencies

- Require Node.js 22 or newer.
- Use ES modules and `node:test`.
- Use only Node.js standard library modules at runtime and in tests.
- Commit `package-lock.json` for reproducible scaffold development.
- Keep the scaffold package private; the repository is distributed through GitHub rather than npm Registry.
- Use UTF-8 without BOM and LF for newly generated files.

## CLI Contract

The public initialization command is:

```bash
npm run init:skill -- --name skill-name --description "Concrete Skill objective"
```

Supported options:

| Option | Required | Behavior |
| --- | --- | --- |
| `--name` | yes | Lowercase kebab-case Skill identifier |
| `--description` | yes | One-line Skill trigger and capability draft |
| `--license` | no | `Apache-2.0`, `MIT`, or `UNLICENSED`; default `Apache-2.0` |
| `--dry-run` | no | Print the planned file operations without writing |
| `--help` | no | Print usage and exit successfully |

Unknown options, duplicate scalar options, missing values, positional arguments, empty values, invalid names, unsupported licenses, multiline descriptions, and descriptions longer than 500 Unicode characters fail before any write.

The accepted name pattern is lowercase ASCII alphanumeric segments separated by single hyphens. The name cannot begin or end with a hyphen and cannot contain consecutive hyphens.

## Initialization Outputs

Initialization creates or updates only these managed targets:

- `SKILL.md`
- `README.md`
- `LICENSE`, according to the selected license
- `docs/skill-brief.md`
- `docs/decisions.md`
- `docs/delivery-report.md`
- `evals/evals.json`
- `.scaffold/state.json`
- `package.json` metadata fields that are explicitly owned by initialization

The root README changes from scaffold usage documentation to user documentation for the target Skill. Complete scaffold operating instructions remain available at `docs/scaffold-usage.md`.

`Apache-2.0` keeps the scaffold's Apache license, `MIT` replaces it with the bundled MIT text and neutral contributor attribution, and `UNLICENSED` removes the scaffold-owned `LICENSE` while setting package metadata to `UNLICENSED`. Initialization never deletes a license file whose current content is not the known scaffold version.

Initialization does not create optional `references/`, `assets/`, Agent adapters, global policy templates, installer modules, or release workflows. The development Agent creates those only when the concrete Skill Brief enables the corresponding track.

## Template Contract

Templates use a closed token set:

- `{{SKILL_NAME}}`
- `{{SKILL_DESCRIPTION}}`
- `{{INITIALIZED_DATE}}`
- `{{LICENSE_ID}}`

The template renderer rejects unknown tokens, missing values, duplicate output targets, path traversal, absolute output paths, and any unresolved token after rendering. Template paths are declared in code instead of discovered recursively, which keeps the managed write set auditable.

Generated `SKILL.md` contains valid frontmatter and a concise draft workflow derived from the concrete name and description. It is syntactically valid but explicitly marked as a development draft through scaffold state rather than through invalid placeholders in Skill content.

Generated Skill Brief contains every required section, concrete initialization facts, all optional tracks set to `disabled`, and a `draft` lifecycle state. Empty requirements are represented as explicit neutral values rather than unresolved placeholder markers.

Generated `evals/evals.json` is valid and names the concrete Skill but starts with an empty evaluation list. The development plan requires the Agent to add realistic prompts before behavior evaluation. `check` accepts an empty draft catalog; `gate:delivery` requires the completed evaluation contract.

## State Model

`.scaffold/state.json` uses a versioned schema and contains:

```json
{
  "schema_version": 1,
  "scaffold_version": "0.1.0",
  "status": "draft",
  "skill": {
    "name": "example-skill",
    "description": "Example concrete objective",
    "license": "Apache-2.0"
  },
  "initialized_at": "2026-08-19",
  "initial_files": {}
}
```

`initial_files` maps every initialized managed path to its SHA-256 digest immediately after initialization. Digests provide provenance and diagnostics; they do not authorize overwriting later Agent edits.

If the state exists and the requested name, description, and license match, repeated initialization succeeds as an idempotent no-op and reports `already initialized`. If any requested value differs, initialization fails and directs the Agent to update the concrete Skill through the development plan rather than rerunning initialization.

The scaffold provides no reset or uninstall command. Removing or restarting an initialized project is a repository-level user decision and must not be automated destructively.

## File Safety and Transaction

Initialization follows a two-phase write protocol:

1. Parse and validate all CLI input.
2. Resolve the repository root and declared template paths.
3. Read scaffold state and every managed target.
4. Reject unmanaged collisions before creating directories or temporary files.
5. Render every expected file in memory and verify encoding, tokens, and paths.
6. Stage files beside their targets and preserve existing file mode when replacing a scaffold-owned file.
7. Commit staged files in a stable order.
8. On failure, restore replaced files and remove files created by this transaction.
9. Write state as the final committed target.
10. Remove temporary artifacts; cleanup failures produce warnings without hiding a successful commit.

The source scaffold README, package metadata, and default Apache license are known managed inputs and may be replaced during initialization. Any other existing target content causes preflight failure. Symlink targets are rejected so initialization cannot write outside the repository through a linked file.

`--dry-run` performs input parsing, template rendering, target resolution, collision checks, and operation planning, but creates no directory, file, state, stage, or backup.

## Agent Instructions

Root `AGENTS.md` tells an Agent to:

1. Inspect `.scaffold/state.json` before editing.
2. If uninitialized, infer or request only the missing name and description, then run the initializer.
3. Read `docs/mature-skill-development-design.md`, `docs/mature-skill-development-plan.md`, and the concrete Skill Brief.
4. Treat the latest explicit user instruction as higher priority than the current Brief.
5. Keep optional tracks disabled until the plan's evidence gate is satisfied.
6. Use tests before implementation for deterministic features and paired evaluation for Skill behavior.
7. Update the Brief and decision log when requirements change.
8. Run `npm run check` during development and `npm run gate:delivery` before declaring the Skill complete.
9. Review the complete diff and untracked deliverables under the target repository's code-comment policy when code is written.
10. Never publish, rewrite history, delete remote content, or use paid model evaluation without the required authorization.

The Agent instructions point to the full plan instead of duplicating its algorithms, preserving a single source of truth and limiting constant context.

## Validation Layers

### Source and Development Check

`npm run check` executes deterministic tests and repository validation. It passes in both modes:

- Scaffold source mode: validates templates, scripts, docs, package metadata, and the absence of initialized state.
- Initialized draft mode: additionally validates state, rendered files, frontmatter, path safety, JSON, and consistency between state, package metadata, README, and Skill name.

`check` does not require completed behavior evaluations or release readiness, so development can proceed incrementally.

### Delivery Gate

`npm run gate:delivery` requires initialized state and checks:

- State lifecycle is `ready`.
- Skill Brief has no unresolved conflict and every acceptance criterion has a concrete verification method.
- `SKILL.md` has valid frontmatter, a focused workflow, explicit boundaries, and no unresolved template tokens.
- README installation, usage, validation, limitations, and removal instructions match actual commands.
- Evaluation catalog contains at least three realistic cases and covers positive, negative, and boundary behavior.
- Decision log records every optional track as enabled, disabled, or blocked with evidence.
- Delivery report traces acceptance criteria to implementation and verification evidence.
- Prompt budget measurements exist and pass the concrete budget selected by the Agent.
- No generated package whitelist includes scaffold templates, `.scaffold/`, development docs, tests, evaluation workspaces, logs, or credentials.

The gate validates recorded evidence and deterministic artifacts. It does not silently invoke a model or infer that unrun live evaluations passed.

## Test Strategy

Use `node:test` and temporary directories. Tests never initialize the repository checkout itself.

Required coverage:

- CLI help, valid parsing, all invalid option forms, and stable error codes.
- Name, description, and license validation.
- Template token inventory, exact target mapping, and unresolved token rejection.
- Dry-run equivalence and zero file-system side effects.
- Successful initialization with all three license modes.
- Same-argument idempotency and different-argument rejection.
- Unmanaged target collision, symlink target, path traversal, invalid UTF-8, and directory occupation.
- Failure injection during staging, commit, rollback, and cleanup.
- State schema, digest generation, and final-state ordering.
- Source mode and initialized mode validation.
- Delivery gate success and named failure reasons.
- UTF-8 without BOM, LF output, spaces, Unicode descriptions, and Windows/POSIX path behavior.
- README and AGENTS contracts.
- Release package dry-run whitelist for the scaffold repository itself.

CI runs `npm ci --ignore-scripts` and `npm run check` on Node.js 22 across Windows, macOS, and Ubuntu. It does not run model evaluation or `gate:delivery` for the scaffold source repository.

## Documentation

Root README is user-first and covers:

- What the scaffold creates.
- GitHub Template and direct clone workflows.
- Node.js 22 prerequisite.
- Initialization examples and dry run.
- What is generated and what remains optional.
- Development and delivery validation commands.
- Safety behavior and remote-origin warning.
- Repository structure, contribution, security, and license.

`docs/scaffold-usage.md` remains after initialization and provides maintainer details, state schema, recovery behavior, and instructions for upgrading the scaffold tooling without overwriting Skill content.

The approved generic documents are copied without `chinese-code-comments` business rules:

- `docs/mature-skill-development-design.md`
- `docs/mature-skill-development-plan.md`

## Security and Privacy

- Generated examples use `example.invalid`, `tester`, and neutral paths.
- CLI errors and logs never echo environment secrets or complete user configuration.
- Initialization never reads credentials, Agent login state, or paths outside declared repository targets.
- Network access is not required for initialization, validation, or tests.
- GitHub Actions are pinned to immutable full commit SHAs.
- Dependabot covers npm and GitHub Actions.
- `SECURITY.md` uses GitHub Private Vulnerability Reporting and does not publish a private email address.
- Before public push and Release, scan the working tree, Git history, Tag metadata, Release text, and packaged assets for secrets and private paths.

## GitHub and Release

Create `xuanjinchen/skill-development-scaffold` as a public repository after local checks pass. Push `main`, then set the repository's `is_template` property to `true` through the GitHub API.

The repository uses:

- Apache-2.0 license.
- Conventional Commits and Semantic Versioning.
- Protected `main` where supported.
- CI required before merge.
- Dependabot for npm and GitHub Actions.
- Secret scanning, push protection, and CodeQL where GitHub makes them available.

The first stable scaffold release is `v0.1.0`. The Release contains source archives generated by GitHub and, only if a separate artifact materially improves offline use, a deterministic scaffold archive plus SHA-256. The project is not published to npm Registry.

Version Tags are immutable. An existing asset with a different digest cannot be replaced under the same version; content changes require a new version.

## Acceptance Criteria

- A clean clone passes `npm ci --ignore-scripts` and `npm run check` on Windows, macOS, and Ubuntu.
- `npm run init:skill -- --name example-skill --description "Create consistent example outputs"` succeeds in a temporary clone without network access.
- Initialization creates the declared core files, state, and package metadata using UTF-8 without BOM and LF.
- Repeating the same initialization is a no-op; changing an initialization parameter fails without modifying files.
- Dry run reports the same planned targets as a real run and leaves the repository byte-identical.
- An independent Agent can read `AGENTS.md`, initialize from one user objective, and begin Task 1 of the mature Skill plan without designing a repository layout.
- `npm run check` passes immediately after initialization.
- `npm run gate:delivery` fails a draft with named missing evidence and passes a complete fixture.
- Simple Skills can finish without creating scripts, adapters, installer, global rules, or Releases.
- Public documentation never describes untested Agent support as official.
- No real credential, private path, private email, development state, or evaluation workspace appears in the published package or Release assets.
- The public GitHub repository is marked as a Template Repository and its default branch, CI, security files, and license are visible without authentication.
