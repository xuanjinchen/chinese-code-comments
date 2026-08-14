import { fileURLToPath } from 'node:url';
import { parseJsonLines } from '../process.js';

const outputSchema = fileURLToPath(new URL('../../behavior-eval-output.schema.json', import.meta.url));
const eventItemTypes = new Set(['command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'collab_tool_call']);

export function buildInvocation({ prompt, cwd, outputFile, structured = true }) {
  const outputArgs = structured
    ? ['--output-schema', outputSchema, '-o', outputFile, '-']
    : ['-o', outputFile, '-'];
  return {
    command: 'codex',
    args: [
      '-a', 'never', 'exec', '--ephemeral', '-s', 'workspace-write',
      '--color', 'never', '-C', cwd, '--skip-git-repo-check', '--json',
      ...outputArgs,
    ],
    stdin: prompt,
    env: {},
  };
}

export function normalizeOutput(result) {
  const records = parseJsonLines(result.stdout, 'Codex');
  const messages = records
    .filter((record) => record.item?.type === 'agent_message' && typeof record.item.text === 'string')
    .map((record) => record.item.text)
    .filter((text) => text.trim());
  const events = records.filter((record) => eventItemTypes.has(record.item?.type));
  return { finalText: messages.at(-1)?.trim() ?? '', events };
}

export default {
  id: 'codex',
  toolTrace: 'available',
  aliases: ['codex-cli'],
  projectRulesFile: 'AGENTS.md',
  buildInvocation,
  normalizeOutput,
};
