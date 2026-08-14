import { parseJsonLines } from '../process.js';

export function buildInvocation({ prompt, cwd }) {
  return {
    command: 'grok',
    args: ['--no-auto-update', '--cwd', cwd, '-p', prompt, '--output-format', 'streaming-json', '--yolo'],
    stdin: null,
    env: {},
  };
}

export function normalizeOutput(result) {
  const records = parseJsonLines(result.stdout, 'Grok');
  const finalText = records
    .filter((record) => record.type === 'text' && typeof record.data === 'string')
    .map((record) => record.data)
    .join('')
    .trim();
  const events = records.filter((record) => record.type === 'tool_call' || record.type === 'tool_call_update');
  return { finalText, events };
}

export default {
  id: 'grok',
  aliases: ['grok-cli', 'grok-build'],
  projectRulesFile: 'AGENTS.md',
  buildInvocation,
  normalizeOutput,
};
