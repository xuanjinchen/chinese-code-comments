import path from 'node:path';

import { HTML_MARKERS } from '../policies/render.js';

function pathFor(context) {
  return context.platform === 'win32' ? path.win32 : path.posix;
}

export default Object.freeze({
  id: 'opencode',
  aliases: Object.freeze(['open-code']),
  storageGroup: 'agents',
  skillRoot(context) {
    return pathFor(context).join(context.home, '.agents', 'skills');
  },
  policyFile(context) {
    const root = context.env.XDG_CONFIG_HOME || pathFor(context).join(context.home, '.config');
    return pathFor(context).join(root, 'opencode', 'AGENTS.md');
  },
  invocation: 'the skill named chinese-code-comments',
  markers: HTML_MARKERS,
});
