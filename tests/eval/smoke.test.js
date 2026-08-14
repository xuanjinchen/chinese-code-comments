import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { install } from '../../src/install.js';
import { normalizeOutput as normalizeCodex } from './agents/codex.js';
import {
  SMOKE_PROMPT,
  evaluateSmokeEvidence,
  parseSmokeArgs,
  runSmoke,
  validateJavaRuntime,
} from './smoke.js';
import { createHomeFixture } from '../helpers/fs-fixture.js';

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));

const originalSource = `import java.util.HashSet;
import java.util.Set;

final class PaymentService {
    private final Set<String> processed = new HashSet<>();

    boolean process(String callbackId) {
        if (processed.contains(callbackId)) {
            return false;
        }
        processed.add(callbackId);
        charge(callbackId);
        return true;
    }

    private void charge(String callbackId) {
        System.out.println(callbackId);
    }
}
`;

const fixedSource = `import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

final class PaymentService {
    private final Set<String> processed = ConcurrentHashMap.newKeySet();

    boolean process(String callbackId) {
        // 原子登记保证并发回调只有首次请求能够执行扣款。
        if (!processed.add(callbackId)) {
            return false;
        }
        charge(callbackId);
        return true;
    }

    private void charge(String callbackId) {
        System.out.println(callbackId);
    }
}
`;

const synchronizedSource = `import java.util.HashSet;
import java.util.Set;

final class PaymentService {
    private final Set<String> processed = new HashSet<>();

    boolean process(String callbackId) {
        // 仅将回调去重登记放入临界区，避免同一 callbackId 并发穿透到扣款逻辑。
        synchronized (processed) {
            if (!processed.add(callbackId)) {
                return false;
            }
        }
        charge(callbackId);
        return true;
    }

    private void charge(String callbackId) {
        System.out.println(callbackId);
    }
}
`;

const positiveBranchSource = `import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

final class PaymentService {
    private final Set<String> processed = ConcurrentHashMap.newKeySet();

    boolean process(String callbackId) {
        // 原子登记成功的线程才允许执行扣款。
        if (processed.add(callbackId)) {
            charge(callbackId);
            return true;
        }
        return false;
    }

    private void charge(String callbackId) {
        System.out.println(callbackId);
    }
}
`;

function codexTrace(source = fixedSource, {
  skillPath = 'C:\\Users\\tester\\.agents\\skills\\chinese-code-comments\\SKILL.md',
  skillCommand = null,
  skillOutput = '---\nname: chinese-code-comments\ndescription: test\n---',
  finalText = '已使用 chinese-code-comments 完成完整 diff 注释审查。',
} = {}) {
  const diff = [
    'diff --git a/PaymentService.java b/PaymentService.java',
    '--- a/PaymentService.java',
    '+++ b/PaymentService.java',
    '@@ -1,2 +1,2 @@',
    '-old',
    `+${source.split('\n').find((line) => line.includes('//')) ?? 'new'}`,
  ].join('\n');
  const stdout = [
    {
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: skillCommand ?? `Get-Content ${skillPath}`,
        aggregated_output: skillOutput,
        exit_code: 0,
        status: 'completed',
      },
    },
    { type: 'item.completed', item: { type: 'file_change', status: 'completed' } },
    {
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: 'git diff -- PaymentService.java',
        aggregated_output: diff,
        exit_code: 0,
        status: 'completed',
      },
    },
    {
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: finalText,
      },
    },
  ].map((record) => JSON.stringify(record)).join('\n');
  return { normalized: normalizeCodex({ stdout, stderr: '' }), diff };
}

test('smoke 提示词不显式请求中英文注释', () => {
  assert.doesNotMatch(SMOKE_PROMPT, /注释|comments?/iu);
});

