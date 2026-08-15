import assert from 'node:assert/strict';
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isRetryableLockContentionError, withInstallerLock } from '../../src/installer-lock.js';

async function lockFixture(t, installerLockTimeoutMs = 1_000) {
  const home = await mkdtemp(path.join(tmpdir(), 'chinese-code-comments-lock-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return { home, installerLockTimeoutMs };
}

test('Windows 瞬态共享冲突按锁竞争重试', () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    assert.equal(isRetryableLockContentionError(new Error('lock operation failed', { cause: { code } }), 'win32'), true);
  }
  assert.equal(isRetryableLockContentionError(new Error('invalid owner'), 'win32'), false);
  assert.equal(isRetryableLockContentionError(new Error('lock operation failed', { cause: { code: 'EPERM' } }), 'linux'), false);
});

test('concurrent stale-lock recovery preserves mutual exclusion', async (t) => {
  const context = await lockFixture(t);
  const lock = path.join(context.home, '.chinese-code-comments', 'installer.lock');
  await mkdir(lock, { recursive: true });
  await writeFile(
    path.join(lock, 'owner.json'),
    `${JSON.stringify({ pid: 2147483647, token: 'dead-owner' })}\n`,
  );
  let active = 0;
  let maximum = 0;

  await Promise.all(Array.from({ length: 8 }, () => withInstallerLock(context, async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
  })));

  assert.equal(maximum, 1);
});

test('a failure before lock publication never exposes an ownerless lock', async (t) => {
  const context = await lockFixture(t);
  const lock = path.join(context.home, '.chinese-code-comments', 'installer.lock');

  await assert.rejects(
    withInstallerLock(
      context,
      async () => {},
      { phase: 'before-publish' },
    ),
    /Injected installer lock failure before publish/,
  );
  await assert.rejects(lstat(lock), (error) => error?.code === 'ENOENT');
});

test('an ownerless lock fails after the configured timeout', async (t) => {
  const context = await lockFixture(t, 60);
  await mkdir(path.join(context.home, '.chinese-code-comments', 'installer.lock'), { recursive: true });

  await assert.rejects(
    withInstallerLock(context, async () => {}),
    /timed out.*cannot prove|cannot prove.*timed out/i,
  );
});

test('a live-owner lock fails after the configured timeout without reclaiming it', async (t) => {
  const context = await lockFixture(t, 60);
  const lock = path.join(context.home, '.chinese-code-comments', 'installer.lock');
  await mkdir(lock, { recursive: true });
  await writeFile(
    path.join(lock, 'owner.json'),
    `${JSON.stringify({ pid: process.pid, token: 'live-owner' })}\n`,
  );

  await assert.rejects(withInstallerLock(context, async () => {}), /timed out.*cannot prove/i);
  assert.equal(await readFile(
    path.join(lock, 'owner.json'),
    'utf8',
  ), `${JSON.stringify({ pid: process.pid, token: 'live-owner' })}\n`);
});
