import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ADAPTER_IDS,
  selectAdapters,
} from '../../src/adapters/index.js';
import { renderPolicy } from '../../src/policies/render.js';

const template = readFileSync(
  new URL('../../resources/global-policy.md', import.meta.url),
  'utf8',
);

const linuxContext = {
  home: '/home/tester',
  env: {},
  platform: 'linux',
};

function adapter(id) {
  return selectAdapters([id], linuxContext)[0];
}

test('formal adapters resolve approved global paths', () => {
  const adapters = selectAdapters(null, linuxContext);

  assert.deepEqual(adapters.map((item) => item.id), [
    'codex',
    'claude',
    'gemini',
    'grok',
    'opencode',
    'hermes',
  ]);
  assert.deepEqual(ADAPTER_IDS, adapters.map((item) => item.id));
  assert.equal(adapter('codex').policyFile(linuxContext), '/home/tester/.codex/AGENTS.md');
  assert.equal(adapter('claude').policyFile(linuxContext), '/home/tester/.claude/CLAUDE.md');
  assert.equal(adapter('gemini').policyFile(linuxContext), '/home/tester/.gemini/GEMINI.md');
  assert.equal(adapter('grok').policyFile(linuxContext), '/home/tester/.grok/AGENTS.md');
  assert.equal(
    adapter('opencode').policyFile(linuxContext),
    '/home/tester/.config/opencode/AGENTS.md',
  );
  assert.equal(adapter('hermes').policyFile(linuxContext), '/home/tester/.hermes/SOUL.md');
});

test('each adapter applies only its documented environment override', () => {
  const context = {
    home: '/home/tester',
    platform: 'linux',
    env: {
      CODEX_HOME: '/opt/codex',
      CLAUDE_CONFIG_DIR: '/opt/claude',
      GEMINI_CLI_HOME: '/opt/gemini',
      GROK_HOME: '/opt/grok',
      XDG_CONFIG_HOME: '/opt/xdg',
      HERMES_HOME: '/opt/hermes',
    },
  };

  assert.equal(adapter('codex').policyFile(context), '/opt/codex/AGENTS.md');
  assert.equal(adapter('claude').policyFile(context), '/opt/claude/CLAUDE.md');
  assert.equal(adapter('gemini').policyFile(context), '/opt/gemini/GEMINI.md');
  assert.equal(adapter('grok').policyFile(context), '/opt/grok/AGENTS.md');
  assert.equal(adapter('opencode').policyFile(context), '/opt/xdg/opencode/AGENTS.md');
  assert.equal(adapter('hermes').policyFile(context), '/opt/hermes/SOUL.md');
});

test('adapters use the three approved skill storage groups', () => {
  const expected = {
    codex: ['agents', '/home/tester/.agents/skills'],
    claude: ['claude', '/home/tester/.claude/skills'],
    gemini: ['agents', '/home/tester/.agents/skills'],
    grok: ['agents', '/home/tester/.agents/skills'],
    opencode: ['agents', '/home/tester/.agents/skills'],
    hermes: ['hermes', '/home/tester/.hermes/skills'],
  };

  for (const adapter of selectAdapters(null, linuxContext)) {
    assert.deepEqual(
      [adapter.storageGroup, adapter.skillRoot(linuxContext)],
      expected[adapter.id],
    );
  }
});

test('adapter aliases normalize and preserve first-selected order', () => {
  assert.deepEqual(
    selectAdapters(['gemini-cli', 'claude-code', 'gemini'], linuxContext).map(
      (item) => item.id,
    ),
    ['gemini', 'claude'],
  );
  assert.equal(adapter('open-code').id, 'opencode');
  assert.equal(adapter('hermes-cli').id, 'hermes');
  assert.throws(() => selectAdapters(['unknown'], linuxContext), /Unknown agent: unknown/);
});

test('Codex policy uses the explicit skill invocation and HTML markers', () => {
  const output = renderPolicy(adapter('codex'), template, '\n');

  assert.match(output, /^<!-- chinese-code-comments:start -->/);
  assert.match(output, /\$chinese-code-comments/);
  assert.match(output, /<!-- chinese-code-comments:end -->\n$/);
  assert.doesNotMatch(output, /\{\{skill_invocation\}\}/);
});

test('non-Codex policies use the portable skill invocation wording', () => {
  for (const id of ADAPTER_IDS.filter((item) => item !== 'codex')) {
    const output = renderPolicy(adapter(id), template, '\n');

    assert.match(output, /the skill named chinese-code-comments/);
    assert.doesNotMatch(output, /\$chinese-code-comments/);
  }
});

test('Hermes policy has visible markers and no HTML comments', () => {
  const output = renderPolicy(adapter('hermes'), template, '\n');

  assert.match(output, /^## chinese-code-comments managed policy: start/m);
  assert.match(output, /## chinese-code-comments managed policy: end\n$/);
  assert.doesNotMatch(output, /<!--/);
});

test('policy rendering normalizes the complete managed block to the requested EOL', () => {
  const output = renderPolicy(adapter('codex'), template, '\r\n');

  assert.match(output, /\r\n/);
  assert.equal(output.replaceAll('\r\n', '').includes('\n'), false);
  assert.equal(output.endsWith('\r\n'), true);
});
