import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildInvocation as buildClaude, normalizeOutput as normalizeClaude } from './agents/claude.js';
import { buildInvocation as buildCodex, normalizeOutput as normalizeCodex } from './agents/codex.js';
import { buildInvocation as buildGemini, normalizeOutput as normalizeGemini } from './agents/gemini.js';
import { buildInvocation as buildGrok, normalizeOutput as normalizeGrok } from './agents/grok.js';
import { buildInvocation as buildHermes, normalizeOutput as normalizeHermes } from './agents/hermes.js';
import { RUNNER_IDS, selectRunner } from './agents/index.js';
import { buildInvocation as buildOpenCode, normalizeOutput as normalizeOpenCode } from './agents/opencode.js';
import { runProcess } from './process.js';
import { DEFAULT_CASE_IDS, parseRunArgs, runBehaviorEval } from './run.js';

const input = {
  prompt: '请修改代码并返回 JSON',
  cwd: path.resolve('workspace with spaces'),
  outputFile: path.resolve('results', 'response.json'),
};

test('六个正式 runner 使用已确认的非交互协议', () => {
  assert.deepEqual(RUNNER_IDS, ['codex', 'claude', 'gemini', 'grok', 'opencode', 'hermes']);

  const codex = buildCodex(input);
  assert.equal(codex.command, 'codex');
  assert.deepEqual(codex.args.slice(0, 6), ['-a', 'never', 'exec', '--ephemeral', '-s', 'workspace-write']);
  assert.deepEqual(codex.args.slice(-5), ['--output-schema', codex.args.at(-4), '-o', input.outputFile, '-']);
  assert.equal(codex.stdin, input.prompt);

  assert.deepEqual(buildClaude(input), {
    command: 'claude',
    args: ['-p', input.prompt, '--output-format', 'json', '--permission-mode', 'acceptEdits', '--no-session-persistence'],
    stdin: null,
    env: {},
  });
  assert.deepEqual(buildGemini(input), {
    command: 'gemini',
    args: ['-p', input.prompt, '--output-format', 'stream-json', '--approval-mode', 'yolo'],
    stdin: null,
    env: {},
  });
  assert.deepEqual(buildGrok(input), {
    command: 'grok',
    args: ['--no-auto-update', '--cwd', input.cwd, '-p', input.prompt, '--output-format', 'streaming-json', '--yolo'],
    stdin: null,
    env: {},
  });
  assert.deepEqual(buildOpenCode(input), {
    command: 'opencode',
    args: ['run', '--format', 'json', '--auto', '--dir', input.cwd, input.prompt],
    stdin: null,
    env: { OPENCODE_DISABLE_AUTOUPDATE: 'true' },
  });
  assert.deepEqual(buildHermes(input), {
    command: 'hermes',
    args: ['-t', 'terminal,skills', '-z', input.prompt],
    stdin: null,
    env: {},
  });
});

test('runner 选择支持正式名称和明确别名', () => {
  assert.equal(selectRunner('claude-code').id, 'claude');
  assert.equal(selectRunner('gemini-cli').id, 'gemini');
  assert.equal(selectRunner('open-code').id, 'opencode');
  assert.throws(() => selectRunner('unknown'), /Unknown eval agent: unknown/);
});

test('runner 显式声明工具轨迹能力', () => {
  assert.deepEqual(
    RUNNER_IDS.map((id) => [id, selectRunner(id).toolTrace]),
    [
      ['codex', 'available'],
      ['claude', 'unavailable'],
      ['gemini', 'available'],
      ['grok', 'available'],
      ['opencode', 'available'],
      ['hermes', 'unavailable'],
    ],
  );
});

