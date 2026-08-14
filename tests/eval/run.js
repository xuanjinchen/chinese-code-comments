import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { gradeCase } from './grader.js';
import { selectRunner } from './agents/index.js';
import { runProcess } from './process.js';
import { validateCaseSyntax } from './syntax.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const behaviorCasesPath = path.join(repositoryRoot, 'tests', 'behavior-cases.json');
const evalsPath = path.join(repositoryRoot, 'evals', 'evals.json');

const evalCatalog = JSON.parse(readFileSync(evalsPath, 'utf8'));
export const DEFAULT_CASE_IDS = Object.freeze(
  evalCatalog.evals.map((definition) => definition.case_id).sort(),
);
const DEFAULT_CASE_ID_SET = new Set(DEFAULT_CASE_IDS);
const ENGLISH_PROJECT_RULE_CASES = new Set(['project-convention-english', 'french-method-doc']);

function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function appendList(target, value) {
  for (const item of value.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    if (!target.includes(item)) target.push(item);
  }
}

export function parseRunArgs(argv) {
  const agents = [];
  const caseIds = [];
  let resultsRoot = null;
  let timeoutMs = 120_000;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--agent') {
      appendList(agents, optionValue(argv, index, argument));
      index += 1;
    } else if (argument === '--case') {
      appendList(caseIds, optionValue(argv, index, argument));
      index += 1;
    } else if (argument === '--results-root') {
      resultsRoot = optionValue(argv, index, argument);
      index += 1;
    } else if (argument === '--timeout-ms') {
      const value = Number(optionValue(argv, index, argument));
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('--timeout-ms must be a positive integer');
      timeoutMs = value;
      index += 1;
    } else {
      throw new Error(`Unknown eval option: ${argument}`);
    }
  }

  if (agents.length === 0) throw new Error('--agent is required; live evaluation never selects an Agent by default');
  if (agents.length !== 1) throw new Error('Live evaluation requires exactly one --agent value');
  return { agent: agents[0], caseIds: caseIds.length > 0 ? caseIds : null, resultsRoot, timeoutMs };
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (cause) {
    throw new Error(`Cannot read JSON dependency: ${filePath}`, { cause });
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createResultsRoot(resultsRoot, runnerId) {
  if (!resultsRoot) {
    return mkdtemp(path.join(tmpdir(), `chinese-code-comments-${runnerId}-eval-`));
  }
  const target = path.resolve(resultsRoot);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await mkdir(target);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`Results root already exists: ${target}`, { cause: error });
    }
    throw error;
  }
  return target;
}

function invocationName(runner) {
  return runner.id === 'codex' ? '$chinese-code-comments' : 'the skill named chinese-code-comments';
}

function buildEvaluationPrompt(caseDefinition, evalDefinition, runner) {
  const original = String(evalDefinition.prompt).replaceAll('$chinese-code-comments', invocationName(runner));
  const invocationRule = caseDefinition.should_invoke
    ? `- You must actually use ${invocationName(runner)} and return exactly one JSON object.`
    : '- This is a read-only negative case: do not modify code or claim a full diff workflow.';
  return `${original}\n\nEvaluation output protocol:\n${invocationRule}\n`
    + `- case_id must be "${caseDefinition.id}"; mode must be GROUPED, STRICT, or SCOPED.\n`
    + '- code contains only the revised code, without Markdown fences.\n'
    + '- comments lists every added or updated comment; text is the exact body in code and kind is line, block, or doc.\n'
    + '- covered_executable_lines counts executable statements directly covered by that comment.\n'
    + '- comment_count equals comments.length.\n'
    + '- independently_commented_statement_count counts statements whose preceding non-blank line is a standalone comment.\n'
    + '- json-no-comments must keep comments empty and put all explanation outside code.\n'
    + '- explanation briefly reports the mode decision and final comment review result.\n'
    + '- Return raw JSON only, with no Markdown fence or surrounding prose.\n';
}

