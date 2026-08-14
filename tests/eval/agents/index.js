import claude from './claude.js';
import codex from './codex.js';
import gemini from './gemini.js';
import grok from './grok.js';
import hermes from './hermes.js';
import opencode from './opencode.js';

const runners = Object.freeze([codex, claude, gemini, grok, opencode, hermes]);
const byName = new Map();
for (const runner of runners) {
  byName.set(runner.id, runner);
  for (const alias of runner.aliases) byName.set(alias, runner);
}

export const RUNNER_IDS = Object.freeze(runners.map((runner) => runner.id));

export function selectRunner(value) {
  const name = String(value ?? '').trim().toLowerCase();
  const runner = byName.get(name);
  if (!runner) throw new Error(`Unknown eval agent: ${name || '(empty)'}`);
  return runner;
}
