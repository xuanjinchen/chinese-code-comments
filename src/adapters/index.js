import path from 'node:path';

import claude from './claude.js';
import codex from './codex.js';
import gemini from './gemini.js';
import grok from './grok.js';
import hermes from './hermes.js';
import opencode from './opencode.js';

const adapters = Object.freeze([codex, claude, gemini, grok, opencode, hermes]);

export const ADAPTER_IDS = Object.freeze(adapters.map((adapter) => adapter.id));

const adaptersByName = new Map();
for (const adapter of adapters) {
  adaptersByName.set(adapter.id, adapter);
  for (const alias of adapter.aliases) {
    adaptersByName.set(alias, adapter);
  }
}

function assertAbsoluteManagedPaths(selected, context) {
  if (!context) return;
  const pathApi = context.platform === 'win32' ? path.win32 : path.posix;
  for (const adapter of selected) {
    for (const [kind, target] of [
      ['Skill root', adapter.skillRoot(context)],
      ['policy path', adapter.policyFile(context)],
    ]) {
      if (!pathApi.isAbsolute(target)) {
        throw new Error(`${adapter.id} ${kind} must be absolute: ${target}`);
      }
    }
  }
}

export function selectAdapters(ids, context) {
  let selected;
  if (ids == null) {
    selected = [...adapters];
  } else {
    if (!Array.isArray(ids)) {
      throw new TypeError('Agent ids must be an array or null');
    }

    selected = [];
    const seen = new Set();
    for (const value of ids) {
      const name = String(value).trim().toLowerCase();
      const adapter = adaptersByName.get(name);
      if (!adapter) {
        throw new Error(`Unknown agent: ${name}`);
      }
      if (!seen.has(adapter.id)) {
        selected.push(adapter);
        seen.add(adapter.id);
      }
    }
  }

  // 状态格式只接受绝对路径，必须在任何文件写入前拒绝无效的环境变量根目录。
  assertAbsoluteManagedPaths(selected, context);
  return selected;
}
