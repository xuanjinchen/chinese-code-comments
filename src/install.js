import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { selectAdapters } from './adapters/index.js';
import { decodeText, encodeText, newTextMetadata } from './files/text.js';
import { removeManagedBlock, upsertManagedBlock } from './files/managed-block.js';
import { withInstallerLock } from './installer-lock.js';
import { renderPolicy } from './policies/render.js';
import { readState, serializeState, statePath } from './state.js';
import { executeTransaction } from './transaction.js';

const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function samePath(left, right) {
  const normalize = (value) => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

async function readManagedSource(target) {
  const bytes = await readFile(target);
  const decoded = decodeText(bytes, target);
  if (decoded.bom) {
    throw new Error(`Managed source must use UTF-8 without BOM: ${target}`);
  }
  return { bytes, text: decoded.text };
}

async function readOptionalPolicy(target) {
  try {
    const bytes = await readFile(target);
    const decoded = decodeText(bytes, target);
    return { ...decoded, bytes, exists: true };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ...newTextMetadata(), bytes: null, text: '', exists: false };
    }
    if (error?.code === 'ENOTDIR') {
      throw new Error(`Path ancestor must be a directory: ${path.dirname(target)}`, { cause: error });
    }
    throw error;
  }
}

async function readOptionalManagedFile(target) {
  try {
    const bytes = await readFile(target);
    decodeText(bytes, target);
    return bytes;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error?.code === 'ENOTDIR') {
      throw new Error(`Path ancestor must be a directory: ${path.dirname(target)}`, { cause: error });
    }
    throw error;
  }
}

async function legacyCodexOwnsSharedSkill(context) {
  const codex = selectAdapters(['codex'], context)[0];
  const policy = await readOptionalPolicy(codex.policyFile(context));
  if (!policy.exists) return false;
  return removeManagedBlock(policy.text, codex.markers).removed;
}

async function selectedPoliciesProveOwnership(selected, group, context) {
  for (const adapter of selected) {
    if (adapter.storageGroup !== group) continue;
    const policy = await readOptionalPolicy(adapter.policyFile(context));
    if (policy.exists && removeManagedBlock(policy.text, adapter.markers).removed) {
      return true;
    }
  }
  return false;
}

function matchingFileRecord(state, target) {
  if (state.schemaVersion !== 2) return null;
  for (const group of Object.values(state.storageGroups)) {
    const record = group.files.find((file) => samePath(file.path, target));
    if (record) return record;
  }
  return Object.values(state.policies).find((record) => samePath(record.path, target)) ?? null;
}

async function managedFileOwnership(target, expected, stateRecord, legacyOwned) {
  const existing = await readOptionalManagedFile(target);
  if (existing === null) return true;
  if (stateRecord?.owned || legacyOwned) return true;
  if (existing.equals(expected)) return stateRecord?.owned ?? false;
  throw new Error(`Managed target exists but is not owned by this installer: ${target}`);
}

function mergeInstalledAgents(existingIds, selectedIds) {
  const wanted = new Set([...existingIds, ...selectedIds]);
  return selectAdapters(null).map((adapter) => adapter.id).filter((id) => wanted.has(id));
}

function adaptersByStorageGroup(agentIds, context) {
  const groups = {};
  for (const adapter of selectAdapters(agentIds, context)) {
    groups[adapter.storageGroup] ??= [];
    groups[adapter.storageGroup].push(adapter);
  }
  return groups;
}

function inferPolicyOwnership(current, adapter) {
  if (!current.exists) return true;
  const removed = removeManagedBlock(current.text, adapter.markers);
  return removed.removed && removed.text.length === 0;
}

async function migrateGroupRecord(group, members, context, skillSource, metadataSource) {
  const root = members[0].skillRoot(context);
  const destination = path.join(root, 'chinese-code-comments');
  const definitions = [
    [path.join(destination, 'SKILL.md'), skillSource.bytes],
  ];
  if (group === 'agents') {
    definitions.push([path.join(destination, 'agents', 'openai.yaml'), metadataSource.bytes]);
  }
  let ownershipProved = await selectedPoliciesProveOwnership(members, group, context);
  if (!ownershipProved && group === 'agents') {
    ownershipProved = await legacyCodexOwnsSharedSkill(context);
  }
  const files = [];
  for (const [target, fallback] of definitions) {
    const existing = await readOptionalManagedFile(target);
    files.push({
      path: target,
      digest: digest(existing ?? fallback),
      owned: existing !== null && ownershipProved,
    });
  }
  return { members: members.map((adapter) => adapter.id), root, files };
}

