import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const RETRY_DELAY_MS = 10;
const DEFAULT_TIMEOUT_MS = 30_000;

function lockPath({ home }) {
  return path.join(home, '.chinese-code-comments', 'installer.lock');
}

function recoveryPath(target) {
  return `${target}.recovery`;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function readOwner(target) {
  try {
    return JSON.parse(await readFile(path.join(target, 'owner.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`Installer lock owner is invalid: ${target}`, { cause: error });
  }
}

function assertOwner(owner, target) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0 || typeof owner.token !== 'string') {
    throw new Error(`Installer lock owner is invalid: ${target}`);
  }
}

export function isRetryableLockContentionError(error, platform = process.platform) {
  const code = error?.code ?? error?.cause?.code;
  return platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(code);
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function recoverDeadLock(target, observedOwner) {
  const recovery = recoveryPath(target);
  try {
    await mkdir(recovery);
  } catch (error) {
    if (error?.code === 'EEXIST' || isRetryableLockContentionError(error)) return false;
    throw error;
  }

  try {
    let currentOwner;
    try {
      currentOwner = await readOwner(target);
    } catch (error) {
      if (isRetryableLockContentionError(error)) return false;
      throw error;
    }
    if (!currentOwner || currentOwner.token !== observedOwner.token) return false;
    assertOwner(currentOwner, target);
    if (processIsAlive(currentOwner.pid)) return false;

    const quarantine = `${target}.stale.${randomUUID()}`;
    try {
      // recovery gate 阻止新持有者提交 owner；rename 只隔离本次重新确认过的锁目录。
      await rename(target, quarantine);
    } catch (error) {
      if (error?.code === 'ENOENT' || isRetryableLockContentionError(error)) return false;
      throw error;
    }
    await rm(quarantine, { recursive: true, force: true });
    return true;
  } finally {
    await rm(recovery, { recursive: true, force: true });
  }
}

async function acquireInstallerLock(context) {
  const target = lockPath(context);
  const timeoutMs = context.installerLockTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  await mkdir(path.dirname(target), { recursive: true });

  while (Date.now() < deadline) {
    if (await pathExists(recoveryPath(target))) {
      await delay(RETRY_DELAY_MS);
      continue;
    }

    const token = randomUUID();
    try {
      await mkdir(target);
      if (await pathExists(recoveryPath(target))) {
        await rm(target, { recursive: true, force: true });
        await delay(RETRY_DELAY_MS);
        continue;
      }
      const draft = path.join(target, `owner.${token}.tmp`);
      try {
        await writeFile(draft, `${JSON.stringify({ pid: process.pid, token })}\n`, { flag: 'wx' });
        await rename(draft, path.join(target, 'owner.json'));
      } catch (error) {
        await rm(target, { recursive: true, force: true });
        throw error;
      }

      return async () => {
        const owner = await readOwner(target);
        // 只释放自己持有的锁，避免误删等待期间由其他进程重新创建的锁目录。
        if (owner?.token === token) {
          await rm(target, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST' && !isRetryableLockContentionError(error)) throw error;
    }

    let owner;
    try {
      owner = await readOwner(target);
    } catch (error) {
      // Windows 回收者重命名锁目录时可能短暂拒绝共享访问；保持等待即可重新观察稳定状态。
      if (isRetryableLockContentionError(error)) {
        await delay(RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
    if (owner !== null) {
      assertOwner(owner, target);
      if (!processIsAlive(owner.pid) && await recoverDeadLock(target, owner)) continue;
    }
    await delay(RETRY_DELAY_MS);
  }

  throw new Error(`Installer lock timed out; cannot prove it is safe to reclaim: ${target}`);
}

export async function withInstallerLock(context, operation) {
  const release = await acquireInstallerLock(context);
  try {
    return await operation();
  } finally {
    await release();
  }
}
