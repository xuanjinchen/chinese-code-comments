import assert from 'node:assert/strict';
import test from 'node:test';

import { parseArgs, resolveHome } from '../../src/cli.js';

test('install defaults to every adapter', () => {
  assert.deepEqual(parseArgs(['install']), { command: 'install', agents: null });
});

test('--agent accepts repeated and comma-separated ids', () => {
  assert.deepEqual(
    parseArgs(['install', '--agent', 'codex,claude', '--agent', 'gemini']),
    { command: 'install', agents: ['codex', 'claude', 'gemini'] },
  );
});

test('--agent removes duplicates while preserving first-seen order', () => {
  assert.deepEqual(
    parseArgs(['doctor', '--agent', 'codex,claude,codex', '--agent', 'claude']),
    { command: 'doctor', agents: ['codex', 'claude'] },
  );
});

test('unknown options fail before dispatch', () => {
  assert.throws(() => parseArgs(['install', '--force']), /Unknown option: --force/);
});

test('an empty --agent value is rejected', () => {
  assert.throws(() => parseArgs(['install', '--agent', ',']), /requires at least one agent id/);
  assert.throws(() => parseArgs(['install', '--agent', 'codex,,claude']), /empty agent id/);
  assert.throws(() => parseArgs(['install', '--agent', ',codex']), /empty agent id/);
});

test('home resolution follows the current platform convention', () => {
  const env = { HOME: '/home/tester', USERPROFILE: 'C:\\Users\\tester' };
  assert.equal(resolveHome(env, 'linux'), '/home/tester');
  assert.equal(resolveHome(env, 'darwin'), '/home/tester');
  assert.equal(resolveHome(env, 'win32'), 'C:\\Users\\tester');
});

test('help and version aliases normalize to commands', () => {
  assert.deepEqual(parseArgs([]), { command: 'help', agents: null });
  assert.deepEqual(parseArgs(['--help']), { command: 'help', agents: null });
  assert.deepEqual(parseArgs(['--version']), { command: 'version', agents: null });
});
