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

export function selectAdapters(ids, _context) {
  if (ids == null) {
    return [...adapters];
  }
  if (!Array.isArray(ids)) {
    throw new TypeError('Agent ids must be an array or null');
  }

  const selected = [];
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
  return selected;
}
