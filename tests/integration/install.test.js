import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import { main } from '../../src/cli.js';
import { install } from '../../src/install.js';
import { readState } from '../../src/state.js';
import { createHomeFixture } from '../helpers/fs-fixture.js';

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));

test('default install creates three Skill copies and six policies', async (t) => {
  const fixture = await createHomeFixture(t);
  const result = await install({ agents: null, context: fixture.context, sourceRoot });

  assert.deepEqual(result.agents, ['codex', 'claude', 'gemini', 'grok', 'opencode', 'hermes']);
  for (const relative of [
    '.agents/skills/chinese-code-comments/SKILL.md',
    '.claude/skills/chinese-code-comments/SKILL.md',
    '.hermes/skills/chinese-code-comments/SKILL.md',
    '.agents/skills/chinese-code-comments/agents/openai.yaml',
    '.codex/AGENTS.md',
    '.claude/CLAUDE.md',
    '.gemini/GEMINI.md',
    '.grok/AGENTS.md',
    '.config/opencode/AGENTS.md',
    '.hermes/SOUL.md',
  ]) {
    assert.equal(await fixture.exists(relative), true, relative);
  }
  assert.equal((await fixture.read('.codex/AGENTS.md')).includes('$chinese-code-comments'), true);
  assert.equal((await fixture.read('.hermes/SOUL.md')).includes('<!--'), false);
});

test('selected shared adapters create one Skill copy and only selected policies', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['codex', 'gemini'], context: fixture.context, sourceRoot });

  assert.equal(await fixture.exists('.agents/skills/chinese-code-comments/SKILL.md'), true);
  assert.equal(await fixture.exists('.claude/skills/chinese-code-comments/SKILL.md'), false);
  assert.equal(await fixture.exists('.codex/AGENTS.md'), true);
  assert.equal(await fixture.exists('.gemini/GEMINI.md'), true);
  assert.equal(await fixture.exists('.grok/AGENTS.md'), false);
  assert.deepEqual(await readState(fixture.context), {
    schemaVersion: 1,
    installerVersion: '0.1.0',
    agents: ['codex', 'gemini'],
    storageGroups: { agents: ['codex', 'gemini'] },
  });
});

test('repeated installation is byte-identical', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: null, context: fixture.context, sourceRoot });
  const before = await fixture.snapshot();
  await install({ agents: null, context: fixture.context, sourceRoot });
  assert.deepEqual(await fixture.snapshot(), before);
});

test('existing BOM, CRLF, and non-managed policy text are preserved', async (t) => {
  const fixture = await createHomeFixture(t);
  const prefix = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('# 用户规则\r\n', 'utf8'),
  ]);
  await fixture.write('.codex/AGENTS.md', prefix);

  await install({ agents: ['codex'], context: fixture.context, sourceRoot });

  const installed = await fixture.read('.codex/AGENTS.md', null);
  assert.equal(installed.subarray(0, prefix.length).equals(prefix), true);
  assert.equal(installed.toString('utf8').replaceAll('\r\n', '').includes('\n'), false);
});

test('legacy Codex managed block is replaced in place', async (t) => {
  const fixture = await createHomeFixture(t);
  await fixture.write('.agents/skills/chinese-code-comments/SKILL.md', 'legacy skill\n');
  await fixture.write('.agents/skills/chinese-code-comments/agents/openai.yaml', 'legacy metadata\n');
  await fixture.write(
    '.codex/AGENTS.md',
    'before\n<!-- chinese-code-comments:start -->\nold\n<!-- chinese-code-comments:end -->\nafter\n',
  );

  await install({ agents: ['codex'], context: fixture.context, sourceRoot });

  const rules = await fixture.read('.codex/AGENTS.md');
  assert.match(rules, /^before\n<!-- chinese-code-comments:start -->/);
  assert.match(rules, /\$chinese-code-comments/);
  assert.match(rules, /<!-- chinese-code-comments:end -->\nafter\n$/);
  assert.doesNotMatch(rules, /\nold\n/);
  assert.equal(
    await fixture.read('.agents/skills/chinese-code-comments/SKILL.md'),
    await readFile(path.join(sourceRoot, 'SKILL.md'), 'utf8'),
  );
});

test('install rejects an unmanaged Skill with different content before any write', async (t) => {
  const fixture = await createHomeFixture(t);
  await fixture.write('.agents/skills/chinese-code-comments/SKILL.md', 'managed by another installer\n');
  const before = await fixture.snapshot();

  await assert.rejects(
    install({ agents: ['gemini'], context: fixture.context, sourceRoot }),
    /not owned by this installer/,
  );

  assert.deepEqual(await fixture.snapshot(), before);
});

test('install rejects UTF-16 managed targets instead of overwriting them', async (t) => {
  const fixture = await createHomeFixture(t);
  await fixture.write(
    '.agents/skills/chinese-code-comments/SKILL.md',
    Buffer.from([0xff, 0xfe, 0x53, 0x00]),
  );
  const before = await fixture.snapshot();

  await assert.rejects(
    install({ agents: ['codex'], context: fixture.context, sourceRoot }),
    /UTF-16/,
  );

  assert.deepEqual(await fixture.snapshot(), before);
});

test('state ownership does not authorize overwriting a Skill at a changed config root', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['claude'], context: fixture.context, sourceRoot });
  const changedRoot = fixture.path('other-claude-home');
  await fixture.write(
    'other-claude-home/skills/chinese-code-comments/SKILL.md',
    'managed by another installer\n',
  );
  const before = await fixture.snapshot();

  await assert.rejects(
    install({
      agents: ['claude'],
      context: {
        ...fixture.context,
        env: { CLAUDE_CONFIG_DIR: changedRoot },
      },
      sourceRoot,
    }),
    /not owned by this installer/,
  );

  assert.deepEqual(await fixture.snapshot(), before);
});

test('preflight failure leaves every earlier target absent', async (t) => {
  const fixture = await createHomeFixture(t);
  await fixture.write('.claude', 'occupied');
  const before = await fixture.snapshot();

  await assert.rejects(
    install({ agents: null, context: fixture.context, sourceRoot }),
    /Path ancestor must be a directory/,
  );

  assert.deepEqual(await fixture.snapshot(), before);
});

test('CLI install dispatches with the process home and reports selected agents', async (t) => {
  const fixture = await createHomeFixture(t);
  let stdout = '';
  let stderr = '';
  const exitCode = await main({
    argv: ['install', '--agent', 'codex'],
    env: { HOME: fixture.home, USERPROFILE: fixture.home },
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /Installed agents: codex/);
  assert.match(stdout, /Installed Skill group: agents/);
  assert.match(stdout, new RegExp(`Updated policy: ${fixture.path('.codex/AGENTS.md').replaceAll('\\', '\\\\')}`));
  assert.equal(stderr, '');
  assert.equal(await fixture.exists('.codex/AGENTS.md'), true);
});
