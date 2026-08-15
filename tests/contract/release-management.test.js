import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), 'utf8'));
}

test('Release Please 与当前包版本保持一致', async () => {
  const [config, manifest, packageJson] = await Promise.all([
    readJson('release-please-config.json'),
    readJson('.release-please-manifest.json'),
    readJson('package.json'),
  ]);
  const rootPackage = config.packages?.['.'];

  assert.equal(rootPackage?.['release-type'], 'node');
  assert.equal(rootPackage?.['include-v-in-tag'], true);
  assert.equal(rootPackage?.['include-v-in-release-name'], true);
  assert.equal(rootPackage?.['include-component-in-tag'], false);
  assert.deepEqual(rootPackage?.['extra-files'], ['README.md']);
  assert.equal(manifest['.'], packageJson.version);
});

test('CHANGELOG 记录当前正式版本的发布信息', async () => {
  const changelog = await readFile(path.join(repositoryRoot, 'CHANGELOG.md'), 'utf8');

  assert.match(changelog, /^# Changelog$/mu);
  assert.match(changelog, /^## \[0\.1\.0\]/mu);
  assert.match(changelog, /Codex|Claude Code|Gemini CLI/u);
  assert.match(changelog, /安装|卸载/u);
  assert.match(changelog, /注释/u);
});

test('发布脚本生成 tarball 和匹配的 SHA-256', async (t) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'ccc-release-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const packageJson = await readJson('package.json');
  const expectedTarball = `${packageJson.name}-${packageJson.version}.tgz`;
  const { buildReleaseArtifacts } = await import('../../scripts/release-pack.js');

  const result = await buildReleaseArtifacts({ outputRoot });
  const tarball = await readFile(result.tarballPath);
  const expectedDigest = createHash('sha256').update(tarball).digest('hex');

  assert.equal(path.basename(result.tarballPath), expectedTarball);
  assert.equal(result.digest, expectedDigest);
  assert.equal(
    await readFile(result.checksumPath, 'utf8'),
    `${expectedDigest}  ${path.basename(result.tarballPath)}\n`,
  );
});

test('发布脚本拒绝清理仓库根目录', async () => {
  const { buildReleaseArtifacts } = await import('../../scripts/release-pack.js');

  await assert.rejects(
    buildReleaseArtifacts({ outputRoot: repositoryRoot }),
    /output directory must not be the repository or filesystem root/i,
  );
});

test('发布脚本拒绝清理未受管的非空目录', async (t) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'ccc-unmanaged-'));
  const sentinelPath = path.join(outputRoot, 'keep.txt');
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  await writeFile(sentinelPath, 'keep', 'utf8');
  const { buildReleaseArtifacts } = await import('../../scripts/release-pack.js');

  await assert.rejects(
    buildReleaseArtifacts({ outputRoot }),
    /refusing to clear an unmanaged non-empty release directory/i,
  );
  assert.equal(await readFile(sentinelPath, 'utf8'), 'keep');
});

test('Release 工作流幂等创建版本并上传两个资产', async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, '.github', 'workflows', 'release.yml'),
    'utf8',
  );

  assert.match(workflow, /push:\s*\r?\n\s+branches:\s*\[main\]/u);
  assert.match(workflow, /contents:\s*write/u);
  assert.match(workflow, /pull-requests:\s*write/u);
  assert.match(workflow, /issues:\s*write/u);
  assert.match(workflow, /group:\s*release-\$\{\{ github\.repository \}\}/u);
  assert.match(workflow, /cancel-in-progress:\s*false/u);
  assert.match(workflow, /actions\/github-script@[0-9a-f]{40}\s+# v7/u);
  assert.match(workflow, /refs\/tags\/v0\.1\.0/u);
  assert.match(workflow, /getReleaseByTag/u);
  assert.match(workflow, /release_tag/u);
  assert.match(workflow, /googleapis\/release-please-action@[0-9a-f]{40}\s+# v4/u);
  assert.match(workflow, /config-file:\s*release-please-config\.json/u);
  assert.match(workflow, /manifest-file:\s*\.release-please-manifest\.json/u);
  assert.doesNotMatch(workflow, /^\s+release-type:/mu);
  assert.match(workflow, /RELEASE_PLEASE_TOKEN/u);
  assert.match(workflow, /github\.token/u);
  assert.match(workflow, /npm run release:pack/u);
  assert.match(workflow, /softprops\/action-gh-release@[0-9a-f]{40}\s+# v2/u);
  assert.match(workflow, /steps\.release\.outputs\.tag_name/u);
  assert.match(workflow, /source_ref', `refs\/tags\/\$\{tagName\}`/u);
  assert.match(
    workflow,
    /ref:\s*refs\/tags\/\$\{\{ steps\.release\.outputs\.tag_name \}\}/u,
  );
  assert.match(workflow, /Repair existing release assets/u);
  assert.match(workflow, /expectedTag/u);
  assert.match(workflow, /overwrite_files:\s*true/u);
  assert.match(workflow, /dist\/\*\.tgz/u);
  assert.match(workflow, /dist\/\*\.sha256/u);
  assert.doesNotMatch(workflow, /npm publish/u);
});

test('GitHub Actions 全部固定不可变的提交 SHA', async () => {
  const workflowDirectory = path.join(repositoryRoot, '.github', 'workflows');
  const workflowPaths = (await readdir(workflowDirectory))
    .filter((file) => /\.ya?ml$/u.test(file))
    .map((file) => path.join('.github', 'workflows', file));

  for (const workflowPath of workflowPaths) {
    const workflow = await readFile(path.join(repositoryRoot, workflowPath), 'utf8');
    const actionLines = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+).*$/gmu)];

    assert.ok(actionLines.length > 0, `${workflowPath} must use at least one action`);
    for (const [, reference] of actionLines) {
      if (reference.startsWith('./')) continue;
      assert.match(
        reference,
        /^[^@\s]+@[0-9a-f]{40}$/u,
        `${workflowPath} must pin ${reference} to a full commit SHA`,
      );
    }
  }
});

test('Dependabot 覆盖仓库实际供应链', async () => {
  const dependabot = await readFile(
    path.join(repositoryRoot, '.github', 'dependabot.yml'),
    'utf8',
  );

  assert.match(dependabot, /package-ecosystem:\s*github-actions/u);
  assert.match(dependabot, /package-ecosystem:\s*npm/u);
});

test('README 说明统一版本维护流程', async () => {
  const readme = await readFile(path.join(repositoryRoot, 'README.md'), 'utf8');

  assert.match(readme, /版本发布/u);
  assert.match(readme, /Conventional Commits/u);
  assert.match(readme, /RELEASE_PLEASE_TOKEN/u);
  assert.match(readme, /Release PR/u);
  assert.match(readme, /npm run release:pack/u);
  assert.match(readme, /不发布到 npm Registry/u);
  assert.match(readme, /x-release-please-start-version/u);
  assert.match(readme, /x-release-please-end/u);
});
