import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { selectAdapters } from './adapters/index.js';
import { decodeText, encodeText, newTextMetadata } from './files/text.js';
import { removeManagedBlock, upsertManagedBlock } from './files/managed-block.js';
import { renderPolicy } from './policies/render.js';
import { readState, serializeState, statePath } from './state.js';
import { executeTransaction } from './transaction.js';

const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

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
    return { ...decoded, exists: true };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ...newTextMetadata(), text: '', exists: false };
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

async function assertManagedDestination(target, expected, owned) {
  const existing = await readOptionalManagedFile(target);
  if (!existing || existing.equals(expected) || owned) return;
  throw new Error(`Managed target exists but is not owned by this installer: ${target}`);
}

function mergeInstalledAgents(existingIds, selectedIds) {
  const wanted = new Set([...existingIds, ...selectedIds]);
  return selectAdapters(null).map((adapter) => adapter.id).filter((id) => wanted.has(id));
}

function buildStorageGroups(agentIds, context) {
  const groups = {};
  for (const adapter of selectAdapters(agentIds, context)) {
    groups[adapter.storageGroup] ??= [];
    groups[adapter.storageGroup].push(adapter.id);
  }
  return groups;
}

export async function install({
  agents,
  context,
  sourceRoot = DEFAULT_SOURCE_ROOT,
  fault = null,
}) {
  const selected = selectAdapters(agents, context);
  const skillSource = await readManagedSource(path.join(sourceRoot, 'SKILL.md'));
  const metadataSource = await readManagedSource(path.join(sourceRoot, 'agents', 'openai.yaml'));
  const policyTemplate = await readManagedSource(path.join(sourceRoot, 'resources', 'global-policy.md'));
  const packageSource = await readManagedSource(path.join(sourceRoot, 'package.json'));
  const packageMetadata = JSON.parse(packageSource.text);
  const currentState = await readState(context);
  const installedAgents = mergeInstalledAgents(
    currentState.agents,
    selected.map((adapter) => adapter.id),
  );
  const storageGroups = buildStorageGroups(installedAgents, context);

  const entries = [];
  const selectedGroups = new Map();
  for (const adapter of selected) {
    selectedGroups.set(adapter.storageGroup, adapter.skillRoot(context));
  }
  let legacySharedOwnership;
  for (const [group, root] of [...selectedGroups].sort(([left], [right]) => left.localeCompare(right))) {
    const destination = path.join(root, 'chinese-code-comments');
    const stateOwnsGroup = (currentState.storageGroups[group] ?? []).length > 0;
    let owned = stateOwnsGroup && (group === 'agents'
      || await selectedPoliciesProveOwnership(selected, group, context));
    if (!owned && group === 'agents') {
      legacySharedOwnership ??= await legacyCodexOwnsSharedSkill(context);
      owned = legacySharedOwnership;
    }
    const skillTarget = path.join(destination, 'SKILL.md');
    await assertManagedDestination(skillTarget, skillSource.bytes, owned);
    entries.push({
      target: skillTarget,
      content: skillSource.bytes,
      kind: `skill:${group}`,
    });
    if (group === 'agents') {
      const metadataTarget = path.join(destination, 'agents', 'openai.yaml');
      await assertManagedDestination(metadataTarget, metadataSource.bytes, owned);
      entries.push({
        target: metadataTarget,
        content: metadataSource.bytes,
        kind: 'metadata:codex',
      });
    }
  }

  for (const adapter of [...selected].sort((left, right) => left.id.localeCompare(right.id))) {
    const target = adapter.policyFile(context);
    const current = await readOptionalPolicy(target);
    const block = renderPolicy(adapter, policyTemplate.text, current.eol);
    const next = upsertManagedBlock(current.text, block, adapter.markers);
    entries.push({ target, content: encodeText(next, current), kind: `policy:${adapter.id}` });
  }

  // 状态最后提交，只有全部 Skill 与规则文件成功后才对外声明安装完成。
  entries.push({
    target: statePath(context),
    content: serializeState({
      schemaVersion: 1,
      installerVersion: packageMetadata.version,
      agents: installedAgents,
      storageGroups,
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