async function installUnlocked({ agents, context, sourceRoot, fault }) {
  const selected = selectAdapters(agents, context);
  const selectedIds = new Set(selected.map((adapter) => adapter.id));
  const skillSource = await readManagedSource(path.join(sourceRoot, 'SKILL.md'));
  const metadataSource = await readManagedSource(path.join(sourceRoot, 'agents', 'openai.yaml'));
  const policyTemplate = await readManagedSource(path.join(sourceRoot, 'resources', 'global-policy.md'));
  const packageSource = await readManagedSource(path.join(sourceRoot, 'package.json'));
  const packageMetadata = JSON.parse(packageSource.text);
  const currentState = await readState(context);
  const installedAgents = mergeInstalledAgents(currentState.agents, [...selectedIds]);
  const groupedAdapters = adaptersByStorageGroup(installedAgents, context);
  const selectedGroups = new Map();
  for (const adapter of selected) {
    selectedGroups.set(adapter.storageGroup, adapter.skillRoot(context));
  }

  const entries = [];
  const storageGroups = {};
  let legacySharedOwnership;
  for (const [group, members] of Object.entries(groupedAdapters).sort(([left], [right]) => left.localeCompare(right))) {
    const selectedInGroup = members.some((adapter) => selectedIds.has(adapter.id));
    if (!selectedInGroup) {
      storageGroups[group] = currentState.schemaVersion === 2
        ? currentState.storageGroups[group]
        : await migrateGroupRecord(group, members, context, skillSource, metadataSource);
      continue;
    }

    const root = members[0].skillRoot(context);
    const previousGroup = currentState.schemaVersion === 2
      ? currentState.storageGroups[group]
      : null;
    if (previousGroup && !samePath(previousGroup.root, root)) {
      throw new Error(`Managed target root is not owned by this installer: ${root}`);
    }
    const destination = path.join(root, 'chinese-code-comments');
    const definitions = [
      [path.join(destination, 'SKILL.md'), skillSource.bytes, `skill:${group}`],
    ];
    if (group === 'agents') {
      definitions.push([
        path.join(destination, 'agents', 'openai.yaml'),
        metadataSource.bytes,
        'metadata:codex',
      ]);
    }

    let legacyPolicyOwnsGroup = await selectedPoliciesProveOwnership(selected, group, context);
    if (!legacyPolicyOwnsGroup && group === 'agents') {
      legacySharedOwnership ??= await legacyCodexOwnsSharedSkill(context);
      legacyPolicyOwnsGroup = legacySharedOwnership;
    }

    const files = [];
    for (const [target, content, kind] of definitions) {
      const stateRecord = matchingFileRecord(currentState, target);
      const owned = await managedFileOwnership(
        target,
        content,
        stateRecord,
        legacyPolicyOwnsGroup,
      );
      entries.push({ target, content, kind });
      files.push({ path: target, digest: digest(content), owned });
    }
    storageGroups[group] = {
      members: members.map((adapter) => adapter.id),
      root,
      files,
    };
  }

  const policies = {};
  for (const adapter of selectAdapters(installedAgents, context)) {
    if (!selectedIds.has(adapter.id)) {
      if (currentState.schemaVersion === 2) {
        policies[adapter.id] = currentState.policies[adapter.id];
      } else {
        const target = adapter.policyFile(context);
        const current = await readOptionalPolicy(target);
        const fallback = encodeText(
          upsertManagedBlock('', renderPolicy(adapter, policyTemplate.text, current.eol), adapter.markers),
          current,
        );
        policies[adapter.id] = {
          path: target,
          digest: digest(current.bytes ?? fallback),
          owned: current.exists && inferPolicyOwnership(current, adapter),
        };
      }
      continue;
    }

    const target = adapter.policyFile(context);
    const previous = currentState.schemaVersion === 2 ? currentState.policies[adapter.id] : null;
    if (previous && !samePath(previous.path, target)) {
      throw new Error(`Managed policy target is not owned by this installer: ${target}`);
    }
    const current = await readOptionalPolicy(target);
    const block = renderPolicy(adapter, policyTemplate.text, current.eol);
    const next = upsertManagedBlock(current.text, block, adapter.markers);
    const content = encodeText(next, current);
    let owned = previous?.owned ?? inferPolicyOwnership(current, adapter);
    if (previous?.owned && current.bytes && digest(current.bytes) !== previous.digest) {
      const unmanaged = removeManagedBlock(current.text, adapter.markers);
      if (unmanaged.removed && unmanaged.text.length > 0) owned = false;
    }
    entries.push({ target, content, kind: `policy:${adapter.id}` });
    policies[adapter.id] = { path: target, digest: digest(content), owned };
  }

  // 状态最后提交，确保只有全部 Skill 与规则文件成功后才对外声明安装完成。
  entries.push({
    target: statePath(context),
    content: serializeState({
      schemaVersion: 2,
      installerVersion: packageMetadata.version,
      agents: installedAgents,
      storageGroups,
      policies,
    }),
    kind: 'state',
  });

  const transaction = await executeTransaction(entries, { fault });
  return {
    agents: selected.map((adapter) => adapter.id),
    storageGroups: [...selectedGroups.keys()].sort(),
    policies: selected.map((adapter) => adapter.policyFile(context)),
    warnings: transaction.warnings,
  };
}

export async function install({
  agents,
  context,
  sourceRoot = DEFAULT_SOURCE_ROOT,
  fault = null,
}) {
  return withInstallerLock(context, () => installUnlocked({
    agents,
    context,
    sourceRoot,
    fault,
  }));
}
