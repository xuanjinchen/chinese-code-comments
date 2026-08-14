import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ADAPTER_IDS, selectAdapters } from './adapters/index.js';
import { decodeText } from './files/text.js';

const STORAGE_GROUPS = new Set(['agents', 'claude', 'hermes']);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ADAPTER_ID_SET = new Set(ADAPTER_IDS);
const ADAPTER_ORDER = new Map(ADAPTER_IDS.map((id, index) => [id, index]));

export function statePath({ home }) {
  return path.join(home, '.chinese-code-comments', 'state.json');
}

export function emptyState() {
  return {
    schemaVersion: 2,
    installerVersion: null,
    agents: [],
    storageGroups: {},
    policies: {},
  };
}

function assertUniqueStrings(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error(`Invalid installation state ${label}`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`Invalid installation state: duplicate ${label.slice(0, -1)}`);
  }
}

function expectedStorageGroup(agent) {
  return selectAdapters([agent])[0].storageGroup;
}

function validateAgentsAndMembership(value, groups) {
  assertUniqueStrings(value.agents, 'agents');
  for (const agent of value.agents) {
    if (!ADAPTER_ID_SET.has(agent)) {
      throw new Error(`Invalid installation state: unknown agent ${agent}`);
    }
  }

  const seen = new Set();
  for (const [group, members] of Object.entries(groups)) {
    if (!STORAGE_GROUPS.has(group)) {
      throw new Error(`Invalid installation state storage group: ${group}`);
    }
    assertUniqueStrings(members, `${group} members`);
    for (const member of members) {
      if (!value.agents.includes(member) || expectedStorageGroup(member) !== group) {
        throw new Error(`Invalid installation state storage group mapping: ${group}/${member}`);
      }
      if (seen.has(member)) {
        throw new Error(`Invalid installation state: duplicate storage group member ${member}`);
      }
      seen.add(member);
    }
  }
  if (value.agents.some((agent) => !seen.has(agent))) {
    throw new Error('Invalid installation state storage group membership');
  }
}

function isAbsolute(target) {
  return path.posix.isAbsolute(target) || path.win32.isAbsolute(target);
}

function validateFileRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || typeof record.path !== 'string' || !isAbsolute(record.path)
    || typeof record.digest !== 'string' || !DIGEST_PATTERN.test(record.digest)
    || typeof record.owned !== 'boolean') {
    throw new Error('Invalid installation state file record');
  }
}

function pathIdentity(target) {
  const normalized = path.win32.isAbsolute(target)
    ? path.win32.normalize(target).toLowerCase()
    : path.posix.normalize(target);
  return normalized.replace(/[\\/]$/u, '');
}

function expectedManagedFiles(group, root) {
  const pathApi = path.win32.isAbsolute(root) ? path.win32 : path.posix;
  const destination = pathApi.join(root, 'chinese-code-comments');
  const files = [pathApi.join(destination, 'SKILL.md')];
  if (group === 'agents') files.push(pathApi.join(destination, 'agents', 'openai.yaml'));
  return files.map(pathIdentity).sort();
}

function validateV1(value) {
  if (!value.storageGroups || typeof value.storageGroups !== 'object' || Array.isArray(value.storageGroups)) {
    throw new Error('Invalid installation state storageGroups');
  }
  validateAgentsAndMembership(value, value.storageGroups);
  return value;
}

function validateV2(value) {
  if (!value.storageGroups || typeof value.storageGroups !== 'object' || Array.isArray(value.storageGroups)) {
    throw new Error('Invalid installation state storageGroups');
  }
  const memberships = {};
  const recordedPaths = new Set();
  for (const [group, record] of Object.entries(value.storageGroups)) {
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || typeof record.root !== 'string' || !isAbsolute(record.root)
      || !Array.isArray(record.files)) {
      throw new Error(`Invalid installation state storage group record: ${group}`);
    }
    memberships[group] = record.members;
    for (const file of record.files) {
      validateFileRecord(file);
      const identity = pathIdentity(file.path);
      if (recordedPaths.has(identity)) {
        throw new Error(`Invalid installation state: duplicate file record ${file.path}`);
      }
      recordedPaths.add(identity);
    }
    const actualFiles = record.files.map((file) => pathIdentity(file.path)).sort();
    const expectedFiles = expectedManagedFiles(group, record.root);
    if (actualFiles.length !== expectedFiles.length
      || actualFiles.some((file, index) => file !== expectedFiles[index])) {
      throw new Error(`Invalid installation state managed file set below recorded root: ${group}`);
    }
  }
  validateAgentsAndMembership(value, memberships);

  if (!value.policies || typeof value.policies !== 'object' || Array.isArray(value.policies)) {
    throw new Error('Invalid installation state policies');
  }
  for (const [agent, record] of Object.entries(value.policies)) {
    if (!value.agents.includes(agent)) {
      throw new Error(`Invalid installation state policy reference: ${agent}`);
    }
    validateFileRecord(record);
    const identity = pathIdentity(record.path);
    if (recordedPaths.has(identity)) {
      throw new Error(`Invalid installation state: duplicate file record ${record.path}`);
    }
    recordedPaths.add(identity);
  }
  if (value.agents.some((agent) => !(agent in value.policies))) {
    throw new Error('Invalid installation state policy membership');
  }
  return value;
}

function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Installation state must be an object');
  }
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    throw new Error(`Unsupported installation state schema: ${value.schemaVersion}`);
  }
  if (typeof value.installerVersion !== 'string' || value.installerVersion.length === 0) {
    throw new Error('Invalid installation state installerVersion');
  }
  return value.schemaVersion === 1 ? validateV1(value) : validateV2(value);
}

export async function readState(context) {
  const target = statePath(context);
  let bytes;
  try {
    bytes = await readFile(target);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return emptyState();
    }
    throw error;
  }

  const { text } = decodeText(bytes, target);
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Installation state must contain valid JSON: ${target}`, { cause: error });
  }
  return validateState(value);
}

export function serializeState(state) {
  const sortAdapters = (left, right) => ADAPTER_ORDER.get(left) - ADAPTER_ORDER.get(right);
  const storageGroups = {};
  for (const group of Object.keys(state.storageGroups).sort()) {
    const record = state.storageGroups[group];
    storageGroups[group] = {
      members: [...record.members].sort(sortAdapters),
      root: record.root,
      files: [...record.files]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((file) => ({ path: file.path, digest: file.digest, owned: file.owned })),
    };
  }
  const policies = {};
  for (const agent of Object.keys(state.policies ?? {}).sort(sortAdapters)) {
    const record = state.policies[agent];
    policies[agent] = { path: record.path, digest: record.digest, owned: record.owned };
  }
  const normalized = {
    schemaVersion: 2,
    installerVersion: state.installerVersion,
    agents: [...state.agents].sort(sortAdapters),
    storageGroups,
    policies,
  };
  return Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
}
