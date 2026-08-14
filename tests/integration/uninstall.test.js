import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import { main } from '../../src/cli.js';
import { install } from '../../src/install.js';
import { readState, statePath } from '../../src/state.js';
import { uninstall } from '../../src/uninstall.js';
import { createHomeFixture } from '../helpers/fs-fixture.js';

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));

test('partial uninstall keeps a shared Skill used by another adapter', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['codex', 'gemini'], context: fixture.context, sourceRoot });

  await uninstall({ agents: ['codex'], context: fixture.context });

  assert.equal(await fixture.exists('.agents/skills/chinese-code-comments/SKILL.md'), true);
  assert.equal(await fixture.exists('.codex/AGENTS.md'), false);
  assert.equal(await fixture.exists('.gemini/GEMINI.md'), true);
  assert.deepEqual((await readState(fixture.context)).agents, ['gemini']);
});

test('full uninstall removes managed files but preserves extra Skill files', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: null, context: fixture.context, sourceRoot });
  await fixture.write('.agents/skills/chinese-code-comments/notes.md', 'user notes\n');

  await uninstall({ agents: null, context: fixture.context });

  assert.equal(await fixture.exists('.agents/skills/chinese-code-comments/SKILL.md'), false);
  assert.equal(await fixture.exists('.agents/skills/chinese-code-comments/agents/openai.yaml'), false);
  assert.equal(await fixture.read('.agents/skills/chinese-code-comments/notes.md'), 'user notes\n');
  assert.equal(await fixture.exists('.codex/AGENTS.md'), false);
  assert.equal(await fixture.exists('.hermes/SOUL.md'), false);
  assert.equal(await fixture.exists(path.relative(fixture.home, statePath(fixture.context)).replaceAll('\\', '/')), false);
});

test('repeated uninstall is an idempotent success', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['claude'], context: fixture.context, sourceRoot });
  await uninstall({ agents: ['claude'], context: fixture.context });
  const before = await fixture.snapshot();
  const result = await uninstall({ agents: ['claude'], context: fixture.context });
  assert.deepEqual(await fixture.snapshot(), before);
  assert.deepEqual(result.warnings, []);
  assert.equal(await fixture.exists('.claude'), false);
});

test('partial uninstall with invalid state conservatively retains shared Skill files', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['codex', 'gemini'], context: fixture.context, sourceRoot });
  await fixture.write('.chinese-code-comments/state.json', 'invalid');

  await uninstall({ agents: ['codex'], context: fixture.context });

  assert.equal(await fixture.exists('.agents/skills/chinese-code-comments/SKILL.md'), true);
  assert.equal(await fixture.exists('.codex/AGENTS.md'), true);
  assert.equal(await fixture.exists('.gemini/GEMINI.md'), true);
  assert.equal(await fixture.read('.chinese-code-comments/state.json'), 'invalid');
});

test('full uninstall conservatively retains files when state is invalid', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: null, context: fixture.context, sourceRoot });
  await fixture.write('.chinese-code-comments/state.json', 'invalid');

  await uninstall({ agents: null, context: fixture.context });

  assert.equal(await fixture.exists('.agents/skills/chinese-code-comments/SKILL.md'), true);
  assert.equal(await fixture.exists('.claude/skills/chinese-code-comments/SKILL.md'), true);
  assert.equal(await fixture.exists('.hermes/skills/chinese-code-comments/SKILL.md'), true);
  assert.equal(await fixture.exists('.codex/AGENTS.md'), true);
  assert.equal(await fixture.read('.chinese-code-comments/state.json'), 'invalid');
});

test('uninstall without state preserves a policy whose ownership cannot be proved', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['codex'], context: fixture.context, sourceRoot });
  await rm(statePath(fixture.context));

  const result = await uninstall({ agents: ['codex'], context: fixture.context });

  assert.equal(await fixture.exists('.codex/AGENTS.md'), true);
  assert.match(result.warnings.join('\n'), /state|ownership/i);
});

test('full uninstall without state preserves an independently installed Skill', async (t) => {
  const fixture = await createHomeFixture(t);
  await fixture.write(
    '.agents/skills/chinese-code-comments/SKILL.md',
    await readFile(path.join(sourceRoot, 'SKILL.md')),
  );

  const result = await uninstall({ agents: null, context: fixture.context });

  assert.equal(await fixture.exists('.agents/skills/chinese-code-comments/SKILL.md'), true);
  assert.match(result.warnings.join('\n'), /state|ownership/i);
});

