import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeTransaction } from '../../src/transaction.js';

async function fixture(t, files = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chinese-code-comments-transaction-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

async function snapshot(root) {
  const result = {};
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else {
        result[path.relative(root, absolute)] = (await readFile(absolute)).toString('base64');
      }
    }
  }
  await walk(root);
  return result;
}

test('a successful transaction writes and deletes in declared order', async (t) => {
  const root = await fixture(t, { 'a.txt': 'old-a', 'remove.txt': 'old-remove' });
  const result = await executeTransaction([
    { target: path.join(root, 'a.txt'), content: Buffer.from('new-a'), kind: 'policy' },
    { target: path.join(root, 'nested', 'b.txt'), content: Buffer.from('new-b'), kind: 'skill' },
    { target: path.join(root, 'remove.txt'), content: null, kind: 'managed-file' },
  ]);

  assert.deepEqual(result, { warnings: [] });
  assert.deepEqual(await snapshot(root), {
    'a.txt': Buffer.from('new-a').toString('base64'),
    [path.join('nested', 'b.txt')]: Buffer.from('new-b').toString('base64'),
  });
});

for (const index of [0, 1, 2]) {
  test(`commit failure ${index} restores all original bytes`, async (t) => {
    const root = await fixture(t, { 'a.txt': 'old-a', 'b.txt': 'old-b' });
    const before = await snapshot(root);
    await assert.rejects(
      executeTransaction([
        { target: path.join(root, 'a.txt'), content: Buffer.from('new-a'), kind: 'policy' },
        { target: path.join(root, 'b.txt'), content: null, kind: 'managed-file' },
        { target: path.join(root, 'new', 'c.txt'), content: Buffer.from('new-c'), kind: 'state' },
      ], { fault: { phase: 'commit', index } }),
      new RegExp(`Injected commit failure at index ${index}`),
    );
    assert.deepEqual(await snapshot(root), before);
  });
}

test('preflight rejects a file ancestor without creating siblings', async (t) => {
  const root = await fixture(t, { occupied: 'file' });
  const before = await snapshot(root);
  await assert.rejects(
    executeTransaction([
      { target: path.join(root, 'first', 'ok.txt'), content: Buffer.from('new'), kind: 'skill' },
      { target: path.join(root, 'occupied', 'bad.txt'), content: Buffer.from('new'), kind: 'policy' },
    ]),
    /Path ancestor must be a directory/,
  );
  assert.deepEqual(await snapshot(root), before);
});

test('staging failure removes temporary files and newly created directories', async (t) => {
  const root = await fixture(t, { 'existing.txt': 'old' });
  const before = await snapshot(root);
  await assert.rejects(
    executeTransaction([
      { target: path.join(root, 'new', 'first.txt'), content: Buffer.from('first'), kind: 'skill' },
      { target: path.join(root, 'existing.txt'), content: Buffer.from('new'), kind: 'policy' },
    ], { fault: { phase: 'stage', index: 1 } }),
    /Injected staging failure at index 1/,
  );
  assert.deepEqual(await snapshot(root), before);
});

test('rollback failures are reported with the installation failure', async (t) => {
  const root = await fixture(t, { 'a.txt': 'old-a' });
  await assert.rejects(
    executeTransaction([
      { target: path.join(root, 'a.txt'), content: Buffer.from('new-a'), kind: 'policy' },
      { target: path.join(root, 'b.txt'), content: Buffer.from('new-b'), kind: 'state' },
    ], { fault: { phase: 'commit', index: 1, rollbackIndex: 0 } }),
    /Rollback also failed: Injected rollback failure at index 0/,
  );
  const recoveryFiles = (await readdir(root)).filter((name) => name.endsWith('.backup'));
  assert.equal(recoveryFiles.length, 1);
  assert.equal(await readFile(path.join(root, recoveryFiles[0]), 'utf8'), 'old-a');
});

test('cleanup failure preserves committed content and returns a warning', async (t) => {
  const root = await fixture(t, { 'a.txt': 'old-a' });
  const result = await executeTransaction([
    { target: path.join(root, 'a.txt'), content: Buffer.from('new-a'), kind: 'policy' },
  ], { fault: { phase: 'cleanup', index: 0 } });

  assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), 'new-a');
  assert.match(result.warnings[0], /Injected cleanup failure at index 0/);
});

test('duplicate targets are rejected during preflight', async (t) => {
  const root = await fixture(t);
  const target = path.join(root, 'same.txt');
  await assert.rejects(
    executeTransaction([
      { target, content: Buffer.from('one'), kind: 'skill' },
      { target, content: Buffer.from('two'), kind: 'policy' },
    ]),
    /Duplicate transaction target/,
  );
});

test('deleting a missing target does not create its parent directories', async (t) => {
  const root = await fixture(t);

  await executeTransaction([{
    target: path.join(root, 'missing', 'nested', 'file.txt'),
    content: null,
    kind: 'managed-file',
  }]);

  assert.deepEqual(await readdir(root), []);
});
