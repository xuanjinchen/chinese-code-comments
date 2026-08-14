import { createHash } from 'node:crypto';
import { readFile, rmdir } from 'node:fs/promises';
import path from 'node:path';

import { selectAdapters } from './adapters/index.js';
import { removeManagedBlock } from './files/managed-block.js';
import { decodeText, encodeText } from './files/text.js';
import { withInstallerLock } from './installer-lock.js';
import { emptyState, readState, serializeState, statePath } from './state.js';
import { executeTransaction } from './transaction.js';

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function samePath(left, right) {
  const normalize = (value) => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

async function readOptionalBytes(target) {
  try {
    return await readFile(target);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

function containsPath(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function pruneEmptyParents(targets, home, managedRoots) {
  const warnings = [];
  const candidates = new Set();
  for (const target of targets) {
    const boundary = containsPath(home, target)
      ? home
      : managedRoots
        .filter((root) => containsPath(root, target))
        .sort((left, right) => right.length - left.length)
        .map((root) => path.dirname(root))[0];
    if (!boundary) continue;

    let directory = path.dirname(target);
    while (directory !== boundary) {
      if (!containsPath(boundary, directory)) break;
      candidates.add(directory);
      directory = path.dirname(directory);
    }
  }
  // 全部文件提交后按深度删除，避免父目录第一次非空就阻断后续清理。
  const deepestFirst = [...candidates].sort((left, right) => right.length - left.length);
  for (const directory of deepestFirst) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY' && error?.code !== 'EEXIST') {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  return warnings;
}

function remainingV2State(currentState, selectedIds) {
  const agents = currentState.agents.filter((id) => !selectedIds.has(id));
  const storageGroups = {};
  for (const [group, record] of Object.entries(currentState.storageGroups)) {
    const members = record.members.filter((id) => !selectedIds.has(id));
    if (members.length > 0) storageGroups[group] = { ...record, members };
  }
  const policies = {};
  for (const [agent, record] of Object.entries(currentState.policies)) {
    if (!selectedIds.has(agent)) policies[agent] = record;
  }
  return { agents, storageGroups, policies };
}

async function addOwnedFileRemoval(record, kind, entries, warnings) {
  const current = await readOptionalBytes(record.path);
  if (current === null) return;
  if (!record.owned) {
    warnings.push(`Preserved externally owned file during uninstall: ${record.path}`);
    return;
  }
  if (digest(current) !== record.digest) {
    warnings.push(`Preserved modified file with content drift during uninstall: ${record.path}`);
    return;
  }
  entries.push({ target: record.path, content: null, kind });
}

async function addPolicyRemoval(adapter, record, entries, warnings) {
  const target = record?.path ?? adapter.policyFile;
  const currentBytes = await readOptionalBytes(target);
  if (currentBytes === null) return;
  if (record && digest(currentBytes) !== record.digest) {
    warnings.push(`Preserved modified policy with content drift during uninstall: ${target}`);
    return;
  }

  let current;
  try {
    current = decodeText(currentBytes, target);
  } catch (error) {
    warnings.push(`Preserved unreadable policy during uninstall: ${target}: ${error.message}`);
    return;
  }
  const removed = removeManagedBlock(current.text, adapter.markers);
  if (!removed.removed) return;
  const removeFile = removed.text.length === 0 && record?.owned !== false;
  entries.push({
    target,
    content: removeFile ? null : encodeText(removed.text, current),
    kind: `policy:${adapter.id}`,
  });
}

async function warnForUntrackedFiles(selected, context, warnings) {
  const checkedGroups = new Set();
  for (const adapter of selected) {
    if (!checkedGroups.has(adapter.storageGroup)) {
      checkedGroups.add(adapter.storageGroup);
      const destination = path.join(adapter.skillRoot(context), 'chinese-code-comments');
      const skillTarget = path.join(destination, 'SKILL.md');
      if (await readOptionalBytes(skillTarget)) {
        warnings.push(`Preserved Skill without ownership state during uninstall: ${skillTarget}`);
      }
      if (adapter.storageGroup === 'agents') {
        const metadataTarget = path.join(destination, 'agents', 'openai.yaml');
        if (await readOptionalBytes(metadataTarget)) {
          warnings.push(`Preserved metadata without ownership state during uninstall: ${metadataTarget}`);
        }
      }
    }
    const policyTarget = adapter.policyFile(context);
    if (await readOptionalBytes(policyTarget)) {
      warnings.push(`Preserved policy without ownership state during uninstall: ${policyTarget}`);
    }
  }
}

async function uninstallUnlocked({ agents, context, fault }) {
  const selected = selectAdapters(agents, context);
  const selectedIds = new Set(selected.map((adapter) => adapter.id));
  let currentState;
  let stateWarning = null;
  try {
    currentState = await readState(context);
  } catch (error) {
    currentState = emptyState();
    stateWarning = `Ignored invalid installation state during uninstall: ${error.message}`;
  }
  const stateKnown = stateWarning === null && currentState.installerVersion !== null;
  const entries = [];
  const warnings = [stateWarning].filter(Boolean);

  for (const adapter of selected) {
    if (currentState.schemaVersion !== 2 || !stateKnown
      || !currentState.agents.includes(adapter.id)) continue;
    const policyRecord = currentState.policies[adapter.id];
    if (!samePath(policyRecord.path, adapter.policyFile(context))) {
      warnings.push(`Configured policy path changed since installation: ${adapter.id}`);
    }
    await addPolicyRemoval(adapter, policyRecord, entries, warnings);
  }

  const managedRoots = [];
  if (currentState.schemaVersion === 2 && stateKnown) {
    for (const [group, record] of Object.entries(currentState.storageGroups)) {
      const selectedMembers = record.members.filter((id) => selectedIds.has(id));
      const remainingMembers = record.members.filter((id) => !selectedIds.has(id));
      if (selectedMembers.length === 0 || remainingMembers.length > 0) continue;
      const selectedAdapter = selected.find((adapter) => adapter.storageGroup === group);
      if (selectedAdapter && !samePath(record.root, selectedAdapter.skillRoot(context))) {
        warnings.push(`Configured Skill root changed since installation: ${group}`);
      }
      managedRoots.push(path.dirname(record.root));
      for (const file of record.files) {
        await addOwnedFileRemoval(file, `skill:${group}`, entries, warnings);
      }
    }
  } else {
    if (stateKnown && currentState.schemaVersion === 1) {
      warnings.push('Preserved schema v1 installation because ownership cannot be verified; run install to migrate');
    }
    await warnForUntrackedFiles(selected, context, warnings);
  }

  if (stateKnown && currentState.schemaVersion === 2) {
    const remaining = remainingV2State(currentState, selectedIds);
    entries.push({
      target: statePath(context),
      content: remaining.agents.length === 0
        ? null
        : serializeState({
          schemaVersion: 2,
          installerVersion: currentState.installerVersion,
          agents: remaining.agents,
          storageGroups: remaining.storageGroups,
          policies: remaining.policies,
        }),
      kind: 'state',
    });
  }

  const transaction = await executeTransaction(entries, { fault });
  managedRoots.push(
    ...entries
      .filter((entry) => entry.kind.startsWith('policy:'))
      .map((entry) => path.dirname(entry.target)),
  );
  const pruneWarnings = await pruneEmptyParents(
    entries.map((entry) => entry.target),
    context.home,
    managedRoots,
  );
  return {
    agents: selected.map((adapter) => adapter.id),
    warnings: [...warnings, ...transaction.warnings, ...pruneWarnings],
  };
}

export async function uninstall({ agents, context, fault = null }) {
  return withInstallerLock(context, () => uninstallUnlocked({ agents, context, fault }));
}
