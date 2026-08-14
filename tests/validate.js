import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { main as cliMain } from '../src/cli.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const expectedFiles = [
  '.github/workflows/ci.yml',
  '.gitignore',
  'README.md',
  'SKILL.md',
  'agents/openai.yaml',
  'bin/chinese-code-comments.js',
  'evals/evals.json',
  'package-lock.json',
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
  'src/policies/render.js',
  'src/state.js',
  'src/transaction.js',
  'src/uninstall.js',
  'tests/contract/behavior-cases.test.js',
  'tests/contract/skill.test.js',
  'tests/eval/agents.test.js',
  'tests/eval/agents/claude.js',
  'tests/eval/agents/codex.js',
  'tests/eval/agents/gemini.js',
  'tests/eval/agents/grok.js',
  'tests/eval/agents/hermes.js',
  'tests/eval/agents/index.js',
  'tests/eval/agents/opencode.js',
  'tests/eval/comments.js',
  'tests/eval/grader.js',
  'tests/eval/process.js',
  'tests/eval/run.js',
  'tests/eval/schema.js',
  'tests/eval/smoke.js',
  'tests/eval/smoke.test.js',
  'tests/eval/syntax.js',
  'tests/helpers/fs-fixture.js',
  'tests/integration/doctor.test.js',
  'tests/integration/install.test.js',
  'tests/integration/transaction.test.js',
  'tests/integration/uninstall.test.js',
  'tests/unit/adapters.test.js',
  'tests/unit/cli.test.js',
  'tests/unit/managed-block.test.js',
  'tests/unit/state.test.js',
  'tests/unit/text.test.js',
  'tests/validate.js',
];

const readUtf8 = async (relativePath) =>
  readFile(path.join(repositoryRoot, relativePath), 'utf8');

async function collectFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (
      entry.name === '.git'
      || entry.name === '.npm'
      || entry.name === 'coverage'
      || entry.name === 'eval-results'
      || entry.name === 'node_modules'
      || entry.name.startsWith('.codex-smoke-')
    ) {
      continue;
    }

    const relativePath = path.posix.join(prefix, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath, relativePath)));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

function validatePackage(packageJson) {
  assert.equal(packageJson.name, 'chinese-code-comments');
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/u);
  assert.equal(packageJson.type, 'module');
  assert.deepEqual(packageJson.bin, {
    'chinese-code-comments': './bin/chinese-code-comments.js',
  });
  assert.equal(packageJson.engines?.node, '>=22');
  assert.deepEqual(packageJson.scripts, {
    test: 'node --test',
    validate: 'node tests/validate.js',
    check: 'npm test && npm run validate',
    eval: 'node tests/eval/run.js',
    smoke: 'node tests/eval/smoke.js',
  });
  assert.equal(packageJson.dependencies, undefined, 'runtime dependencies are not allowed');
}

function validateSkill(skillText) {
  const match = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/u);
  assert.ok(match, 'SKILL.md must begin with YAML frontmatter');

  const keys = [...match[1].matchAll(/^([a-z_]+):\s*(.*)$/gmu)].map((item) => item[1]);
  assert.deepEqual(keys, ['name', 'description']);
  assert.match(match[1], /^name:\s+chinese-code-comments$/mu);
  const description = match[1].match(/^description:\s+(.+)$/mu)?.[1];
  assert.equal(
    description,
    '在创建、修改、重构或修复任意语言代码时，添加、更新和审核准确、耐维护的代码注释；也用于用户明确要求添加、更新或审查代码注释，以及提出中文注释、指定语言注释、逐行注释、代码块注释、方法、类或 API 文档注释等要求。默认使用简体中文，用户指定语言或项目规范优先。任何语言的逐行等价请求（如 English “line-by-line”、日文“一行ずつ”）只要未包含“每一行都必须”“每条都必须”等显式全称约束，一律按语义块使用 GROUPED；STRICT 仅用于显式全称约束。产生代码写入的任务强制使用两阶段完整 diff 流程；纯只读解释或普通代码审查均不强制。',
  );
}

function validateOpenAiMetadata(metadata) {
  assert.match(metadata, /^interface:\s*$/mu);
  assert.match(metadata, /^\s{2}display_name:\s+"Chinese Code Comments"$/mu);
  assert.match(metadata, /^\s{2}short_description:\s+".+"$/mu);
  assert.match(metadata, /^\s{2}default_prompt:\s+".*\$chinese-code-comments.*"$/mu);
  assert.match(metadata, /^policy:\s*$/mu);
  assert.match(metadata, /^\s{2}allow_implicit_invocation:\s+true$/mu);
}

function validateReadme(readme) {
  const requiredSnippets = [
    'Node.js 22',
    'npx --yes github:xuanjinchen/chinese-code-comments install',
    'npx skills add xuanjinchen/chinese-code-comments -g --all',
    'install --agent',
    'uninstall --agent',
    'doctor --agent',
    'npm test',
    'npm run validate',
    'npm run check',
    'npm run eval -- --agent',
    'npm run smoke -- --agent',
  ];

  for (const snippet of requiredSnippets) {
    assert.ok(readme.includes(snippet), `README.md must document: ${snippet}`);
  }
  assert.doesNotMatch(readme, /\.ps1\b/u, 'README.md must not document PowerShell entry points');
}

async function validateCli(packageJson) {
  async function invoke(argv) {
    let stdout = '';
    let stderr = '';
    const code = await cliMain({
      argv,
      env: {},
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } },
    });
    return { code, stdout, stderr };
  }

  const help = await invoke(['--help']);
  assert.equal(help.code, 0);
  assert.equal(help.stderr, '');
  for (const command of ['install', 'uninstall', 'doctor', '--agent', '--version']) {
    assert.ok(help.stdout.includes(command), `CLI help must document: ${command}`);
  }

  const version = await invoke(['--version']);
  assert.deepEqual(version, { code: 0, stdout: `${packageJson.version}\n`, stderr: '' });
}

function validateCi(workflow) {
  assert.match(workflow, /os:\s*\[windows-latest, macos-latest, ubuntu-latest\]/u);
  assert.match(workflow, /node-version:\s*22/u);
  assert.match(workflow, /run:\s*npm ci --ignore-scripts/u);
  assert.match(workflow, /run:\s*npm run check/u);
}

async function main() {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  assert.ok(nodeMajor >= 22, `Node.js 22+ is required; found ${process.versions.node}`);

  const files = await collectFiles(repositoryRoot);
  for (const expectedFile of expectedFiles) {
    assert.ok(files.includes(expectedFile), `missing required file: ${expectedFile}`);
  }

  const powershellFiles = files.filter((file) => file.endsWith('.ps1'));
  assert.deepEqual(powershellFiles, [], `PowerShell files remain: ${powershellFiles.join(', ')}`);

  const jsonFiles = files.filter((file) => file.endsWith('.json'));
  for (const jsonFile of jsonFiles) {
    JSON.parse(await readUtf8(jsonFile));
  }

  const packageJson = JSON.parse(await readUtf8('package.json'));
  validatePackage(packageJson);
  validateSkill(await readUtf8('SKILL.md'));
  validateOpenAiMetadata(await readUtf8('agents/openai.yaml'));
  validateReadme(await readUtf8('README.md'));
  await validateCli(packageJson);
  validateCi(await readUtf8('.github/workflows/ci.yml'));

  const executable = await readUtf8('bin/chinese-code-comments.js');
  assert.ok(executable.startsWith('#!/usr/bin/env node\n'), 'CLI must use the portable Node shebang');

  process.stdout.write('Repository validation passed.\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
