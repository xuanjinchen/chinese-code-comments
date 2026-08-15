import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { selectAdapters } from '../../src/adapters/index.js';
import { renderPolicy } from '../../src/policies/render.js';

const skill = readFileSync(new URL('../../SKILL.md', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../../resources/global-policy.md', import.meta.url), 'utf8');
const metadata = readFileSync(new URL('../../agents/openai.yaml', import.meta.url), 'utf8');
const sections = skill.match(/^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---\r?\n(?<body>[\s\S]*)$/u);
const description = sections.groups.frontmatter.match(/^description:\s+(.+)$/mu)[1];
const defaultPrompt = metadata.match(/^\s*default_prompt:\s+"(.*)"$/mu)[1];
const chars = (value) => [...value].length;
const bytes = (value) => Buffer.byteLength(value, 'utf8');

test('runtime prompt payload stays within the approved budget', () => {
  assert.ok(chars(description) <= 170, `description chars=${chars(description)}`);
  assert.ok(chars(skill) <= 2_100, `SKILL.md chars=${chars(skill)}`);
  assert.ok(chars(policy) <= 360, `global policy chars=${chars(policy)}`);
  assert.ok(chars(metadata) <= 300, `openai metadata chars=${chars(metadata)}`);
  const combinedBytes = bytes(description) + bytes(sections.groups.body)
    + bytes(policy) + bytes(defaultPrompt);
  assert.ok(combinedBytes <= 6_200, `combined runtime prompt bytes=${combinedBytes}`);
});

test('every rendered Agent policy stays within the constant-context budget', () => {
  const context = { home: '/home/tester', env: {}, platform: 'linux' };
  for (const adapter of selectAdapters(null, context)) {
    for (const eol of ['\n', '\r\n']) {
      const renderedChars = chars(renderPolicy(adapter, policy, eol));
      assert.ok(renderedChars <= 450, `${adapter.id} rendered policy chars=${renderedChars}`);
    }
  }
});