test('full uninstall warns for every untracked shared policy and metadata file', async (t) => {
  const fixture = await createHomeFixture(t);
  await fixture.write('.gemini/GEMINI.md', 'external policy\n');
  await fixture.write('.agents/skills/chinese-code-comments/agents/openai.yaml', 'external metadata\n');

  const result = await uninstall({ agents: null, context: fixture.context });

  assert.equal(await fixture.exists('.gemini/GEMINI.md'), true);
  assert.equal(await fixture.exists('.agents/skills/chinese-code-comments/agents/openai.yaml'), true);
  assert.match(result.warnings.join('\n'), /GEMINI\.md/u);
  assert.match(result.warnings.join('\n'), /openai\.yaml/u);
});

test('uninstall uses recorded paths and preserves same-name files at a changed root', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['claude'], context: fixture.context, sourceRoot });
  const changedRoot = fixture.path('other-claude-home');
  await fixture.write(
    'other-claude-home/skills/chinese-code-comments/SKILL.md',
    'managed elsewhere\n',
  );

  const result = await uninstall({
    agents: ['claude'],
    context: { ...fixture.context, env: { CLAUDE_CONFIG_DIR: changedRoot } },
  });

  assert.equal(await fixture.exists('.claude/skills/chinese-code-comments/SKILL.md'), false);
  assert.equal(await fixture.exists('.claude/CLAUDE.md'), false);
  assert.equal(
    await fixture.read('other-claude-home/skills/chinese-code-comments/SKILL.md'),
    'managed elsewhere\n',
  );
  assert.match(result.warnings.join('\n'), /root|path|config/i);
});

test('uninstall retains owned files whose content drifted and emits a warning', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['claude'], context: fixture.context, sourceRoot });
  await fixture.write('.claude/skills/chinese-code-comments/SKILL.md', 'user-modified\n');

  const result = await uninstall({ agents: ['claude'], context: fixture.context });

  assert.equal(
    await fixture.read('.claude/skills/chinese-code-comments/SKILL.md'),
    'user-modified\n',
  );
  assert.match(result.warnings.join('\n'), /drift|modified/i);
});

test('uninstall retains an identical Skill that install recorded as external', async (t) => {
  const fixture = await createHomeFixture(t);
  await fixture.write(
    '.claude/skills/chinese-code-comments/SKILL.md',
    await readFile(path.join(sourceRoot, 'SKILL.md')),
  );
  await install({ agents: ['claude'], context: fixture.context, sourceRoot });

  const result = await uninstall({ agents: ['claude'], context: fixture.context });

  assert.equal(await fixture.exists('.claude/skills/chinese-code-comments/SKILL.md'), true);
  assert.match(result.warnings.join('\n'), /external|ownership/i);
});

test('uninstalling an adapter absent from state preserves an independently managed Skill', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['claude'], context: fixture.context, sourceRoot });
  await fixture.write(
    '.agents/skills/chinese-code-comments/SKILL.md',
    'independently installed\n',
  );

  await uninstall({ agents: ['codex'], context: fixture.context });

  assert.equal(
    await fixture.read('.agents/skills/chinese-code-comments/SKILL.md'),
    'independently installed\n',
  );
  assert.deepEqual((await readState(fixture.context)).agents, ['claude']);
});

test('uninstall prunes an empty configured Agent root without touching its parent', async (t) => {
  const fixture = await createHomeFixture(t);
  const parent = await mkdtemp(path.join(tmpdir(), 'ccc-external-config-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const configRoot = path.join(parent, 'claude');
  const context = {
    ...fixture.context,
    env: { CLAUDE_CONFIG_DIR: configRoot },
  };
  await install({ agents: ['claude'], context, sourceRoot });

  await uninstall({ agents: ['claude'], context });

  await assert.rejects(access(configRoot), (error) => error?.code === 'ENOENT');
  await access(parent);
});

test('uninstall commit failure restores the complete installation', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['codex', 'gemini'], context: fixture.context, sourceRoot });
  const before = await fixture.snapshot();

  await assert.rejects(
    uninstall({ agents: null, context: fixture.context, fault: { phase: 'commit', index: 1 } }),
    /Injected commit failure/,
  );
  assert.deepEqual(await fixture.snapshot(), before);
});

test('CLI uninstall removes the selected adapter', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['claude'], context: fixture.context, sourceRoot });
  let stdout = '';
  const exitCode = await main({
    argv: ['uninstall', '--agent', 'claude'],
    env: { HOME: fixture.home, USERPROFILE: fixture.home },
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write() {} },
  });
  assert.equal(exitCode, 0);
  assert.match(stdout, /Uninstalled agents: claude/);
  assert.equal(await fixture.exists('.claude/CLAUDE.md'), false);
});