test('六种输出格式归一为最终文本和工具事件', () => {
  const codex = normalizeCodex({
    stdout: [
      JSON.stringify({ type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'a.js' }] } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"case_id":"codex"}' } }),
    ].join('\n'),
    stderr: '',
  });
  assert.equal(codex.finalText, '{"case_id":"codex"}');
  assert.equal(codex.events.length, 1);

  const claude = normalizeClaude({ stdout: JSON.stringify({ type: 'result', result: '{"case_id":"claude"}' }), stderr: '' });
  assert.equal(claude.finalText, '{"case_id":"claude"}');
  assert.deepEqual(claude.events, []);

  const gemini = normalizeGemini({
    stdout: [
      JSON.stringify({ type: 'message', role: 'assistant', content: '{"case_' }),
      JSON.stringify({ type: 'tool_use', tool_name: 'write_file', parameters: { path: 'a.js' } }),
      JSON.stringify({ type: 'message', role: 'assistant', content: 'id":"gemini"}' }),
    ].join('\n'),
    stderr: '',
  });
  assert.equal(gemini.finalText, '{"case_id":"gemini"}');
  assert.equal(gemini.events.length, 1);

  const grok = normalizeGrok({
    stdout: [
      JSON.stringify({ type: 'text', data: '{"case_id":' }),
      JSON.stringify({ type: 'tool_call', toolName: 'search_replace', rawInput: { path: 'a.js' } }),
      JSON.stringify({ type: 'text', data: '"grok"}' }),
    ].join('\n'),
    stderr: '',
  });
  assert.equal(grok.finalText, '{"case_id":"grok"}');
  assert.equal(grok.events.length, 1);

  const opencode = normalizeOpenCode({
    stdout: [
      JSON.stringify({ type: 'tool_use', part: { type: 'tool', tool: 'edit', state: { status: 'completed' } } }),
      JSON.stringify({ type: 'text', part: { type: 'text', text: '{"case_id":"opencode"}' } }),
    ].join('\n'),
    stderr: '',
  });
  assert.equal(opencode.finalText, '{"case_id":"opencode"}');
  assert.equal(opencode.events.length, 1);

  assert.deepEqual(normalizeHermes({ stdout: '  {"case_id":"hermes"}\n', stderr: '' }), {
    finalText: '{"case_id":"hermes"}',
    events: [],
  });
});

test('runProcess 通过 PATH 执行假 CLI 并保留 UTF-8 stdin/stdout/stderr', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ccc-fake-cli-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const scriptPath = path.join(directory, 'fake-agent.js');
  const script = [
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => {",
    "  process.stderr.write('诊断信息');",
    "  process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input }));",
    '});',
  ].join('\n');
  await writeFile(scriptPath, script, 'utf8');

  let commandPath;
  if (process.platform === 'win32') {
    // npm 同时生成 POSIX shim 与 .cmd；Windows 必须按 PATHEXT 优先选择可执行包装器。
    await writeFile(path.join(directory, 'fake-agent'), '#!/bin/sh\nexit 99\n', 'utf8');
    commandPath = path.join(directory, 'fake-agent.cmd');
    await writeFile(commandPath, `@ECHO off\r\n"${process.execPath}" "%~dp0fake-agent.js" %*\r\n`, 'utf8');
  } else {
    commandPath = path.join(directory, 'fake-agent');
    await writeFile(commandPath, `#!${process.execPath}\n${script}\n`, 'utf8');
    await chmod(commandPath, 0o755);
  }

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PATH') delete env[key];
  }
  env.PATH = `${directory}${path.delimiter}${process.env.PATH ?? ''}`;
  if (process.platform === 'win32') env.PATHEXT = '.CMD;.EXE';

  const result = await runProcess({
    command: 'fake-agent',
    args: ['--label', '中文 value'],
    cwd: directory,
    stdin: '输入内容',
    env,
    timeoutMs: 5_000,
  });

  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.timedOut, false);
  assert.deepEqual(JSON.parse(result.stdout), { args: ['--label', '中文 value'], input: '输入内容' });
  assert.equal(result.stderr, '诊断信息');
});

