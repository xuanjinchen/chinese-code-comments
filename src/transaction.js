import { constants } from 'node:fs';
import {
  copyFile,
  chmod,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

async function fileStatOrNull(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return null;
    }
    throw error;
  }
}

async function directoryStatOrNull(target) {
  try {
    return await stat(target);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function preflight(entries) {
  const targets = new Set();
  const prepared = [];
  for (const entry of entries) {
    if (!Buffer.isBuffer(entry.content) && entry.content !== null) {
      throw new TypeError(`Transaction content must be a Buffer or null: ${entry.target}`);
    }
    const target = path.resolve(entry.target);
    const identity = process.platform === 'win32' ? target.toLowerCase() : target;
    if (targets.has(identity)) {
      throw new Error(`Duplicate transaction target: ${target}`);
    }
    targets.add(identity);

    const targetStat = await fileStatOrNull(target);
    if (targetStat && !targetStat.isFile()) {
      throw new Error(`Transaction target must be a file: ${target}`);
    }

    const missingDirectories = [];
    let cursor = path.dirname(target);
    while (true) {
      const cursorStat = await directoryStatOrNull(cursor);
      if (cursorStat) {
        if (!cursorStat.isDirectory()) {
          throw new Error(`Path ancestor must be a directory: ${cursor}`);
        }
        break;
      }
      missingDirectories.push(cursor);
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new Error(`Cannot find an existing directory ancestor for: ${target}`);
      }
      cursor = parent;
    }
    prepared.push({
      ...entry,
      target,
      existed: Boolean(targetStat),
      mode: targetStat?.mode,
      missingDirectories,
    });
  }
  return prepared;
}

async function removeCreatedDirectories(createdDirectories) {
  for (let index = createdDirectories.length - 1; index >= 0; index -= 1) {
    const directory = createdDirectories[index];
    try {
      if ((await readdir(directory)).length === 0) {
        await rmdir(directory);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') {
        throw error;
      }
    }
  }
}

async function removeArtifact(target) {
  if (target) {
    await rm(target, { force: true });
  }
}

export async function executeTransaction(entries, { fault = null } = {}) {
  const prepared = await preflight(entries);
  const transactionId = randomUUID().replaceAll('-', '');
  const createdDirectories = [];
  const touchedEntries = [];

  try {
    for (let entryIndex = 0; entryIndex < prepared.length; entryIndex += 1) {
      const entry = prepared[entryIndex];
      if (!entry.existed && entry.content === null) {
        continue;
      }
      for (let index = entry.missingDirectories.length - 1; index >= 0; index -= 1) {
        const directory = entry.missingDirectories[index];
        if (!(await directoryStatOrNull(directory))) {
          await mkdir(directory);
          createdDirectories.push(directory);
        }
      }
      if (fault?.phase === 'stage' && fault.index === entryIndex) {
        throw new Error(`Injected staging failure at index ${entryIndex}`);
      }

      const basename = path.basename(entry.target);
      const parent = path.dirname(entry.target);
      entry.stage = entry.content === null
        ? null
        : path.join(parent, `.${basename}.chinese-code-comments.${transactionId}.stage`);
      entry.backup = entry.existed
        ? path.join(parent, `.${basename}.chinese-code-comments.${transactionId}.backup`)
        : null;
      if (entry.stage) {
        await writeFile(entry.stage, entry.content, { flag: 'wx' });
        if (entry.existed && process.platform !== 'win32') {
          // 原文件权限属于用户配置的一部分，原子替换不能退回 Node 默认创建权限。
          await chmod(entry.stage, entry.mode);
        }
      }
      if (entry.backup) {
        await copyFile(entry.target, entry.backup, constants.COPYFILE_EXCL);
      }
    }

    for (let index = 0; index < prepared.length; index += 1) {
      if (fault?.phase === 'commit' && fault.index === index) {
        throw new Error(`Injected commit failure at index ${index}`);
      }
      const entry = prepared[index];
      if (!entry.existed && entry.content === null) {
        continue;
      }

      // 提交前登记触碰状态，确保删除成功但重命名失败时仍能恢复原文件。
      entry.transactionIndex = index;
      touchedEntries.push(entry);
      if (entry.existed) {
        await rm(entry.target);
      }
      if (entry.content !== null) {
        await rename(entry.stage, entry.target);
      }
    }
  } catch (transactionError) {
    const rollbackErrors = [];
    const recoveryBackups = new Set();
    for (let index = touchedEntries.length - 1; index >= 0; index -= 1) {
      const entry = touchedEntries[index];
      try {
        if (fault?.rollbackIndex === entry.transactionIndex) {
          throw new Error(`Injected rollback failure at index ${entry.transactionIndex}`);
        }
        await rm(entry.target, { force: true });
        if (entry.existed) {
          await rename(entry.backup, entry.target);
        }
      } catch (error) {
        if (entry.backup) {
          recoveryBackups.add(entry.backup);
        }
        rollbackErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    for (const entry of prepared) {
      try {
        await removeArtifact(entry.stage);
        // 自动恢复失败时保留原始备份，避免清理阶段销毁人工恢复所需的最后副本。
        if (!recoveryBackups.has(entry.backup)) {
          await removeArtifact(entry.backup);
        }
      } catch (error) {
        rollbackErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    try {
      await removeCreatedDirectories(createdDirectories);
    } catch (error) {
      rollbackErrors.push(error instanceof Error ? error.message : String(error));
    }

    if (rollbackErrors.length > 0) {
      throw new Error(
        `${transactionError.message}. Rollback also failed: ${rollbackErrors.join('; ')}`,
        { cause: transactionError },
      );
    }
    throw transactionError;
  }

  const warnings = [];
  for (let index = 0; index < prepared.length; index += 1) {
    const entry = prepared[index];
    try {
      if (fault?.phase === 'cleanup' && fault.index === index) {
        throw new Error(`Injected cleanup failure at index ${index}`);
      }
      await removeArtifact(entry.stage);
      await removeArtifact(entry.backup);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { warnings };
}
