import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import { main } from '../../src/cli.js';
import { doctor } from '../../src/doctor.js';
import { install } from '../../src/install.js';
import { statePath } from '../../src/state.js';
import { createHomeFixture } from '../helpers/fs-fixture.js';

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));

function statuses(result, subject) {
  return result.checks.filter((check) => check.subject === subject).map((check) => check.status);
}

test('doctor reports a healthy selected installation even when CLI is absent', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['codex'], context: fixture.context, sourceRoot });
  const result = await doctor({
    agents: ['codex'],
    context: { ...fixture.context, env: { PATH: '' } },
    sourceRoot,
  });

  assert.equal(result.healthy, true);
  assert.equal(result.checks.every((check) => check.status === 'ok'), true);
  assert.match(result.checks.find((check) => check.subject === 'cli').message, /not found/i);
});

test('doctor detects Skill drift and a missing policy', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['codex', 'claude'], context: fixture.context, sourceRoot });
  await fixture.write('.agents/skills/chinese-code-comments/SKILL.md', 'stale\n');
  await rm(fixture.path('.claude/CLAUDE.md'));

  const result = await doctor({ agents: ['codex', 'claude'], context: fixture.context, sourceRoot });

  assert.equal(result.healthy, false);
  assert.equal(statuses(result, 'skill').includes('drift'), true);
  assert.equal(statuses(result, 'policy').includes('missing'), true);
});

test('doctor reports malformed policy markers as invalid', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['codex'], context: fixture.context, sourceRoot });
  await fixture.write('.codex/AGENTS.md', '<!-- chinese-code-comments:start -->\nbroken\n');

  const result = await doctor({ agents: ['codex'], context: fixture.context, sourceRoot });

  assert.equal(result.healthy, false);
  assert.equal(statuses(result, 'policy').includes('invalid'), true);
});

test('doctor ignores changes outside the managed policy block', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['claude'], context: fixture.context, sourceRoot });
  const policy = await fixture.read('.claude/CLAUDE.md');
  await fixture.write('.claude/CLAUDE.md', `${policy}# user-owned rule\n`);

  const result = await doctor({ agents: ['claude'], context: fixture.context, sourceRoot });

  assert.equal(result.healthy, true);
  assert.equal(statuses(result, 'policy').includes('ok'), true);
  assert.equal(statuses(result, 'state').includes('ok'), true);
});

test('doctor detects state reference drift', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['codex'], context: fixture.context, sourceRoot });
  await writeFile(statePath(fixture.context), JSON.stringify({
    schemaVersion: 1,
    installerVersion: '0.1.0',
    agents: [],
    storageGroups: {},
  }));

  const result = await doctor({ agents: ['codex'], context: fixture.context, sourceRoot });

  assert.equal(result.healthy, false);
  assert.equal(statuses(result, 'state').includes('drift'), true);
});

test('doctor reports identical externally owned Skill content as ownership drift', async (t) => {
  const fixture = await createHomeFixture(t);
  await fixture.write(
    '.claude/skills/chinese-code-comments/SKILL.md',
    await readFile(path.join(sourceRoot, 'SKILL.md')),
  );
  await install({ agents: ['claude'], context: fixture.context, sourceRoot });

  const result = await doctor({ agents: ['claude'], context: fixture.context, sourceRoot });

  assert.equal(result.healthy, false);
  const state = result.checks.find((check) => check.subject === 'state');
  assert.equal(state.status, 'drift');
  assert.match(state.message, /ownership|external/i);
});

test('doctor detects tampered state digests', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['claude'], context: fixture.context, sourceRoot });
  const target = statePath(fixture.context);
  const state = JSON.parse(await readFile(target, 'utf8'));
  state.storageGroups.claude.files[0].digest = `sha256:${'0'.repeat(64)}`;
  await writeFile(target, `${JSON.stringify(state)}\n`, 'utf8');

  const result = await doctor({ agents: ['claude'], context: fixture.context, sourceRoot });

  assert.equal(result.healthy, false);
  assert.equal(statuses(result, 'state').includes('drift'), true);
});

test('doctor requires schema v1 installations to migrate before reporting healthy', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['claude'], context: fixture.context, sourceRoot });
  await fixture.write('.chinese-code-comments/state.json', `${JSON.stringify({
    schemaVersion: 1,
    installerVersion: '0.1.0',
    agents: ['claude'],
    storageGroups: { claude: ['claude'] },
  })}\n`);

  const result = await doctor({ agents: ['claude'], context: fixture.context, sourceRoot });

  assert.equal(result.healthy, false);
  assert.match(result.checks.find((check) => check.subject === 'state').message, /schema v1|migrate/i);
});

test('doctor waits for the user-level installer lock', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['claude'], context: fixture.context, sourceRoot });
  await fixture.write(
    '.chinese-code-comments/installer.lock/owner.json',
    `${JSON.stringify({ pid: process.pid, token: 'live-owner' })}\n`,
  );
  let completed = false;
  const pending = doctor({ agents: ['claude'], context: fixture.context, sourceRoot })
    .then(() => { completed = true; });
  await new Promise((resolve) => setTimeout(resolve, 25));
  const completedWhileLocked = completed;
  await rm(fixture.path('.chinese-code-comments/installer.lock'), { recursive: true });
  await pending;

  assert.equal(completedWhileLocked, false);
});

test('doctor identifies a legacy PowerShell layout and gives the migration command', async (t) => {
  const fixture = await createHomeFixture(t);
  await fixture.write(
    '.agents/skills/chinese-code-comments/SKILL.md',
    await readFile(path.join(sourceRoot, 'SKILL.md')),
  );
  await fixture.write(
    '.codex/AGENTS.md',
    '<!-- chinese-code-comments:start -->\nlegacy policy\n<!-- chinese-code-comments:end -->\n',
  );

  const result = await doctor({ agents: ['codex'], context: fixture.context, sourceRoot });

  const state = result.checks.find((check) => check.agent === 'codex' && check.subject === 'state');
  assert.equal(state.status, 'drift');
  assert.match(state.message, /legacy PowerShell installation.*install --agent codex/i);
});

test('CLI doctor returns nonzero and prints drift details', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['codex'], context: fixture.context, sourceRoot });
  await fixture.write('.agents/skills/chinese-code-comments/SKILL.md', 'stale\n');
  let stdout = '';
  const exitCode = await main({
    argv: ['doctor', '--agent', 'codex'],
    env: { HOME: fixture.home, USERPROFILE: fixture.home, PATH: '' },
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write() {} },
  });
  assert.equal(exitCode, 1);
  assert.match(stdout, /codex\s+skill\s+drift/);
});
