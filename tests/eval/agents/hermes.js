export function buildInvocation({ prompt }) {
  return {
    command: 'hermes',
    args: ['-t', 'terminal,skills', '-z', prompt],
    stdin: null,
    env: {},
  };
}

export function normalizeOutput(result) {
  return { finalText: String(result.stdout ?? '').trim(), events: [] };
}

export default {
  id: 'hermes',
  toolTrace: 'unavailable',
  aliases: ['hermes-agent'],
  projectRulesFile: 'AGENTS.md',
  buildInvocation,
  normalizeOutput,
};
