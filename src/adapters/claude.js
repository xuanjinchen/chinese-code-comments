import path from 'node:path';

import { HTML_MARKERS } from '../policies/render.js';

function pathFor(context) {
  return context.platform === 'win32' ? path.win32 : path.posix;
}

function configRoot(context) {
  return context.env.CLAUDE_CONFIG_DIR || pathFor(context).join(context.home, '.claude');
}

export default Object.freeze({
  id: 'claude',
  aliases: Object.freeze(['claude-code']),
  storageGroup: 'claude',
  skillRoot(context) {
    return pathFor(context).join(configRoot(context), 'skills');
  },
  policyFile(context) {
    return pathFor(context).join(configRoot(context), 'CLAUDE.md');
  },
  invocation: 'the skill named chinese-code-comments',
  markers: HTML_MARKERS,
});