function safeWorkspacePath(workspaceRoot, relativePath) {
  const target = path.resolve(workspaceRoot, relativePath);
  const relative = path.relative(workspaceRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Eval fixture escapes workspace: ${relativePath}`);
  return target;
}

async function initializeWorkspace({ workspaceRoot, caseDefinition, evalDefinition, runner }) {
  await mkdir(workspaceRoot, { recursive: true });
  for (const fixture of evalDefinition.files ?? []) {
    const relativePath = fixture.path ?? fixture.name;
    if (!relativePath) throw new Error(`Eval ${evalDefinition.id} contains a fixture without a path`);
    const target = safeWorkspacePath(workspaceRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, String(fixture.content ?? fixture.contents ?? ''), 'utf8');
  }
  if (ENGLISH_PROJECT_RULE_CASES.has(caseDefinition.id)) {
    const rules = '# Evaluation Project Rules\n\n- All newly added code comments must use English unless the user explicitly requests another language.\n';
    await writeFile(path.join(workspaceRoot, runner.projectRulesFile), rules, 'utf8');
  }
}

function failureGrading(caseId, error) {
  return {
    caseId,
    passed: false,
    checks: [{
      name: 'Evaluation process and structured output succeed',
      passed: false,
      evidence: error instanceof Error ? error.message : String(error),
    }],
    summary: { passed: 0, failed: 1, total: 1, passRate: 0 },
  };
}

function selectedCaseIds(caseIds) {
  const selected = caseIds == null ? [...DEFAULT_CASE_IDS] : [...new Set(caseIds)];
  for (const id of selected) {
    if (!DEFAULT_CASE_ID_SET.has(id)) throw new Error(`Unknown behavior eval case: ${id}`);
  }
  return selected;
}

async function finalTextForRunner(runner, normalized, responsePath) {
  if (runner.id !== 'codex') return normalized.finalText;
  try {
    // Codex 的 -o 文件是最终消息权威来源，JSONL 仅用于保留工具和文件事件。
    return await readFile(responsePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return normalized.finalText;
    throw error;
  }
}

export async function runBehaviorEval({
  agent,
  resultsRoot = null,
  caseIds = null,
  timeoutMs = 120_000,
  runner: runnerOverride = null,
} = {}) {
  if (!agent) throw new Error('--agent is required; live evaluation never selects an Agent by default');
  const runner = runnerOverride ?? selectRunner(agent);
  const selected = selectedCaseIds(caseIds);
  const behaviorCases = await readJson(behaviorCasesPath);
  const evalDocument = await readJson(evalsPath);
  const behaviorById = new Map(behaviorCases.map((definition) => [definition.id, definition]));
  const evalById = new Map(evalDocument.evals.map((definition) => [definition.case_id, definition]));
  const outputRoot = await createResultsRoot(resultsRoot, runner.id);

  const cases = [];
  let infrastructureError = null;
  for (const caseId of selected) {
    const caseDefinition = behaviorById.get(caseId);
    const evalDefinition = evalById.get(caseId);
    if (!caseDefinition || !evalDefinition) throw new Error(`Missing behavior definition for case: ${caseId}`);
    const caseRoot = path.join(outputRoot, caseId);
    const workspaceRoot = path.join(caseRoot, 'workspace');
    const responsePath = path.join(caseRoot, 'response.json');
    await mkdir(caseRoot, { recursive: true });
    await initializeWorkspace({ workspaceRoot, caseDefinition, evalDefinition, runner });
    const prompt = buildEvaluationPrompt(caseDefinition, evalDefinition, runner);
    await writeFile(path.join(caseRoot, 'prompt.txt'), prompt, 'utf8');

    let grading;
    let processResult = { stdout: '', stderr: '' };
    let infrastructurePhase = true;
    try {
      await rm(responsePath, { force: true });
      const invocation = runner.buildInvocation({ prompt, cwd: workspaceRoot, outputFile: responsePath });
      processResult = await runProcess({
        ...invocation,
        cwd: workspaceRoot,
        timeoutMs,
      });
      await writeFile(path.join(caseRoot, 'raw.stdout.log'), processResult.stdout, 'utf8');
      await writeFile(path.join(caseRoot, 'raw.stderr.log'), processResult.stderr, 'utf8');
      const normalized = runner.normalizeOutput(processResult);
      const finalText = await finalTextForRunner(runner, normalized, responsePath);
      infrastructurePhase = false;
      const response = JSON.parse(finalText.trim());
      await writeJson(responsePath, response);
      const syntaxResult = await validateCaseSyntax(caseDefinition, response.code, { timeoutMs });
      if (syntaxResult && syntaxResult.tool === null) {
        const error = new Error(`Syntax-validation infrastructure is unavailable: ${syntaxResult.error}`);
        error.infrastructure = true;
        throw error;
      }
      grading = gradeCase(caseDefinition, response, { syntaxResult });
    } catch (error) {
      if (infrastructurePhase || error?.result || error?.infrastructure) {
        processResult = error.result;
        infrastructureError = error;
      }
      await writeFile(path.join(caseRoot, 'raw.stdout.log'), processResult?.stdout ?? '', 'utf8');
      await writeFile(path.join(caseRoot, 'raw.stderr.log'), processResult?.stderr ?? '', 'utf8');
      grading = failureGrading(caseId, error);
    }
    await writeJson(path.join(caseRoot, 'grading.json'), grading);
    cases.push({ caseId, passed: grading.passed, summary: grading.summary });
    if (infrastructureError) break;
  }

  const failedCases = cases.filter((item) => !item.passed).length;
  const summary = {
    agent: runner.id,
    resultsRoot: outputRoot,
    cases,
    summary: {
      passedCases: cases.length - failedCases,
      failedCases,
      totalCases: cases.length,
    },
    passed: failedCases === 0 && cases.length === selected.length,
  };
  await writeJson(path.join(outputRoot, 'summary.json'), summary);
  if (infrastructureError) {
    infrastructureError.summary = summary;
    throw infrastructureError;
  }
  return summary;
}

export async function main({ argv = process.argv.slice(2), stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = parseRunArgs(argv);
    const result = await runBehaviorEval(options);
    for (const item of result.cases) {
      stdout.write(`[${item.caseId}] passed=${item.summary.passed} failed=${item.summary.failed}\n`);
    }
    stdout.write(`Results: ${result.resultsRoot}\n`);
    return result.passed ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const isEntryPoint = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntryPoint) process.exitCode = await main();
