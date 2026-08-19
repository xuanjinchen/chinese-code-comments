const LANGUAGE_PROFILES = {
  python: { hash: true, triple: true },
  sql: { dash: true, block: true },
  terraform: { hash: true, slash: true, block: true },
  c: { slash: true, block: true },
  cpp: { slash: true, block: true },
  java: { slash: true, block: true },
  javascript: { slash: true, block: true, backtick: true },
  typescript: { slash: true, block: true, backtick: true },
};

const ALIASES = { 'c++': 'cpp', py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', hcl: 'terraform' };

function profileFor(language) {
  const normalized = String(language).toLowerCase();
  return LANGUAGE_PROFILES[ALIASES[normalized] ?? normalized] ?? LANGUAGE_PROFILES.javascript;
}

export function codeOnly(language, code) {
  const profile = profileFor(language);
  let result = '';
  let state = 'code';
  let quote = '';
  let escaped = false;

  // 保留换行和分隔符位置，只屏蔽注释与字符串，供后续控制流和配对检查使用。
  for (let index = 0; index < code.length; index += 1) {
    const current = code[index];
    const next = code[index + 1] ?? '';
    const triple = code.slice(index, index + 3);

    if (state === 'code') {
      if (profile.triple && (triple === '"""' || triple === "'''")) {
        result += '   ';
        state = 'triple';
        quote = triple;
        index += 2;
      } else if (profile.slash && current === '/' && next === '/') {
        result += '  ';
        state = 'line';
        index += 1;
      } else if (profile.dash && current === '-' && next === '-') {
        result += '  ';
        state = 'line';
        index += 1;
      } else if (profile.block && current === '/' && next === '*') {
        result += '  ';
        state = 'block';
        index += 1;
      } else if (profile.hash && current === '#') {
        result += ' ';
        state = 'line';
      } else if (current === '"' || current === "'" || (profile.backtick && current === '`')) {
        result += ' ';
        state = 'string';
        quote = current;
        escaped = false;
      } else {
        result += current;
      }
      continue;
    }

    if (state === 'line') {
      if (current === '\r' || current === '\n') {
        result += current;
        state = 'code';
      } else {
        result += ' ';
      }
      continue;
    }

    if (state === 'block') {
      if (current === '*' && next === '/') {
        result += '  ';
        state = 'code';
        index += 1;
      } else {
        result += current === '\r' || current === '\n' ? current : ' ';
      }
      continue;
    }

    if (state === 'triple') {
      if (triple === quote) {
        result += '   ';
        state = 'code';
        index += 2;
      } else {
        result += current === '\r' || current === '\n' ? current : ' ';
      }
      continue;
    }

    result += current === '\r' || current === '\n' ? current : ' ';
    if (escaped) escaped = false;
    else if (current === '\\') escaped = true;
    else if (current === quote) state = 'code';
  }

  return { code: result, closed: state === 'code' || state === 'line' };
}

export function isStructurallyValid(language, code) {
  if (typeof code !== 'string' || !code.trim()) return false;
  const { code: visibleCode, closed } = codeOnly(language, code);
  if (!closed) return false;

  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (const character of visibleCode) {
    if ('([{'.includes(character)) stack.push(character);
    else if (pairs[character] && stack.pop() !== pairs[character]) return false;
  }
  if (stack.length > 0) return false;

  if (['python', 'py'].includes(String(language).toLowerCase())) {
    for (const line of visibleCode.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (/^(?:async\s+)?def\b/.test(trimmed) && !trimmed.includes(':')) return false;
      if (/^(?:if|elif|else|for|while|try|except|finally|with)\b/.test(trimmed) && !trimmed.includes(':')) return false;
    }
  }
  return true;
}

const CASE_LANGUAGES = new Map([
  ['java-high-value-write', 'java'],
  ['public-api-method-doc', 'java'],
  ['interface-contract-doc', 'typescript'],
  ['private-method-selection', 'typescript'],
  ['interface-implementation-no-duplicate', 'typescript'],
  ['japanese-method-doc', 'java'],
  ['french-method-doc', 'java'],
  ['c-buffer-fix', 'c'],
  ['grouped-line-comments', 'python'],
  ['english-grouped-line-comments', 'python'],
  ['japanese-grouped-line-comments', 'python'],
  ['strict-english-per-line', 'python'],
  ['negated-strict-write', 'python'],
  ['preserve-existing-english', 'python'],
  ['replace-stale-comment', 'python'],
  ['project-convention-english', 'python'],
  ['cpp-ownership-transfer', 'cpp'],
]);

async function availableTool(candidates, env) {
  for (const candidate of candidates) {
    try {
      await resolveCommand(candidate.command, env);
      return candidate;
    } catch (error) {
      if (!String(error.message).startsWith('Command not found on PATH:')) throw error;
    }
  }
  return null;
}

function diagnostic(error) {
  return error?.result?.stderr?.trim()
    || error?.result?.stdout?.trim()
    || (error instanceof Error ? error.message : String(error));
}

async function runValidation(tool, { args, cwd, stdin, env, timeoutMs }) {
  try {
    await runProcess({
      command: tool.command,
      args: [...(tool.prefixArgs ?? []), ...args],
      cwd,
      stdin,
      env,
      timeoutMs,
    });
    return { valid: true, tool: tool.label, error: null };
  } catch (error) {
    return { valid: false, tool: tool.label, error: diagnostic(error) };
  }
}

export async function validateSyntax(language, source, {
  env = process.env,
  timeoutMs = 30_000,
} = {}) {
  const normalized = ALIASES[String(language).toLowerCase()] ?? String(language).toLowerCase();
  const candidates = normalized === 'python'
    ? process.platform === 'win32'
      ? [
        { command: 'python', label: 'python' },
        { command: 'py', prefixArgs: ['-3'], label: 'py -3' },
        { command: 'python3', label: 'python3' },
      ]
      : [
        { command: 'python3', label: 'python3' },
        { command: 'python', label: 'python' },
      ]
    : normalized === 'typescript'
      ? [{ command: process.execPath, label: 'node --experimental-strip-types' }]
      : normalized === 'java'
      ? [{ command: 'javac', label: 'javac' }]
      : normalized === 'c'
        ? ['cc', 'gcc', 'clang'].map((command) => ({ command, label: command }))
        : normalized === 'cpp'
          ? ['c++', 'g++', 'clang++'].map((command) => ({ command, label: command }))
          : [];
  const tool = await availableTool(candidates, env);
  if (!tool) {
    return {
      valid: false,
      tool: null,
      error: `Required ${normalized} parser or compiler was not found on PATH`,
    };
  }

  if (normalized === 'python') {
    return {
      language: normalized,
      ...await runValidation(tool, {
        args: ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'],
        cwd: process.cwd(),
        stdin: source,
        env,
        timeoutMs,
      }),
    };
  }

  const workspace = await mkdtemp(path.join(tmpdir(), `chinese-code-comments-${normalized}-syntax-`));
  try {
    const extension = { typescript: '.ts', java: '.java', c: '.c', cpp: '.cpp' }[normalized];
    const publicJavaType = normalized === 'java'
      ? source.match(/\bpublic\s+(?:(?:final|abstract|sealed|non-sealed)\s+)*(?:class|interface|enum|record)\s+(?<name>[A-Za-z_]\w*)/u)?.groups.name
      : null;
    const sourcePath = path.join(workspace, `${publicJavaType ?? 'EvalSource'}${extension}`);
    await writeFile(sourcePath, source, 'utf8');
    const args = normalized === 'typescript'
      ? ['--experimental-strip-types', '--check', sourcePath]
      : normalized === 'java'
        ? ['-proc:none', '-d', workspace, sourcePath]
        : normalized === 'c'
          ? ['-x', 'c', '-fsyntax-only', sourcePath]
          : ['-x', 'c++', '-std=c++17', '-fsyntax-only', sourcePath];
    return {
      language: normalized,
      ...await runValidation(tool, { args, cwd: workspace, stdin: null, env, timeoutMs }),
    };
  } finally {
    // 解析器或编译器只验证 Agent 返回源码，临时产物不进入评测工作区或最终证据。
    await rm(workspace, { recursive: true, force: true });
  }
}

function sourceForCase(caseId, language, code) {
  if (caseId === 'java-high-value-write') {
    return `import java.math.BigDecimal;\n${code}\n`
      + 'interface LedgerRepository { void save(LedgerEntry entry); }\n'
      + 'record LedgerEntry(String eventId, BigDecimal amount) {}\n'
      + 'class DuplicateKeyException extends RuntimeException {}\n';
  }
  if (caseId === 'public-api-method-doc') {
    return `import java.util.Optional;\n${code}\n`
      + 'interface OrderRepository { Optional<OrderSummary> findSummary(String orderId); }\n'
      + 'record OrderSummary(String id) {}\n'
      + 'class OrderNotFoundException extends RuntimeException { OrderNotFoundException(String id) {} }\n';
  }
  if (caseId === 'japanese-method-doc' || caseId === 'french-method-doc') {
    return 'import java.util.Optional;\n'
      + `final class EvalSource {\n  private Repository repository;\n${code}\n}\n`
      + 'interface Repository { Optional<Receipt> findById(String id); }\n'
      + 'final class Receipt {}\n'
      + 'final class ReceiptNotFoundException extends RuntimeException { ReceiptNotFoundException(String id) {} }\n';
  }
  if (language === 'c') {
    return '#include <stddef.h>\ntypedef long ssize_t;\n'
      + 'void *malloc(size_t);\nvoid free(void *);\nssize_t recv(int, void *, size_t, int);\n'
      + code;
  }
  if (language === 'cpp') {
    return '#include <memory>\nclass Session { public: void start(); };\n'
      + 'void register_session(std::unique_ptr<Session>);\n'
      + code;
  }
  return code;
}

export async function validateCaseSyntax(definition, code, options) {
  const language = CASE_LANGUAGES.get(definition.id);
  if (!language) return null;
  return validateSyntax(language, sourceForCase(definition.id, language, code), options);
}
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveCommand, runProcess } from './process.js';
