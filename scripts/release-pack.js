import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const defaultRepositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const outputMarker = '.chinese-code-comments-release-output';

function containsPath(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertSafeOutputRoot(outputRoot, repositoryRoot) {
  const filesystemRoot = path.parse(outputRoot).root;
  if (outputRoot === filesystemRoot || containsPath(outputRoot, repositoryRoot)) {
    throw new Error('Release output directory must not be the repository or filesystem root');
  }
}

async function prepareOutputRoot(outputRoot, repositoryRoot) {
  assertSafeOutputRoot(outputRoot, repositoryRoot);
  let entries = null;
  try {
    entries = await readdir(outputRoot);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (entries?.length > 0 && !entries.includes(outputMarker)) {
    throw new Error('Refusing to clear an unmanaged non-empty release directory');
  }

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, outputMarker), 'managed by release:pack\n', 'utf8');
}

function npmInvocation(outputRoot) {
  const args = ['pack', '--ignore-scripts', '--json', '--pack-destination', outputRoot];
  if (process.platform !== 'win32') return { command: 'npm', args };
  if (/[\r\n"&|<>^%!]/u.test(outputRoot)) {
    throw new Error(`Release output path contains unsupported Windows command characters: ${outputRoot}`);
  }
  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', 'npm.cmd', ...args],
  };
}

async function runNpmPack(outputRoot, repositoryRoot) {
  const invocation = npmInvocation(outputRoot);
  const result = await execFileAsync(invocation.command, invocation.args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  let manifest;
  try {
    manifest = JSON.parse(result.stdout);
  } catch (cause) {
    throw new Error('npm pack did not return valid JSON', { cause });
  }
  if (!Array.isArray(manifest) || manifest.length !== 1 || typeof manifest[0]?.filename !== 'string') {
    throw new Error('npm pack must produce exactly one tarball');
  }
  return path.join(outputRoot, path.basename(manifest[0].filename));
}

export async function buildReleaseArtifacts({
  outputRoot = path.join(defaultRepositoryRoot, 'dist'),
  repositoryRoot = defaultRepositoryRoot,
} = {}) {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const resolvedOutputRoot = path.resolve(outputRoot);
  // 输出目录会被完整清理，必须先验证边界，并用标记证明已有内容归本脚本管理。
  await prepareOutputRoot(resolvedOutputRoot, resolvedRepositoryRoot);

  const tarballPath = await runNpmPack(resolvedOutputRoot, resolvedRepositoryRoot);
  const digest = createHash('sha256').update(await readFile(tarballPath)).digest('hex');
  const checksumPath = `${tarballPath}.sha256`;
  await writeFile(checksumPath, `${digest}  ${path.basename(tarballPath)}\n`, 'utf8');
  return { tarballPath, checksumPath, digest };
}

function parseArgs(argv) {
  let outputRoot = path.join(defaultRepositoryRoot, 'dist');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--output') throw new Error(`Unknown release-pack option: ${argv[index]}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('--output requires a value');
    outputRoot = value;
    index += 1;
  }
  return { outputRoot };
}

export async function main({ argv = process.argv.slice(2), stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const result = await buildReleaseArtifacts(parseArgs(argv));
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const isEntryPoint = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntryPoint) process.exitCode = await main();
