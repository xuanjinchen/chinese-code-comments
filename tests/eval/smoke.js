import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { selectAdapters } from '../../src/adapters/index.js';
import { resolveHome } from '../../src/cli.js';
import { doctor } from '../../src/doctor.js';
import { extractComments } from './comments.js';
import { selectRunner } from './agents/index.js';
import { runProcess } from './process.js';
import { codeOnly } from './syntax.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

export const SMOKE_PROMPT = '只修改 PaymentService.java：修复并发重复扣款问题，保证同一个 callbackId 并发访问时 charge 最多执行一次；不新增文件，不改变现有方法签名，并运行可用的相关验证。';

const PAYMENT_FIXTURE = `import java.util.HashSet;
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

function normalizedText(value) {
  return JSON.stringify(value).replaceAll('\\', '/').replace(/\/+/gu, '/').toLowerCase();
}

function eventIndex(events, predicate) {
  return events.findIndex((event) => predicate(event, normalizedText(event)));
}

function blockRangeAfter(source, openingPattern) {
  const match = openingPattern.exec(source);
  if (!match) return null;
  const openingBrace = source.indexOf('{', match.index);
  if (openingBrace < 0) return null;

  // 按配对大括号限定临界区，避免把块外未受保护的 add 误判为原子操作。
  let depth = 1;
  for (let index = openingBrace + 1; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') depth -= 1;
    if (depth === 0) {
      return { start: openingBrace + 1, end: index, body: source.slice(openingBrace + 1, index) };
    }
  }
  return null;
}

function hasMatchAtBraceDepth(source, pattern, expectedDepth) {
  const matcher = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (const match of source.matchAll(matcher)) {
    let depth = 0;
    for (let index = 0; index < match.index; index += 1) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') depth -= 1;
    }
    if (depth === expectedDepth) return true;
  }
  return false;
}

function atomicCallbackGuard(source) {
  const visible = codeOnly('java', source).code;
  const usesConcurrentSet = hasMatchAtBraceDepth(
    visible,
    /\bprocessed\s*=\s*ConcurrentHashMap\s*\.\s*newKeySet\s*\(\s*\)/u,
    1,
  );
  const synchronizedRange = blockRangeAfter(
    visible,
    /synchronized\s*\(\s*processed\s*\)\s*\{/u,
  );
  const negativeFlow = /if\s*\(\s*!\s*processed\s*\.\s*add\s*\(\s*callbackId\s*\)\s*\)\s*\{\s*return\s+false\s*;\s*\}\s*\}?\s*charge\s*\(\s*callbackId\s*\)\s*;\s*return\s+true\s*;/u.exec(visible);
  const positiveFlow = /if\s*\(\s*processed\s*\.\s*add\s*\(\s*callbackId\s*\)\s*\)\s*\{\s*charge\s*\(\s*callbackId\s*\)\s*;\s*return\s+true\s*;\s*\}\s*\}?\s*return\s+false\s*;/u.exec(visible);
  const atomicFlow = negativeFlow ?? positiveFlow;
  const addIndex = atomicFlow === null
    ? -1
    : visible.indexOf('processed', atomicFlow.index);
  const guardsAddWithLock = synchronizedRange !== null
    && addIndex >= synchronizedRange.start
    && addIndex < synchronizedRange.end;
  const hasCheckThenAct = /processed\s*\.\s*contains\s*\(/u.test(visible);
  const addCalls = visible.match(/processed\s*\.\s*add\s*\(\s*callbackId\s*\)/gu) ?? [];
  const chargeCalls = visible.match(/\bcharge\s*\(\s*callbackId\s*\)\s*;/gu) ?? [];
  return atomicFlow !== null
    && (usesConcurrentSet || guardsAddWithLock)
    && !hasCheckThenAct
    && addCalls.length === 1
    && chargeCalls.length === 1;
}

function addCheck(checks, name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

function reportsSkillUse(finalText) {
  const denied = /(?:did\s+not|didn't|never|not)\s+(?!only\b)(?:[\p{L}\p{N}_-]+\s+){0,3}(?:use|invoke|load)|without\s+(?:[\p{L}\p{N}_-]+\s+){0,3}(?:using|invoking|loading)|\bneither\b[\s\S]{0,80}(?:used|invoked|loaded)|(?:未|没有|并未|尚未|未能)(?:使用|加载|调用)/iu.test(finalText);
  if (denied) return false;
  return /(?:已)?(?:使用|加载|调用)(?:了)?\s*(?:the skill named\s+)?chinese-code-comments|(?:used|loaded|invoked)\s+(?:the skill named\s+)?chinese-code-comments/iu.test(finalText);
}

function reportsCompletedReview(finalText) {
  const denied = /(?:did\s+not|didn't|never|not)\s+(?!only\b)(?:[\p{L}\p{N}_-]+\s+){0,3}(?:complete|perform|review)|without\s+(?:[\p{L}\p{N}_-]+\s+){0,3}(?:completing|performing|reviewing)|\bincomplete\b[\s\S]{0,40}(?:comment|review)|\bneither\b[\s\S]{0,80}(?:comment[\s\S]{0,20}review|review[\s\S]{0,20}comment)|(?:未|没有|并未|尚未|未能)(?:完成|执行|审查)/iu.test(finalText);
  if (denied) return false;
  const completion = /已完成|完成了|完成|已执行|执行了|completed|performed/iu.test(finalText);
  const commentReview = /注释[\s\S]{0,20}审查|comment[\s\S]{0,20}review|review[\s\S]{0,20}comment/iu.test(finalText);
  return completion && commentReview;
}

function reportsFullDiffReview(finalText) {
  return reportsCompletedReview(finalText)
    && /(?:完整|full)[\s\S]{0,20}diff[\s\S]{0,40}(?:注释[\s\S]{0,20}审查|comment[\s\S]{0,20}review)/iu.test(finalText);
}

function frontmatterName(content) {
  if (typeof content !== 'string') return null;
  const lines = content.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  if (lines[0]?.trim() !== '---') return null;
  // PowerShell 5.1 可能在中文 UTF-8 输出损坏处吞掉换行，将结束标记拼到替换字符后。
  const closing = lines.findIndex((line, index) => index > 0
    && (line.trim() === '---' || /^\s*description\s*:[\s\S]*(?:\?|\uFFFD)---\s*$/u.test(line)));
  if (closing < 0) return null;
  const nameLines = lines.slice(1, closing).filter((line) => /^\s*name\s*:/u.test(line));
  if (nameLines.length !== 1) return null;
  const value = nameLines[0].replace(/^\s*name\s*:\s*/u, '').trim();
  const quoted = value.match(/^(?:"([^"]*)"|'([^']*)')$/u);
  return quoted ? (quoted[1] ?? quoted[2]) : value;
}

function isSuccessfulSkillRead(event, expectedSkillFiles) {
  const item = event?.item;
  if (item?.type !== 'command_execution' || item.exit_code !== 0 || item.status !== 'completed') {
    return false;
  }
  const command = normalizedText(item.command ?? '');
  const usesReadCommand = /(?:^|["'\s&|;(])(?:get-content|gc|cat|type|read|sed|head|more)(?:\.exe)?(?:["'\s]|$)/u.test(command);
  const readsExpectedFile = expectedSkillFiles.some((file) => command.includes(
    file.replaceAll('\\', '/').replace(/\/+/gu, '/').toLowerCase(),
  ));
  const readsExposedSkill = /\/chinese-code-comments\/skill\.md(?:\b|$)/u.test(command);
  return usesReadCommand
    && (readsExpectedFile || readsExposedSkill)
    && frontmatterName(item.aggregated_output) === 'chinese-code-comments';
}

function stringValues(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringValues(item, output));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => stringValues(item, output));
  }
  return output;
}

function eventSucceeded(event) {
  const statuses = [
    event?.status,
    event?.state?.status,
    event?.result?.status,
    event?.part?.state?.status,
  ];
  return event?.exit_code === 0
    || event?.success === true
    || statuses.some((status) => ['success', 'completed'].includes(String(status).toLowerCase()));
}

function successfulSkillReadIndex(events, expectedSkillFiles) {
  const expectedPaths = expectedSkillFiles.map((file) => file
    .replaceAll('\\', '/')
    .replace(/\/+/gu, '/')
    .toLowerCase());
  for (let index = 0; index < events.length; index += 1) {
    if (isSuccessfulSkillRead(events[index], expectedSkillFiles)) return index;
    const text = normalizedText(events[index]);
    const readTool = /"(?:tool|tool_name|toolname)":"?(?:read|read_file|get-content|cat|sed|head|type)/u.test(text)
      || /(?:get-content|\bcat\b|\bsed\b|\bhead\b)/u.test(text);
    const skillPath = expectedPaths.some((file) => text.includes(file))
      || /\/chinese-code-comments\/skill\.md(?:\b|$)/u.test(text);
    if (!readTool || !skillPath) continue;

    // 读取请求附近可能同时包含失败结果或旧输出，只有明确成功的事件能够证明 Skill 已加载。
    const nearbyOutput = events.slice(index, index + 3)
      .filter(eventSucceeded)
      .flatMap((event) => stringValues(event));
    if (nearbyOutput.some((value) => frontmatterName(value) === 'chinese-code-comments')) {
      return index;
    }
  }
  return -1;
}

export function evaluateSmokeEvidence({
  agent,
  toolTrace = null,
  prompt,
  beforeSource,
  afterSource,
  diff,
  finalText,
  events = [],
  expectedSkillFiles = [],
  changedFiles = [],
  runtimeValidation = null,
}) {
  const checks = [];
  const skillIndex = successfulSkillReadIndex(events, expectedSkillFiles);
  const editIndex = eventIndex(events, (event, text) =>
    event?.item?.type === 'file_change'
      || /"(?:tool|tool_name)":"?(?:edit|write|replace|write_file)/u.test(text));
  const reviewIndex = eventIndex(events, (event, text) =>
    text.includes('git diff') && text.includes('diff --git a/paymentservice.java b/paymentservice.java'));
  const directSkillEvidence = skillIndex >= 0;
  const effectiveToolTrace = toolTrace ?? (events.length > 0 ? 'available' : 'unavailable');
  const directTraceOrder = skillIndex >= 0 && editIndex > skillIndex && reviewIndex > editIndex;
  const atomicGuard = atomicCallbackGuard(afterSource);
  const preservesMethodSignature = /\bboolean\s+process\s*\(\s*String\s+callbackId\s*\)/u.test(
    codeOnly('java', afterSource).code,
  );
  const sideEffectCount = runtimeValidation?.sideEffectCount
    ?? (atomicGuard && preservesMethodSignature ? 1_000 : null);
  const commentInventory = extractComments('java', afterSource);
  const chineseComments = commentInventory.filter((comment) => /[\u4e00-\u9fff]/u.test(comment.text));
  const restrainedComments = commentInventory.length >= 1
    && commentInventory.length <= 2
    && chineseComments.length === commentInventory.length
    && chineseComments.some((comment) => /并发|原子|重复|扣款/u.test(comment.text));
  const diffEvidence = typeof diff === 'string'
    && /^diff --git a\/PaymentService\.java b\/PaymentService\.java$/mu.test(diff)
    && /[\u4e00-\u9fff]/u.test(diff);
  const finalReviewEvidence = reportsCompletedReview(finalText);
  const finalSkillUseEvidence = reportsSkillUse(finalText);
  const implicitPrompt = !/注释|comments?/iu.test(prompt);
  const behavioralEvidence = effectiveToolTrace === 'unavailable'
    && implicitPrompt
    && atomicGuard
    && restrainedComments
    && diffEvidence
    && finalSkillUseEvidence
    && reportsFullDiffReview(finalText);
  const policySkillEvidence = directSkillEvidence || behavioralEvidence;
  const policySkillEvidenceType = directSkillEvidence
    ? 'direct'
    : behavioralEvidence
      ? 'behavioral'
      : 'inconclusive';
  const traceOrder = directSkillEvidence ? directTraceOrder : behavioralEvidence;

  addCheck(checks, 'implicit prompt', implicitPrompt, 'Prompt must not request comments.');
  addCheck(checks, 'source changed', afterSource !== beforeSource, 'PaymentService.java must change.');
  addCheck(checks, 'policy and Skill evidence', policySkillEvidence, 'Expected a successful read of the installed Skill.');
  addCheck(checks, 'trace order', traceOrder, `skill=${skillIndex}; edit=${editIndex}; review=${reviewIndex}`);
  addCheck(checks, 'process method signature', preservesMethodSignature, 'Expected boolean process(String callbackId).');
  addCheck(checks, 'atomic callback guard', atomicGuard, 'Expected one guarded processed.add call using a concurrent set or synchronized critical section.');
  addCheck(checks, 'single callback side effect', sideEffectCount === 1_000, `sideEffectCount=${sideEffectCount}`);
  addCheck(
    checks,
    'Java compile and concurrent runtime',
    runtimeValidation === null || runtimeValidation.valid,
    runtimeValidation?.error ?? runtimeValidation?.tool ?? 'Not requested by the pure evidence evaluator.',
  );
  addCheck(checks, 'restrained Chinese comments', restrainedComments, `comments=${commentInventory.length}`);
  addCheck(checks, 'complete diff evidence', diffEvidence, 'Expected the target patch and its Chinese intent comment.');
  addCheck(checks, 'target-only change', changedFiles.length === 1 && changedFiles[0] === 'PaymentService.java', `changedFiles=${changedFiles.join(',')}`);
  addCheck(checks, 'final comment review', finalReviewEvidence, finalText);

  const failed = checks.filter((check) => !check.passed).map((check) => check.name);
  return {
    agent,
    passed: failed.length === 0,
    checks,
    summary: failed.length === 0 ? 'Smoke evidence passed.' : `Failed checks: ${failed.join(', ')}`,
    policySkillEvidence,
    policySkillEvidenceType,
    diffEvidence,
    commentInventory,
    sideEffectCount,
    finalReviewEvidence,
  };
}

function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

export function parseSmokeArgs(argv) {
  const agents = [];
  let resultsRoot = null;
  let timeoutMs = 120_000;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--agent') {
      for (const id of optionValue(argv, index, option).split(',').map((value) => value.trim()).filter(Boolean)) {
        if (!agents.includes(id)) agents.push(id);
      }
      index += 1;
    } else if (option === '--results-root') {
      resultsRoot = optionValue(argv, index, option);
      index += 1;
    } else if (option === '--timeout-ms') {
      timeoutMs = Number(optionValue(argv, index, option));
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        throw new Error('--timeout-ms must be a positive integer');
      }
      index += 1;
    } else {
      throw new Error(`Unknown smoke option: ${option}`);
    }
  }

  if (agents.length === 0) throw new Error('--agent is required; live smoke never selects an Agent by default');
  if (agents.length !== 1) throw new Error('Live smoke requires exactly one --agent value');
  return { agent: agents[0], resultsRoot, timeoutMs };
}

function runtimeContext(env = process.env) {
  return {
    home: resolveHome(env),
    env,
    platform: process.platform,
  };
}

async function runGit(args, cwd, env, timeoutMs) {
  return runProcess({ command: 'git', args, cwd, stdin: null, env, timeoutMs });
}

const JAVA_SMOKE_HARNESS = `import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

