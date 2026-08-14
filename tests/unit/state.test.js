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
    schemaVersion: 2,
    installerVersion: '0.1.0',
    agents: ['opencode', 'codex'],
    storageGroups: {
      agents: {
        members: ['opencode', 'codex'],
        root: 'C:\\Users\\tester\\.agents\\skills',
        files: [
          {
            path: 'C:\\Users\\tester\\.agents\\skills\\chinese-code-comments\\SKILL.md',
            digest: `sha256:${'a'.repeat(64)}`,
            owned: true,
          },
        ],
      },
    },
  });
  const state = JSON.parse(bytes.toString('utf8'));
  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(state.agents, ['codex', 'opencode']);
  assert.deepEqual(state.storageGroups.agents.members, ['codex', 'opencode']);
  assert.equal(state.storageGroups.agents.files[0].owned, true);
});

test('invalid JSON and unsupported schemas are rejected', async (t) => {
  const home = await homeFixture(t);
  const target = statePath({ home });
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, '{broken');
  await assert.rejects(readState({ home }), /valid JSON/);

  await writeFile(target, JSON.stringify({ schemaVersion: 3, agents: [], storageGroups: {} }));
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

test('unknown agents and incorrect storage-group mappings are rejected', async (t) => {
  const home = await homeFixture(t);
  const target = statePath({ home });
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({
    schemaVersion: 1,
    installerVersion: '0.1.0',
    agents: ['unknown'],
    storageGroups: { agents: ['unknown'] },
  }));
  await assert.rejects(readState({ home }), /unknown agent/i);

  await writeFile(target, JSON.stringify({
    schemaVersion: 1,
    installerVersion: '0.1.0',
    agents: ['claude'],
    storageGroups: { agents: ['claude'] },
  }));
  await assert.rejects(readState({ home }), /storage group/i);
});

test('schema v2 requires absolute paths, digests, and ownership flags', async (t) => {
  const home = await homeFixture(t);
  const target = statePath({ home });
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({
    schemaVersion: 2,
    installerVersion: '0.1.0',
    agents: ['claude'],
    storageGroups: {
      claude: {
        members: ['claude'],
        root: path.join(home, '.claude', 'skills'),
        files: [{ path: 'SKILL.md', digest: 'broken', owned: 'yes' }],
      },
    },
  }));
  await assert.rejects(readState({ home }), /file record/i);
});

test('schema v2 requires the complete managed file set below its recorded root', async (t) => {
  const home = await homeFixture(t);
  const target = statePath({ home });
  const root = path.join(home, '.agents', 'skills');
  await mkdir(path.dirname(target), { recursive: true });
  const base = {
    schemaVersion: 2,
    installerVersion: '0.1.0',
    agents: ['codex'],
    storageGroups: {
      agents: {
        members: ['codex'],
        root,
        files: [],
      },
    },
    policies: {
      codex: {
        path: path.join(home, '.codex', 'AGENTS.md'),
        digest: `sha256:${'a'.repeat(64)}`,
        owned: true,
      },
    },
  };
  await writeFile(target, JSON.stringify(base));
  await assert.rejects(readState({ home }), /managed file set/i);

  base.storageGroups.agents.files = [
    {
      path: path.join(home, 'outside', 'SKILL.md'),
      digest: `sha256:${'a'.repeat(64)}`,
      owned: true,
    },
    {
      path: path.join(root, 'chinese-code-comments', 'agents', 'openai.yaml'),
      digest: `sha256:${'b'.repeat(64)}`,
      owned: true,
    },
  ];
  await writeFile(target, JSON.stringify(base));
  await assert.rejects(readState({ home }), /managed file set|recorded root/i);
});
