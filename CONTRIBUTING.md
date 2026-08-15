# Contributing

## Scope

Contributions must support the project's single goal: automatically generating accurate, concise, and clear code comments. Features unrelated to code comments, such as general debugging, code review, writing, MCP services, or editor plugins, are out of scope.

Before opening an Issue, check existing Issues and the latest Release. Use the combined bug and compatibility template for installer, Agent, platform, or comment behavior problems. Report suspected vulnerabilities through the private process in `SECURITY.md`.

## Development

Requirements:

- Node.js 22 or newer
- Git with HTTPS certificate verification enabled

Install and verify:

```bash
npm ci --ignore-scripts
npm run check
npm pack --dry-run
git diff --check
```

Real Agent evaluations are optional and may consume model tokens. Run them only for a selected Agent when the change affects live behavior.

## Changes

- Keep installation, removal, testing, and maintenance commands based on Node.js/npm.
- Preserve the six supported Agent adapters unless a compatibility change is explicitly justified and tested.
- Add tests before behavior fixes or new behavior, then confirm the new test fails for the expected reason.
- Keep code comments focused on intent, constraints, boundaries, exceptions, concurrency, resource management, compatibility, and non-obvious implementation details.
- Do not commit credentials, local paths, generated evaluation output, temporary directories, or unrelated refactors.
- Use Conventional Commits such as `fix: ...`, `feat: ...`, `docs: ...`, or `test: ...`.

Pull requests should be focused, explain compatibility impact, list verification performed, and confirm the complete diff received a code-comment review.
