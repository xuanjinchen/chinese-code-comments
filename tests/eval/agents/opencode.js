import { parseJsonLines } from '../process.js';

export function buildInvocation({ prompt, cwd }) {
  return {
    command: 'opencode',
    args: ['run', '--format', 'json', '--auto', '--dir', cwd, prompt],
    stdin: null,
    env: { OPENCODE_DISABLE_AUTOUPDATE: 'true' },
  };
}

export function normalizeOutput(result) {
  const records = parseJsonLines(result.stdout, 'OpenCode');
  const messages = records
    .filter((record) => record.type === 'text' && typeof record.part?.text === 'string')
    .map((record) => record.part.text)
    .filter((text) => text.trim());
  const events = records.filter((record) => record.part?.type === 'tool' || record.type === 'tool_use' || record.type === 'tool_result');
  return { finalText: messages.at(-1)?.trim() ?? '', events };
}

export default {
  id: 'opencode',
  aliases: ['open-code'],
  projectRulesFile: 'AGENTS.md',
  buildInvocation,
  normalizeOutput,
};
