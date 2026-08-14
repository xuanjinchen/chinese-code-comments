import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { emptyState, readState, serializeState, statePath } from '../../src/state.js';

async function homeFixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'chinese-code-comments-state-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

test('missing state reads as an empty versioned state', async (t) => {
  const home = await homeFixture(t);
  assert.deepEqual(await readState({ home }), emptyState());
});

test('state uses a stable user-level path', async (t) => {
  const home = await homeFixture(t);
  assert.equal(
    statePath({ home }),
    path.join(home, '.chinese-code-comments', 'state.json'),
  );
});

test('state serialization sorts agents and storage group members', () => {
  const bytes = serializeState({
    schemaVersion: 1,
    installerVersion: '0.1.0',
    agents: ['opencode', 'codex'],
    storageGroups: { agents: ['opencode', 'codex'] },
  });
  assert.equal(
    bytes.toString('utf8'),
    '{\n  "schemaVersion": 1,\n  "installerVersion": "0.1.0",\n  "agents": [\n    "codex",\n    "opencode"\n  ],\n  "storageGroups": {\n    "agents": [\n      "codex",\n      "opencode"\n    ]\n  }\n}\n',
  );
});

test('invalid JSON and unsupported schemas are rejected', async (t) => {
  const home = await homeFixture(t);
  const target = statePath({ home });
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, '{broken');
  await assert.rejects(readState({ home }), /valid JSON/);

  await writeFile(target, JSON.stringify({ schemaVersion: 2, agents: [], storageGroups: {} }));
  await assert.rejects(readState({ home }), /Unsupported installation state schema/);
});

test('duplicate state members are rejected', async (t) => {
  const home = await homeFixture(t);
  const target = statePath({ home });
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({
    schemaVersion: 1,
    installerVersion: '0.1.0',
    agents: ['codex', 'codex'],
    storageGroups: { agents: ['codex'] },
  }));
  await assert.rejects(readState({ home }), /duplicate agent/);
});
