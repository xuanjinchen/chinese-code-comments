import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function packFiles() {
  const args = ['pack', '--dry-run', '--json', '--ignore-scripts'];
  let command = 'npm';
  if (process.platform === 'win32') {
    const require = createRequire(resolve(dirname(process.execPath), 'resolve-npm.cjs'));
    const npmPackagePath = require.resolve('npm/package.json');
    const npmPackage = require(npmPackagePath);
    // Windows 下绕过 npm.cmd，保证发布包检查也不依赖命令解释器。
    command = process.execPath;
    args.unshift(resolve(dirname(npmPackagePath), npmPackage.bin.npm));
  }
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
