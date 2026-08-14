import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function createHomeFixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'chinese-code-comments-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return {
    home,
    context: { home, env: {}, platform: process.platform },
    path(relative) {
      return path.join(home, ...relative.split('/'));
    },
    async exists(relative) {
      try {
        await lstat(this.path(relative));
        return true;
      } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
      }
    },
    async read(relative, encoding = 'utf8') {
      return readFile(this.path(relative), encoding);
    },
    async write(relative, content) {
      const target = this.path(relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    },
    async snapshot() {
      const result = {};
      async function walk(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const absolute = path.join(directory, entry.name);
          if (entry.isDirectory()) await walk(absolute);
          else result[path.relative(home, absolute)] = (await readFile(absolute)).toString('base64');
        }
      }
      await walk(home);
      return result;
    },
  };
}
