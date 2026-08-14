import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function packFiles() {
  const command = process.platform === 'win32' ? process.env.ComSpec : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm pack --dry-run --json --ignore-scripts']
    : ['pack', '--dry-run', '--json', '--ignore-scripts'];
  const output = execFileSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  const [manifest] = JSON.parse(output);
  return manifest.files.map(({ path }) => path.replaceAll('\\', '/'));
}

test('npm 发布包仅包含运行时文件和标准包元数据', () => {
  const files = packFiles().sort();
  const expectedFiles = [
    'LICENSE',
    'README.md',
    'SKILL.md',
    'agents/openai.yaml',
    'bin/chinese-code-comments.js',
    'package.json',
    'resources/global-policy.md',
    'src/adapters/claude.js',
    'src/adapters/codex.js',
    'src/adapters/gemini.js',
    'src/adapters/grok.js',
    'src/adapters/hermes.js',
    'src/adapters/index.js',
    'src/adapters/opencode.js',
    'src/cli.js',
    'src/doctor.js',
    'src/files/managed-block.js',
    'src/files/text.js',
    'src/install.js',
    'src/installer-lock.js',
    'src/policies/render.js',
    'src/state.js',
    'src/transaction.js',
    'src/uninstall.js',
  ].sort();

  assert.deepEqual(files, expectedFiles);
});