test('runProcess 超时时终止子进程并返回诊断', async () => {
  await assert.rejects(
    runProcess({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 60_000)'],
      cwd: process.cwd(),
      stdin: null,
      env: process.env,
      timeoutMs: 50,
    }),
    (error) => {
      assert.match(error.message, /timed out after 50ms/);
      assert.equal(error.result.timedOut, true);
      return true;
    },
  );
});

test('runProcess 超时时终止 Agent 派生的整个进程树', async () => {
  const parentScript = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore', detached: true });",
    'child.unref();',
    "console.log(child.pid);",
    "setInterval(() => {}, 60000);",
  ].join(' ');
  let descendantPid;
  try {
    await assert.rejects(
      runProcess({
        command: process.execPath,
        args: ['-e', parentScript],
        cwd: process.cwd(),
        stdin: null,
        env: process.env,
        timeoutMs: 200,
      }),
      (error) => {
        descendantPid = Number(error.result.stdout.trim());
        assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
        return true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.throws(() => process.kill(descendantPid, 0), /ESRCH|not found|no such process/i);
  } finally {
    if (descendantPid) {
      try { process.kill(descendantPid, 'SIGKILL'); } catch {}
    }
  }
});

test('Codex output schema 路径指向现有 schema', async () => {
  const codex = buildCodex(input);
  const schemaPath = codex.args[codex.args.indexOf('--output-schema') + 1];
  assert.match(await readFile(schemaPath, 'utf8'), /"case_id"/);
});

test('Codex 普通文本模式移除 schema 但仍写入最终消息', () => {
  const codex = buildCodex({ ...input, structured: false });
  assert.equal(codex.args.includes('--output-schema'), false);
  assert.deepEqual(codex.args.slice(-3), ['-o', input.outputFile, '-']);
  assert.equal(codex.stdin, input.prompt);
});

test('eval 入口强制显式选择一个 Agent', () => {
  assert.throws(() => parseRunArgs([]), /--agent is required/);
  assert.throws(() => parseRunArgs(['--agent', 'codex,claude']), /exactly one --agent/);
  assert.throws(() => parseRunArgs(['--agent', 'codex', '--agent', 'claude']), /exactly one --agent/);
  assert.deepEqual(parseRunArgs(['--agent', 'codex', '--case', 'self-explanatory-write,json-no-comments']), {
    agent: 'codex',
    caseIds: ['self-explanatory-write', 'json-no-comments'],
    resultsRoot: null,
    timeoutMs: 120_000,
  });
  assert.equal(DEFAULT_CASE_IDS.length, 20);
  assert.equal(DEFAULT_CASE_IDS.includes('read-only-explanation'), true);
});

test('runBehaviorEval 将非法 JSON 记为案例失败并继续后续案例', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ccc-eval-invalid-json-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  let invocationCount = 0;
  const validSecondResponse = {
    case_id: 'json-no-comments',
    mode: 'SCOPED',
    language: 'zh-CN',
    code: '{"feature":{"enabled":true,"timeoutSeconds":30}}',
    explanation: '已按要求更新配置并完成完整改动的注释审查，标准 JSON 不写入注释。',
    comment_count: 0,
    comments: [],
    executable_statement_count: 0,
    independently_commented_statement_count: 0,
    json_comments_added: false,
  };
  const runner = {
    id: 'codex',
    projectRulesFile: 'AGENTS.md',
    buildInvocation() {
      const output = invocationCount++ === 0 ? 'not-json' : JSON.stringify(validSecondResponse);
      return { command: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(output)})`], stdin: null, env: {} };
    },
    normalizeOutput(result) {
      return { finalText: result.stdout, events: [] };
    },
  };

  const summary = await runBehaviorEval({
    agent: 'codex',
    resultsRoot: path.join(directory, 'results'),
    caseIds: ['self-explanatory-write', 'json-no-comments'],
    runner,
  });

  assert.equal(summary.cases.length, 2);
  assert.deepEqual(summary.cases.map(({ passed }) => passed), [false, true]);
});

test('runBehaviorEval 用假 CLI 执行案例并写入完整评测产物', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ccc-eval-run-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const resultsRoot = path.join(directory, 'results');
  const scriptPath = path.join(directory, 'fake-eval-agent.js');
  const response = {
    case_id: 'self-explanatory-write',
    mode: 'SCOPED',
    language: 'zh-CN',
    code: 'function visibleIds(items: Item[], active: boolean): string[] {\n  if (!active) return [];\n  return items.filter((item) => item.visible).map((item) => item.id);\n}',
    explanation: '已完成完整改动的注释审查，无需新增代码注释。',
    comment_count: 0,
    comments: [],
    executable_statement_count: 2,
    independently_commented_statement_count: 0,
    json_comments_added: false,
  };
  await writeFile(scriptPath, `process.stdout.write(${JSON.stringify(JSON.stringify(response))});\n`, 'utf8');
  const fakeRunner = {
    id: 'codex',
    projectRulesFile: 'AGENTS.md',
    buildInvocation() {
      return { command: process.execPath, args: [scriptPath], stdin: null, env: {} };
    },
    normalizeOutput(result) {
      return { finalText: result.stdout, events: [{ type: 'fake_write' }] };
    },
  };
  const summary = await runBehaviorEval({
    agent: 'codex',
    resultsRoot,
    caseIds: ['self-explanatory-write'],
    runner: fakeRunner,
  });

  assert.equal(summary.passed, true);
  assert.deepEqual(summary.summary, { passedCases: 1, failedCases: 0, totalCases: 1 });
  const caseRoot = path.join(resultsRoot, 'self-explanatory-write');
  assert.deepEqual(JSON.parse(await readFile(path.join(caseRoot, 'response.json'), 'utf8')), response);
  assert.equal(JSON.parse(await readFile(path.join(caseRoot, 'grading.json'), 'utf8')).passed, true);
  assert.equal(await readFile(path.join(caseRoot, 'raw.stdout.log'), 'utf8'), JSON.stringify(response));
  assert.equal(await readFile(path.join(caseRoot, 'raw.stderr.log'), 'utf8'), '');
  assert.match(await readFile(path.join(caseRoot, 'prompt.txt'), 'utf8'), /chinese-code-comments/);
  assert.equal(JSON.parse(await readFile(path.join(resultsRoot, 'summary.json'), 'utf8')).passed, true);
});

test('runBehaviorEval 在写入前拒绝已存在的结果目录', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ccc-eval-existing-root-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const resultsRoot = path.join(directory, 'results');
  await mkdir(resultsRoot);
  await writeFile(path.join(resultsRoot, 'sentinel.txt'), 'keep\n', 'utf8');

  await assert.rejects(
    runBehaviorEval({
      agent: 'codex',
      resultsRoot,
      caseIds: ['self-explanatory-write'],
      runner: { id: 'codex' },
    }),
    /Results root already exists/,
  );
  assert.equal(await readFile(path.join(resultsRoot, 'sentinel.txt'), 'utf8'), 'keep\n');
});

test('runBehaviorEval 在 CLI 缺失时于首个案例直接失败', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ccc-eval-missing-cli-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const missingRunner = {
    id: 'missing',
    projectRulesFile: 'AGENTS.md',
    buildInvocation() {
      return { command: 'definitely-missing-chinese-code-comments-cli', args: [], stdin: null, env: {} };
    },
    normalizeOutput() {
      throw new Error('unreachable');
    },
  };

  await assert.rejects(
    runBehaviorEval({
      agent: 'codex',
      resultsRoot: path.join(directory, 'results'),
      caseIds: ['self-explanatory-write', 'json-no-comments'],
      runner: missingRunner,
    }),
    (error) => {
      assert.match(error.message, /Command not found on PATH/);
      assert.equal(error.summary.cases.length, 1);
      return true;
    },
  );
});
