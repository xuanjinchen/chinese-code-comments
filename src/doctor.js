import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { selectAdapters } from './adapters/index.js';
import { removeManagedBlock, upsertManagedBlock } from './files/managed-block.js';
import { decodeText } from './files/text.js';
import { withInstallerLock } from './installer-lock.js';
import { renderPolicy } from './policies/render.js';
import { readState } from './state.js';

const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function readFileOrNull(target) {
  try {
    return await readFile(target);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function executableExists(command, context) {
  const searchPath = context.env.PATH ?? '';
  if (!searchPath) return false;
  const extensions = context.platform === 'win32'
    ? (context.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      try {
        await access(path.join(directory, command + extension), constants.X_OK);
        return true;
      } catch {
        // 继续查找 PATH 中的其他候选，CLI 缺失只影响诊断消息，不影响安装健康度。
      }
    }
  }
  return false;
}

function addCheck(checks, agent, subject, status, target, message) {
  checks.push({ agent, subject, status, path: target, message });
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function samePath(left, right) {
  const normalize = (value) => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

async function v2StateIsCurrent(state, adapter, context) {
  const group = state.storageGroups[adapter.storageGroup];
  const policy = state.policies[adapter.id];
  if (!group || !policy
    || !samePath(group.root, adapter.skillRoot(context))
    || !samePath(policy.path, adapter.policyFile(context))) {
    return false;
  }
  for (const record of [...group.files, policy]) {
    const current = await readFileOrNull(record.path);
    if (!current || digest(current) !== record.digest) return false;
  }
  return true;
}

async function doctorUnlocked({ agents, context, sourceRoot }) {
  const selected = selectAdapters(agents, context);
  const checks = [];
  const expectedSkill = await readFile(path.join(sourceRoot, 'SKILL.md'));
  const expectedMetadata = await readFile(path.join(sourceRoot, 'agents', 'openai.yaml'));
  const template = decodeText(
    await readFile(path.join(sourceRoot, 'resources', 'global-policy.md')),
    'global policy template',
  ).text;
  const packageMetadata = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'));

  let state;
  let stateError;
  try {
    state = await readState(context);
  } catch (error) {
    stateError = error;
  }

  for (const adapter of selected) {
    const skillTarget = path.join(adapter.skillRoot(context), 'chinese-code-comments', 'SKILL.md');
    const skill = await readFileOrNull(skillTarget);
    if (!skill) addCheck(checks, adapter.id, 'skill', 'missing', skillTarget, 'Skill file is missing');
    else if (!skill.equals(expectedSkill)) addCheck(checks, adapter.id, 'skill', 'drift', skillTarget, 'Skill content differs from this package');
    else addCheck(checks, adapter.id, 'skill', 'ok', skillTarget, 'Skill content is current');

    if (adapter.id === 'codex') {
      const metadataTarget = path.join(adapter.skillRoot(context), 'chinese-code-comments', 'agents', 'openai.yaml');
      const metadata = await readFileOrNull(metadataTarget);
      if (!metadata) addCheck(checks, adapter.id, 'metadata', 'missing', metadataTarget, 'Codex metadata is missing');
      else if (!metadata.equals(expectedMetadata)) addCheck(checks, adapter.id, 'metadata', 'drift', metadataTarget, 'Codex metadata differs from this package');
      else addCheck(checks, adapter.id, 'metadata', 'ok', metadataTarget, 'Codex metadata is current');
    }

    const policyTarget = adapter.policyFile(context);
    const policyBytes = await readFileOrNull(policyTarget);
    let policyManaged = false;
    if (!policyBytes) {
      addCheck(checks, adapter.id, 'policy', 'missing', policyTarget, 'Global policy is missing');
    } else {
      try {
        const policy = decodeText(policyBytes, policyTarget);
        policyManaged = removeManagedBlock(policy.text, adapter.markers).removed;
        const expectedBlock = renderPolicy(adapter, template, policy.eol);
        const rendered = upsertManagedBlock(policy.text, expectedBlock, adapter.markers);
        if (rendered === policy.text) addCheck(checks, adapter.id, 'policy', 'ok', policyTarget, 'Global policy is current');
        else addCheck(checks, adapter.id, 'policy', 'drift', policyTarget, 'Global policy block differs from this package');
      } catch (error) {
        addCheck(checks, adapter.id, 'policy', 'invalid', policyTarget, error.message);
      }
    }

    if (stateError) {
      addCheck(checks, adapter.id, 'state', 'invalid', '', stateError.message);
    } else {
      const legacyPowerShellLayout = adapter.id === 'codex'
        && state.installerVersion === null
        && Boolean(skill)
        && policyManaged;
      const groupRecord = state.storageGroups[adapter.storageGroup];
      const members = state.schemaVersion === 2
        ? groupRecord?.members ?? []
        : groupRecord ?? [];
      const externalFiles = state.schemaVersion === 2
        ? groupRecord?.files.filter((file) => !file.owned) ?? []
        : [];
      const stateFilesCurrent = state.schemaVersion === 2 && state.installerVersion !== null
        ? await v2StateIsCurrent(state, adapter, context)
        : true;
      const valid = state.installerVersion === packageMetadata.version
        && state.schemaVersion === 2
        && state.agents.includes(adapter.id)
        && members.includes(adapter.id)
        && stateFilesCurrent
        && externalFiles.length === 0;
      addCheck(
        checks,
        adapter.id,
        'state',
        valid ? 'ok' : 'drift',
        '',
        valid
          ? 'Installation state is consistent'
          : externalFiles.length > 0
            ? 'Installation state references external file ownership'
            : !stateFilesCurrent
              ? 'Installation state paths or content digests have drifted'
            : state.schemaVersion === 1
              ? 'Installation state uses schema v1; run install to migrate'
            : legacyPowerShellLayout
            ? 'Legacy PowerShell installation detected; run install --agent codex to migrate'
            : 'Installation state does not reference this adapter',
      );
    }

    const cliFound = await executableExists(adapter.id, context);
    addCheck(
      checks,
      adapter.id,
      'cli',
      'ok',
      '',
      cliFound ? 'Agent CLI found on PATH' : 'Agent CLI not found on PATH; files remain valid',
    );
  }

  return {
    healthy: checks.every((check) => check.status === 'ok'),
    checks,
  };
}

export async function doctor({ agents, context, sourceRoot = DEFAULT_SOURCE_ROOT }) {
  return withInstallerLock(context, () => doctorUnlocked({ agents, context, sourceRoot }));
}
