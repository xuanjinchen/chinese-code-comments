export function buildInvocation({ prompt }) {
  return {
    command: 'claude',
    args: ['-p', prompt, '--output-format', 'json', '--permission-mode', 'acceptEdits', '--no-session-persistence'],
    stdin: null,
    env: {},
  };
}

export function normalizeOutput(result) {
  let record;
  try {
    record = JSON.parse(result.stdout);
  } catch (cause) {
    throw new Error('Claude emitted invalid JSON output', { cause });
  }
  const value = record.structured_output ?? record.result;
  const finalText = typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);
  return { finalText: finalText.trim(), events: [] };
}

export default {
  id: 'claude',
  toolTrace: 'unavailable',
  aliases: ['claude-code'],
  projectRulesFile: 'CLAUDE.md',
  buildInvocation,
  normalizeOutput,
};
