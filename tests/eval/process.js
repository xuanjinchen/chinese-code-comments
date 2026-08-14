import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function pathValue(env) {
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH');
  return key ? env[key] : '';
}

function mergeEnvironment(overrides) {
  const merged = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (process.platform === 'win32') {
      const duplicate = Object.keys(merged).find((name) => name.toUpperCase() === key.toUpperCase());
      if (duplicate && duplicate !== key) delete merged[duplicate];
    }
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

async function isFile(filePath, executable = false) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    if (executable) await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function expandCmdPath(value, directory) {
  return path.normalize(value
    .replace(/%~dp0/giu, `${directory}${path.sep}`)
    .replace(/%dp0%/giu, `${directory}${path.sep}`));
}

async function unwrapCmd(commandPath) {
  const source = await readFile(commandPath, 'utf8');
  const directory = path.dirname(commandPath);
  const quotedPaths = [...source.matchAll(/"([^"\r\n]+\.(?:exe|js|cjs|mjs))"/giu)]
    .map((match) => expandCmdPath(match[1], directory));
  const script = quotedPaths.find((candidate) => /\.(?:js|cjs|mjs)$/iu.test(candidate) && path.isAbsolute(candidate));
  if (script && await isFile(script)) {
    const declaredNode = quotedPaths.find((candidate) => /node\.exe$/iu.test(candidate));
    const node = declaredNode && await isFile(declaredNode) ? declaredNode : process.execPath;
    return { command: node, prefixArgs: [script] };
  }
  const executable = quotedPaths.find((candidate) => candidate.toLowerCase() !== process.execPath.toLowerCase());
  if (executable && await isFile(executable)) return { command: executable, prefixArgs: [] };
  throw new Error(`Cannot execute command wrapper without a shell: ${commandPath}`);
}

async function adaptResolvedCommand(commandPath, platform) {
  const extension = path.extname(commandPath).toLowerCase();
  if (platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
    // npm 在 Windows 上主要暴露批处理包装器；直接解析真实入口可避免重新引入 shell/PowerShell 依赖。
    return unwrapCmd(commandPath);
  }
  if (platform === 'win32' && extension === '.ps1') {
    throw new Error(`PowerShell command wrappers are not supported: ${commandPath}`);
  }
  return { command: commandPath, prefixArgs: [] };
}

export async function resolveCommand(command, env = process.env, platform = process.platform) {
  if (!command || typeof command !== 'string') throw new TypeError('command must be a non-empty string');
  const hasDirectory = path.isAbsolute(command) || command.includes('/') || command.includes('\\');
  const directories = hasDirectory ? [''] : String(pathValue(env) ?? '').split(path.delimiter).filter(Boolean);
  const extensions = platform === 'win32'
    ? String(env.PATHEXT ?? '.COM;.EXE;.CMD;.BAT').split(';').filter((extension) => extension.toLowerCase() !== '.ps1')
    : [''];
  const hasExtension = path.extname(command) !== '';

  for (const directory of directories) {
    const base = hasDirectory ? path.resolve(command) : path.join(directory, command);
    const candidates = platform === 'win32' && !hasExtension
      ? [...extensions.map((extension) => `${base}${extension.toLowerCase()}`), ...extensions.map((extension) => `${base}${extension.toUpperCase()}`), base]
      : [base];
    for (const candidate of [...new Set(candidates)]) {
      if (await isFile(candidate, platform !== 'win32')) return adaptResolvedCommand(candidate, platform);
    }
  }
  throw new Error(`Command not found on PATH: ${command}`);
}

function processError(message, result, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.result = result;
  return error;
}

function runUtility(command, args) {
  return new Promise((resolve) => {
    const output = [];
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    child.stdout.on('data', (chunk) => output.push(Buffer.from(chunk)));
    child.on('error', () => resolve({ code: null, stdout: '' }));
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(output).toString('utf8') }));
  });
}

async function posixDescendants(rootPid) {
  const result = await runUtility('ps', ['-A', '-o', 'pid=', '-o', 'ppid=']);
  if (result.code !== 0) return [];
  const children = new Map();
  for (const line of result.stdout.split(/\r?\n/u)) {
    const [pid, parentPid] = line.trim().split(/\s+/u).map(Number);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parentPid)) continue;
    children.set(parentPid, [...(children.get(parentPid) ?? []), pid]);
  }
  const descendants = [];
  const visit = (pid) => {
    for (const childPid of children.get(pid) ?? []) {
      visit(childPid);
      descendants.push(childPid);
    }
  };
  visit(rootPid);
  return descendants;
}

async function terminateProcessTree(child, signal) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const result = await runUtility('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    if (result.code !== 0) child.kill(signal);
    return;
  }

  // 先记录后代 PID，再终止进程组；这样显式 detached 的工具进程也不会逃逸。
  const descendants = await posixDescendants(child.pid);
  try { process.kill(-child.pid, signal); } catch {}
  for (const pid of descendants) {
    try { process.kill(pid, signal); } catch {}
  }
  child.kill(signal);
}

export async function runProcess({ command, args = [], cwd, stdin = null, env = {}, timeoutMs = 120_000 }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive number');
  // Windows 对环境变量名不区分大小写，重复的 Path/PATH 会让 Node 丢弃其中一个值。
  const effectiveEnv = mergeEnvironment(env);
  const resolved = await resolveCommand(command, effectiveEnv);

  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let settled = false;
    let forceKillTimer;
    const child = spawn(resolved.command, [...resolved.prefixArgs, ...args], {
      cwd,
      env: effectiveEnv,
      detached: process.platform !== 'win32',
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child, 'SIGTERM').finally(() => {
        if (settled) return;
        forceKillTimer = setTimeout(() => {
          void terminateProcessTree(child, 'SIGKILL');
        }, 1_000);
        forceKillTimer.unref();
      });
    }, timeoutMs);
    timer.unref();

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.stdin.on('error', () => {});
    if (stdin === null || stdin === undefined) child.stdin.end();
    else child.stdin.end(String(stdin), 'utf8');

    child.on('error', (cause) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(processError(`Failed to start ${command}: ${cause.message}`, null, cause));
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      const result = {
        code,
        signal,
        timedOut,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (timedOut) {
        reject(processError(`${command} timed out after ${timeoutMs}ms`, result));
      } else if (code !== 0) {
        const diagnostic = result.stderr.trim() || result.stdout.trim() || 'no diagnostic output';
        reject(processError(`${command} exited with code ${code}: ${diagnostic}`, result));
      } else {
        resolve(result);
      }
    });
  });
}

export function parseJsonLines(value, label) {
  return String(value ?? '').split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (cause) {
      throw new Error(`${label} emitted invalid JSONL at line ${index + 1}`, { cause });
    }
  });
}