test('smoke 接受 Skill 读取、原子修复、完整 diff 和最终审查证据', () => {
  const { normalized, diff } = codexTrace();
  const result = evaluateSmokeEvidence({
    agent: 'codex',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: normalized.finalText,
    events: normalized.events,
    expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, true, result.summary);
  assert.equal(result.policySkillEvidence, true);
  assert.equal(result.diffEvidence, true);
  assert.equal(result.sideEffectCount, 1_000);
  assert.equal(result.commentInventory.length, 1);
  assert.equal(result.finalReviewEvidence, true);
});

test('smoke 接受 synchronized 临界区内的原子判重登记', () => {
  const { normalized, diff } = codexTrace(synchronizedSource);
  const result = evaluateSmokeEvidence({
    agent: 'codex',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: synchronizedSource,
    diff,
    finalText: normalized.finalText,
    events: normalized.events,
    expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, true, result.summary);
  assert.equal(result.sideEffectCount, 1_000);
});

test('smoke 接受并发集合上由 add 成功分支支配扣款的等价控制流', () => {
  const { normalized, diff } = codexTrace(positiveBranchSource);
  const result = evaluateSmokeEvidence({
    agent: 'codex',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: positiveBranchSource,
    diff,
    finalText: normalized.finalText,
    events: normalized.events,
    expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, true, result.summary);
  assert.equal(result.sideEffectCount, 1_000);
});

test('smoke 接受 Agent 实际暴露的替代 Skill 根目录', () => {
  const { normalized, diff } = codexTrace(fixedSource, {
    skillPath: 'C:\\Users\\tester\\.cc-switch\\skills\\chinese-code-comments\\SKILL.md',
  });
  const result = evaluateSmokeEvidence({
    agent: 'codex',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: normalized.finalText,
    events: normalized.events,
    expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, true, result.summary);
  assert.equal(result.policySkillEvidenceType, 'direct');
});

test('smoke 接受 sed 读取的正确 Skill frontmatter', () => {
  const skillPath = '/home/tester/.agents/skills/chinese-code-comments/SKILL.md';
  const { normalized, diff } = codexTrace(fixedSource, {
    skillPath,
    skillCommand: `sed -n '1,80p' ${skillPath}`,
  });
  const result = evaluateSmokeEvidence({
    agent: 'codex',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: normalized.finalText,
    events: normalized.events,
    expectedSkillFiles: [skillPath],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, true, result.summary);
  assert.equal(result.policySkillEvidenceType, 'direct');
});

test('smoke 接受 PowerShell 5.1 传输时拼接到描述行尾的 frontmatter 结束标记', () => {
  const { normalized, diff } = codexTrace(fixedSource, {
    skillOutput: '---\r\nname: chinese-code-comments\r\ndescription: mojibake?---\r\n\r\n# Chinese Code Comments',
  });
  const result = evaluateSmokeEvidence({
    agent: 'codex',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: normalized.finalText,
    events: normalized.events,
    expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, true, result.summary);
  assert.equal(result.policySkillEvidenceType, 'direct');
});

test('直接轨迹存在时最终回复只需明确报告注释审查已完成', () => {
  const { normalized, diff } = codexTrace(fixedSource, {
    finalText: '`git diff --check` 通过；注释审查已完成，保留了必要的中文并发意图注释。',
  });
  const result = evaluateSmokeEvidence({
    agent: 'codex',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: normalized.finalText,
    events: normalized.events,
    expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, true, result.summary);
  assert.equal(result.finalReviewEvidence, true);
});

test('smoke 拒绝仍可能重复扣款且事件顺序错误的结果', () => {
  const unsafeSource = fixedSource
    .replace('if (!processed.add(callbackId)) {', 'if (processed.contains(callbackId)) {')
    .replace('        charge(callbackId);', '        processed.add(callbackId);\n        charge(callbackId);');
  const { normalized, diff } = codexTrace(unsafeSource);
  const reversedEvents = [...normalized.events].reverse();
  const result = evaluateSmokeEvidence({
    agent: 'codex',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: unsafeSource,
    diff,
    finalText: normalized.finalText,
    events: reversedEvents,
    expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, false);
  assert.equal(result.checks.find((check) => check.name === 'atomic callback guard')?.passed, false);
  assert.equal(result.checks.find((check) => check.name === 'trace order')?.passed, false);
});

test('smoke 不接受由无关并发集合掩盖的 HashSet 非原子登记', () => {
  const unsafeSource = fixedSource
    .replace('private final Set<String> processed = ConcurrentHashMap.newKeySet();', [
      'private final Set<String> processed = new HashSet<>();',
      '    private final Set<String> unrelated = ConcurrentHashMap.newKeySet();',
    ].join('\n'))
    .replace('import java.util.Set;', 'import java.util.HashSet;\nimport java.util.Set;');
  const { normalized, diff } = codexTrace(unsafeSource);
  const result = evaluateSmokeEvidence({
    agent: 'codex',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: unsafeSource,
    diff,
    finalText: normalized.finalText,
    events: normalized.events,
    expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, false);
  assert.equal(result.checks.find((check) => check.name === 'atomic callback guard')?.passed, false);
});

test('smoke 不接受局部同名并发集合掩盖的 HashSet 字段', () => {
  const unsafeSource = fixedSource
    .replace('private final Set<String> processed = ConcurrentHashMap.newKeySet();', 'private final Set<String> processed = new HashSet<>();')
    .replace('import java.util.Set;', 'import java.util.HashSet;\nimport java.util.Set;')
    .replace('    boolean process(String callbackId) {', [
      '    private void prepare() {',
      '        Set<String> processed = ConcurrentHashMap.newKeySet();',
      '        processed.clear();',
      '    }',
      '',
      '    boolean process(String callbackId) {',
    ].join('\n'));
  const { normalized, diff } = codexTrace(unsafeSource);
  const result = evaluateSmokeEvidence({
    agent: 'codex',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: unsafeSource,
    diff,
    finalText: normalized.finalText,
    events: normalized.events,
    expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, false);
  assert.equal(result.checks.find((check) => check.name === 'atomic callback guard')?.passed, false);
});

test('smoke 要求成功读取的 Skill 输出具有正确 frontmatter', () => {
  const { normalized, diff } = codexTrace(fixedSource, {
    skillOutput: '---\nname: another-skill\n---\nExample: name: chinese-code-comments',
  });
  const result = evaluateSmokeEvidence({
    agent: 'codex',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: normalized.finalText,
    events: normalized.events,
    expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, false);
  assert.equal(result.policySkillEvidence, false);
});

test('smoke 拒绝歧义结束标记和重复 name 的 frontmatter', () => {
  const invalidOutputs = [
    '---\nname: chinese-code-comments\nother: ?---\n# Body',
    '---\nname: chinese-code-comments\nname: another-skill\n---\n# Body',
  ];

  for (const skillOutput of invalidOutputs) {
    const { normalized, diff } = codexTrace(fixedSource, { skillOutput });
    const result = evaluateSmokeEvidence({
      agent: 'codex',
      prompt: SMOKE_PROMPT,
      beforeSource: originalSource,
      afterSource: fixedSource,
      diff,
      finalText: normalized.finalText,
      events: normalized.events,
      expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
      changedFiles: ['PaymentService.java'],
    });

    assert.equal(result.passed, false);
    assert.equal(result.policySkillEvidence, false);
  }
});

test('smoke 不把输出 Skill 路径和内容的非读取命令视为直接证据', () => {
  const skillPath = 'C:\\Users\\tester\\.agents\\skills\\chinese-code-comments\\SKILL.md';
  const { normalized, diff } = codexTrace(fixedSource, {
    skillPath,
    skillCommand: `Write-Output ${skillPath}`,
  });
  const result = evaluateSmokeEvidence({
    agent: 'codex',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: normalized.finalText,
    events: normalized.events,
    expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, false);
  assert.equal(result.policySkillEvidence, false);
});

test('不暴露工具轨迹的 runner 使用无提示行为结果作为自动触发证据', () => {
  const { normalized, diff } = codexTrace();
  const result = evaluateSmokeEvidence({
    agent: 'claude',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: normalized.finalText,
    events: [],
    expectedSkillFiles: [],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, true, result.summary);
  assert.equal(result.policySkillEvidence, true);
  assert.equal(result.policySkillEvidenceType, 'behavioral');
});

test('工具轨迹可用但缺少 Skill 读取时标记为 inconclusive', () => {
  const { normalized, diff } = codexTrace();
  const result = evaluateSmokeEvidence({
    agent: 'claude',
    toolTrace: 'available',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: normalized.finalText,
    events: normalized.events.slice(1),
    expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, false);
  assert.equal(result.policySkillEvidence, false);
  assert.equal(result.policySkillEvidenceType, 'inconclusive');
});

test('Gemini 原生工具事件可证明直接读取 Skill', () => {
  const skillPath = 'C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md';
  const { normalized, diff } = codexTrace();
  const result = evaluateSmokeEvidence({
    agent: 'gemini',
    toolTrace: 'available',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: normalized.finalText,
    events: [
      { type: 'tool_use', tool_name: 'read_file', parameters: { path: skillPath } },
      { type: 'tool_result', status: 'success', output: '---\nname: chinese-code-comments\ndescription: test\n---\n' },
      ...normalized.events.slice(1),
    ],
    expectedSkillFiles: [skillPath],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.policySkillEvidence, true);
  assert.equal(result.policySkillEvidenceType, 'direct');
});

test('Gemini 失败的 Skill 读取不能作为直接证据', () => {
  const skillPath = 'C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md';
  const { normalized, diff } = codexTrace();
  const result = evaluateSmokeEvidence({
    agent: 'gemini',
    toolTrace: 'available',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: normalized.finalText,
    events: [
      { type: 'tool_use', tool_name: 'read_file', parameters: { path: skillPath } },
      { type: 'tool_result', status: 'error', output: '---\nname: chinese-code-comments\ndescription: stale output\n---\n' },
      ...normalized.events.slice(1),
    ],
    expectedSkillFiles: [skillPath],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.policySkillEvidence, false);
  assert.equal(result.policySkillEvidenceType, 'inconclusive');
});

test('Java 编译失败返回 smoke 证据而不是抛出', async (t) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'ccc-invalid-java-smoke-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));

  const result = await validateJavaRuntime('final class PaymentService { broken', outputRoot, process.env, 30_000);

  assert.equal(result.valid, false);
  assert.equal(result.tool, 'javac/java');
  assert.ok(result.error?.trim());
});

test('不暴露工具轨迹时仅报告注释审查不足以证明 Skill 已使用', () => {
  const { diff } = codexTrace();
  const result = evaluateSmokeEvidence({
    agent: 'claude',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: '已完成完整 diff 注释审查。',
    events: [],
    expectedSkillFiles: [],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, false);
  assert.equal(result.policySkillEvidence, false);
  assert.equal(result.finalReviewEvidence, true);
});

test('行为证据必须明确报告完整 diff 注释审查', () => {
  const { diff } = codexTrace();
  const result = evaluateSmokeEvidence({
    agent: 'claude',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: 'Used chinese-code-comments and completed the full comment review.',
    events: [],
    expectedSkillFiles: [],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, false);
  assert.equal(result.policySkillEvidence, false);
  assert.equal(result.finalReviewEvidence, true);
});

test('最终审查证据拒绝 neither 否定表达', () => {
  const { normalized, diff } = codexTrace(fixedSource, {
    finalText: 'Completed neither the comment review nor the diff review.',
  });
  const result = evaluateSmokeEvidence({
    agent: 'codex',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: normalized.finalText,
    events: normalized.events,
    expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, false);
  assert.equal(result.finalReviewEvidence, false);
});

test('行为证据拒绝带副词的否定式审查报告', () => {
  const { diff } = codexTrace();
  const result = evaluateSmokeEvidence({
    agent: 'claude',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: 'Used chinese-code-comments. Did not fully complete the full diff comment review, but performed tests.',
    events: [],
    expectedSkillFiles: [],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, false);
  assert.equal(result.policySkillEvidence, false);
  assert.equal(result.finalReviewEvidence, false);
});

test('行为证据拒绝否认 Skill 使用和完整审查的最终回复', () => {
  const { diff } = codexTrace();
  const result = evaluateSmokeEvidence({
    agent: 'claude',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: fixedSource,
    diff,
    finalText: 'Did not use chinese-code-comments and did not complete the full diff comment review.',
    events: [],
    expectedSkillFiles: [],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, false);
  assert.equal(result.policySkillEvidence, false);
  assert.equal(result.finalReviewEvidence, false);
});

test('smoke 拒绝改名后的 Java process 方法', () => {
  const renamedSource = fixedSource.replace('boolean process(String callbackId)', 'boolean handle(String callbackId)');
  const { normalized, diff } = codexTrace(renamedSource);
  const result = evaluateSmokeEvidence({
    agent: 'codex',
    toolTrace: 'available',
    prompt: SMOKE_PROMPT,
    beforeSource: originalSource,
    afterSource: renamedSource,
    diff,
    finalText: normalized.finalText,
    events: normalized.events,
    expectedSkillFiles: ['C:/Users/tester/.agents/skills/chinese-code-comments/SKILL.md'],
    changedFiles: ['PaymentService.java'],
  });

  assert.equal(result.passed, false);
});

test('smoke 入口强制显式选择一个 Agent', () => {
  assert.throws(() => parseSmokeArgs([]), /--agent is required/);
  assert.throws(
    () => parseSmokeArgs(['--agent', 'codex,claude']),
    /exactly one --agent value/,
  );
  assert.deepEqual(
    parseSmokeArgs(['--agent', 'codex', '--results-root', 'out', '--timeout-ms', '5000']),
    { agent: 'codex', resultsRoot: 'out', timeoutMs: 5_000 },
  );
});

test('runSmoke 通过真实 Git 和假 Node Agent 生成完整证据产物', async (t) => {
  const fixture = await createHomeFixture(t);
  await install({ agents: ['codex'], context: fixture.context, sourceRoot });
  const fakeRoot = await mkdtemp(path.join(tmpdir(), 'ccc-smoke-agent-'));
  t.after(() => rm(fakeRoot, { recursive: true, force: true }));
  const fakeAgent = path.join(fakeRoot, 'fake-agent.mjs');
  const skillPath = fixture.path('.agents/skills/chinese-code-comments/SKILL.md');
  const script = `import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [workspace, skillPath] = process.argv.slice(2);
const source = ${JSON.stringify(fixedSource)};
await writeFile(path.join(workspace, 'PaymentService.java'), source, 'utf8');
const skill = await readFile(skillPath, 'utf8');
const patch = 'diff --git a/PaymentService.java b/PaymentService.java\\n+' + source.split('\\n').find((line) => line.includes('//'));
const events = [
  { type: 'item.completed', item: { type: 'command_execution', command: 'read ' + skillPath, aggregated_output: skill, exit_code: 0, status: 'completed' } },
  { type: 'item.completed', item: { type: 'file_change', status: 'completed' } },
  { type: 'item.completed', item: { type: 'command_execution', command: 'git diff -- PaymentService.java', aggregated_output: patch, exit_code: 0, status: 'completed' } },
  { type: 'item.completed', item: { type: 'agent_message', text: '已使用 chinese-code-comments 完成完整 diff 注释审查。' } },
];
process.stdout.write(events.map((event) => JSON.stringify(event)).join('\\n'));
`;
  await writeFile(fakeAgent, script, 'utf8');
  const runner = {
    id: 'codex',
    buildInvocation({ cwd }) {
      return {
        command: process.execPath,
        args: [fakeAgent, cwd, skillPath],
        stdin: null,
        env: {},
      };
    },
    normalizeOutput: normalizeCodex,
  };
  const resultsRoot = fixture.path('nested/smoke-results');

  const result = await runSmoke({
    agent: 'codex',
    resultsRoot,
    timeoutMs: 10_000,
    context: fixture.context,
    sourceRoot,
    runner,
  });

  assert.equal(result.passed, true, result.summary);
  assert.equal(result.sideEffectCount, 1_000);
  assert.match(await readFile(path.join(resultsRoot, 'raw.stdout.log'), 'utf8'), /item\.completed/u);
  assert.equal(JSON.parse(await readFile(path.join(resultsRoot, 'summary.json'), 'utf8')).passed, true);
});
