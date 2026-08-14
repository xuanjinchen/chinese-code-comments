import path from 'node:path';

import { HTML_MARKERS } from '../policies/render.js';

function pathFor(context) {
  return context.platform === 'win32' ? path.win32 : path.posix;
}

export default Object.freeze({
  id: 'grok',
  aliases: Object.freeze(['grok-cli', 'xai-grok']),
  storageGroup: 'agents',
  skillRoot(context) {
    return pathFor(context).join(context.home, '.agents', 'skills');
  },
  policyFile(context) {
    const root = context.env.GROK_HOME || pathFor(context).join(context.home, '.grok');
    return pathFor(context).join(root, 'AGENTS.md');
  },
  invocation: 'the skill named chinese-code-comments',
  markers: HTML_MARKERS,
});