final class PaymentServiceSmoke {
    public static void main(String[] args) throws Exception {
        Method process = PaymentService.class.getDeclaredMethod("process", String.class);
        if (process.getReturnType() != boolean.class) {
            throw new AssertionError("process must return boolean");
        }
        process.setAccessible(true);
        PaymentService service = new PaymentService();
        ExecutorService executor = Executors.newFixedThreadPool(2);
        ByteArrayOutputStream charges = new ByteArrayOutputStream();
        PrintStream original = System.out;
        int accepted = 0;
        try (PrintStream captured = new PrintStream(charges, true, StandardCharsets.UTF_8)) {
            System.setOut(captured);
            for (int index = 0; index < 1000; index++) {
                String callbackId = "callback-" + index;
                CountDownLatch start = new CountDownLatch(1);
                Future<Boolean> first = executor.submit(() -> {
                    start.await();
                    return (boolean) process.invoke(service, callbackId);
                });
                Future<Boolean> second = executor.submit(() -> {
                    start.await();
                    return (boolean) process.invoke(service, callbackId);
                });
                start.countDown();
                if (first.get()) accepted++;
                if (second.get()) accepted++;
            }
        } finally {
            System.setOut(original);
            executor.shutdownNow();
        }
        long sideEffects = charges.toString(StandardCharsets.UTF_8).lines().count();
        if (accepted != 1000 || sideEffects != 1000) {
            throw new AssertionError("accepted=" + accepted + "; sideEffects=" + sideEffects);
        }
        System.out.println("sideEffectCount=" + sideEffects);
    }
}
`;

function runtimeDiagnostic(error) {
  return error?.result?.stderr?.trim()
    || error?.result?.stdout?.trim()
    || (error instanceof Error ? error.message : String(error));
}

export async function validateJavaRuntime(source, outputRoot, env, timeoutMs) {
  const runtimeRoot = path.join(outputRoot, 'java-runtime');
  const sourcePath = path.join(runtimeRoot, 'PaymentService.java');
  const harnessPath = path.join(runtimeRoot, 'PaymentServiceSmoke.java');
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(sourcePath, source, 'utf8');
  await writeFile(harnessPath, JAVA_SMOKE_HARNESS, 'utf8');
  try {
    await runProcess({
      command: 'javac',
      args: ['-proc:none', '-d', runtimeRoot, sourcePath, harnessPath],
      cwd: runtimeRoot,
      env,
      timeoutMs,
    });
  } catch (error) {
    if (!error?.result) throw error;
    return { valid: false, tool: 'javac/java', error: runtimeDiagnostic(error), sideEffectCount: null };
  }
  let execution;
  try {
    execution = await runProcess({
      command: 'java',
      args: ['-cp', runtimeRoot, 'PaymentServiceSmoke'],
      cwd: runtimeRoot,
      env,
      timeoutMs,
    });
  } catch (error) {
    if (!error?.result) throw error;
    return { valid: false, tool: 'javac/java', error: runtimeDiagnostic(error), sideEffectCount: null };
  }
  const sideEffectCount = Number(execution.stdout.match(/sideEffectCount=(\d+)/u)?.[1]);
  return {
    valid: sideEffectCount === 1_000,
    tool: 'javac/java',
    error: sideEffectCount === 1_000 ? null : `Unexpected Java smoke output: ${execution.stdout.trim()}`,
    sideEffectCount,
  };
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

function changedFileNames(status) {
  return status.split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => line.slice(3).trim().split(' -> ').at(-1).replaceAll('\\', '/'));
}

export async function runSmoke({
  agent,
  resultsRoot = null,
  timeoutMs = 120_000,
  context = runtimeContext(),
  sourceRoot = repositoryRoot,
  runner: runnerOverride = null,
} = {}) {
  if (!agent) throw new Error('--agent is required; live smoke never selects an Agent by default');
  const runner = runnerOverride ?? selectRunner(agent);
  const adapter = selectAdapters([runner.id], context)[0];
  const installation = await doctor({ agents: [adapter.id], context, sourceRoot });
  if (!installation.healthy) {
    const failures = installation.checks
      .filter((check) => check.status !== 'ok')
      .map((check) => `${check.subject}: ${check.message}`);
    throw new Error(`Installed runtime is not current for ${adapter.id}: ${failures.join('; ')}`);
  }

  const outputRoot = resultsRoot
    ? path.resolve(resultsRoot)
    : await mkdtemp(path.join(tmpdir(), `chinese-code-comments-${runner.id}-smoke-`));
  if (resultsRoot) {
    await mkdir(path.dirname(outputRoot), { recursive: true });
    await mkdir(outputRoot, { recursive: false });
  }
  const workspaceRoot = path.join(outputRoot, 'workspace');
  const sourcePath = path.join(workspaceRoot, 'PaymentService.java');
  const finalPath = path.join(outputRoot, 'final.txt');
  const stdoutPath = path.join(outputRoot, 'raw.stdout.log');
  const stderrPath = path.join(outputRoot, 'raw.stderr.log');
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(sourcePath, PAYMENT_FIXTURE, 'utf8');

  const processEnv = {
    ...context.env,
    HOME: context.home,
    USERPROFILE: context.home,
  };
  await runGit(['init'], workspaceRoot, processEnv, timeoutMs);
  await runGit(['config', 'user.name', 'Chinese Code Comments Smoke'], workspaceRoot, processEnv, timeoutMs);
  await runGit(['config', 'user.email', 'smoke@example.invalid'], workspaceRoot, processEnv, timeoutMs);
  await runGit(['add', 'PaymentService.java'], workspaceRoot, processEnv, timeoutMs);
  await runGit(['commit', '-m', 'test: add payment fixture'], workspaceRoot, processEnv, timeoutMs);

  const invocation = runner.buildInvocation({
    prompt: SMOKE_PROMPT,
    cwd: workspaceRoot,
    outputFile: finalPath,
    structured: false,
  });
  let processResult;
  try {
    processResult = await runProcess({
      ...invocation,
      cwd: workspaceRoot,
      env: { ...processEnv, ...invocation.env },
      timeoutMs,
    });
  } catch (error) {
    await writeFile(stdoutPath, error?.result?.stdout ?? '', 'utf8');
    await writeFile(stderrPath, error?.result?.stderr ?? '', 'utf8');
    throw error;
  }
  await writeFile(stdoutPath, processResult.stdout, 'utf8');
  await writeFile(stderrPath, processResult.stderr, 'utf8');

  const normalized = runner.normalizeOutput(processResult);
  const fileFinal = await readOptional(finalPath);
  const finalText = fileFinal.trim() || normalized.finalText;
  await writeFile(finalPath, `${finalText.trim()}\n`, 'utf8');
  const afterSource = await readFile(sourcePath, 'utf8');
  const diffResult = await runGit(['diff', '--', 'PaymentService.java'], workspaceRoot, processEnv, timeoutMs);
  const statusResult = await runGit(['status', '--short'], workspaceRoot, processEnv, timeoutMs);
  const diffPath = path.join(outputRoot, 'PaymentService.diff');
  await writeFile(diffPath, diffResult.stdout, 'utf8');
  // 真实 JVM 夹具同时约束方法签名和并发副作用，静态模式匹配只用于补充诊断。
  const runtimeValidation = await validateJavaRuntime(afterSource, outputRoot, processEnv, timeoutMs);

  const expectedSkillFiles = [path.join(
    adapter.skillRoot(context),
    'chinese-code-comments',
    'SKILL.md',
  )];
  const evidence = evaluateSmokeEvidence({
    agent: runner.id,
    toolTrace: runner.toolTrace,
    prompt: SMOKE_PROMPT,
    beforeSource: PAYMENT_FIXTURE,
    afterSource,
    diff: diffResult.stdout,
    finalText,
    events: normalized.events,
    expectedSkillFiles,
    changedFiles: changedFileNames(statusResult.stdout),
    runtimeValidation,
  });
  const result = {
    ...evidence,
    resultsRoot: outputRoot,
    installationChecks: installation.checks,
    paths: { source: sourcePath, diff: diffPath, stdout: stdoutPath, stderr: stderrPath, final: finalPath },
  };
  await writeFile(path.join(outputRoot, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

export async function main({ argv = process.argv.slice(2), stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const result = await runSmoke(parseSmokeArgs(argv));
    stdout.write(`Smoke passed=${result.passed}. Results: ${result.resultsRoot}\n`);
    return result.passed ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const isEntryPoint = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntryPoint) process.exitCode = await main();
