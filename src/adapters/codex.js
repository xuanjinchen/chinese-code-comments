import path from 'node:path';

import { HTML_MARKERS } from '../policies/render.js';

function pathFor(context) {
  return context.platform === 'win32' ? path.win32 : path.posix;
}

export default Object.freeze({
  id: 'codex',
  aliases: Object.freeze(['openai-codex']),
  storageGroup: 'agents',
  skillRoot(context) {
    return pathFor(context).join(context.home, '.agents', 'skills');
  },
  policyFile(context) {
    const root = context.env.CODEX_HOME || pathFor(context).join(context.home, '.codex');
    return pathFor(context).join(root, 'AGENTS.md');
  },
  invocation: '$chinese-code-comments',
  markers: HTML_MARKERS,
});
