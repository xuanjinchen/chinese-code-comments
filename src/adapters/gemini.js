import path from 'node:path';

import { HTML_MARKERS } from '../policies/render.js';

function pathFor(context) {
  return context.platform === 'win32' ? path.win32 : path.posix;
}

export default Object.freeze({
  id: 'gemini',
  aliases: Object.freeze(['gemini-cli']),
  storageGroup: 'agents',
  skillRoot(context) {
    return pathFor(context).join(context.home, '.agents', 'skills');
  },
  policyFile(context) {
    const root = context.env.GEMINI_CLI_HOME || pathFor(context).join(context.home, '.gemini');
    return pathFor(context).join(root, 'GEMINI.md');
  },
  invocation: 'the skill named chinese-code-comments',
  markers: HTML_MARKERS,
});
