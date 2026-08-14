import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { decodeText } from './files/text.js';

const STORAGE_GROUPS = new Set(['agents', 'claude', 'hermes']);

export function statePath({ home }) {
  return path.join(home, '.chinese-code-comments', 'state.json');
}

export function emptyState() {
  return {
    schemaVersion: 1,
    installerVersion: null,
    agents: [],
    storageGroups: {},
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

function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Installation state must be an object');
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported installation state schema: ${value.schemaVersion}`);
  }
  if (typeof value.installerVersion !== 'string' || value.installerVersion.length === 0) {
    throw new Error('Invalid installation state installerVersion');
  }
  assertUniqueStrings(value.agents, 'agents');
  if (!value.storageGroups || typeof value.storageGroups !== 'object' || Array.isArray(value.storageGroups)) {
    throw new Error('Invalid installation state storageGroups');
  }
  for (const [group, members] of Object.entries(value.storageGroups)) {
    if (!STORAGE_GROUPS.has(group)) {
      throw new Error(`Invalid installation state storage group: ${group}`);
    }
    assertUniqueStrings(members, `${group} members`);
    if (members.some((member) => !value.agents.includes(member))) {
      throw new Error(`Invalid installation state ${group} reference`);
    }
  }
  return value;
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
  const storageGroups = {};
  for (const group of Object.keys(state.storageGroups).sort()) {
    storageGroups[group] = [...state.storageGroups[group]].sort();
  }
  const normalized = {
    schemaVersion: 1,
    installerVersion: state.installerVersion,
    agents: [...state.agents].sort(),
    storageGroups,
  };
  return Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
}
