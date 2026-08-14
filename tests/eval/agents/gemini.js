import { parseJsonLines } from '../process.js';

export function buildInvocation({ prompt }) {
  return {
    command: 'gemini',
    args: ['-p', prompt, '--output-format', 'stream-json', '--approval-mode', 'yolo'],
    stdin: null,
    env: {},
  };
}

export function normalizeOutput(result) {
  const records = parseJsonLines(result.stdout, 'Gemini');
  const finalText = records
    .filter((record) => record.type === 'message' && record.role === 'assistant')
    .map((record) => typeof record.content === 'string' ? record.content : record.message?.content ?? '')
    .join('')
    .trim();
  const events = records.filter((record) => record.type === 'tool_use' || record.type === 'tool_result');
  return { finalText, events };
}

export default {
  id: 'gemini',
  toolTrace: 'available',
  aliases: ['gemini-cli'],
  projectRulesFile: 'GEMINI.md',
  buildInvocation,
  normalizeOutput,
};
