import { readFile, rmdir } from 'node:fs/promises';
import path from 'node:path';

import { selectAdapters } from './adapters/index.js';
import { removeManagedBlock } from './files/managed-block.js';
import { decodeText, encodeText } from './files/text.js';
import { emptyState, readState, serializeState, statePath } from './state.js';
import { executeTransaction } from './transaction.js';

async function readOptionalText(target) {
  try {
    const bytes = await readFile(target);
    return decodeText(bytes, target);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return null;
    }
    throw error;
  }
}

function storageGroupsFor(agentIds, context) {
  const groups = {};
  for (const adapter of selectAdapters(agentIds, context)) {
    groups[adapter.storageGroup] ??= [];
    groups[adapter.storageGroup].push(adapter.id);
  }
  return groups;
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

export async function uninstall({ agents, context, fault = null }) {
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
  const remainingAgents = currentState.agents.filter((id) => !selectedIds.has(id));
  const remainingGroups = storageGroupsFor(remainingAgents, context);
  const entries = [];

  for (const adapter of [...selected].sort((left, right) => left.id.localeCompare(right.id))) {
    const target = adapter.policyFile(context);
    const current = await readOptionalText(target);
    if (!current) continue;
    const removed = removeManagedBlock(current.text, adapter.markers);
    if (!removed.removed) continue;
    entries.push({
      target,
      content: removed.text.length === 0 ? null : encodeText(removed.text, current),
      kind: `policy:${adapter.id}`,
    });
  }

  const selectedGroups = new Map();
  for (const adapter of selected) {
    selectedGroups.set(adapter.storageGroup, adapter.skillRoot(context));
  }
  for (const [group, root] of selectedGroups) {
    const managedMembers = currentState.storageGroups[group] ?? [];
    const selectedGroupWasManaged = managedMembers.some((id) => selectedIds.has(id));
    const removeGroup = agents === null
      || (stateKnown && selectedGroupWasManaged && !(group in remainingGroups));
    if (!removeGroup) continue;
    const destination = path.join(root, 'chinese-code-comments');
    entries.push({ target: path.join(destination, 'SKILL.md'), content: null, kind: `skill:${group}` });
    if (group === 'agents') {
      entries.push({
        target: path.join(destination, 'agents', 'openai.yaml'),
        content: null,
        kind: 'metadata:codex',
      });
    }
  }

  if (stateKnown || agents === null) {
    entries.push({
      target: statePath(context),
      content: remainingAgents.length === 0
        ? null
        : serializeState({
          schemaVersion: 1,
          installerVersion: currentState.installerVersion,
          agents: remainingAgents,
          storageGroups: remainingGroups,
        }),
      kind: 'state',
    });
  }

  const transaction = await executeTransaction(entries, { fault });
  const managedRoots = selected.map((adapter) => path.dirname(adapter.policyFile(context)));
  const pruneWarnings = await pruneEmptyParents(
    entries.map((entry) => entry.target),
    context.home,
    managedRoots,
  );
  return {
    agents: selected.map((adapter) => adapter.id),
    warnings: [stateWarning, ...transaction.warnings, ...pruneWarnings].filter(Boolean),
  };
}
