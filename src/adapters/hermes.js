import path from 'node:path';

import { VISIBLE_MARKERS } from '../policies/render.js';

function pathFor(context) {
  return context.platform === 'win32' ? path.win32 : path.posix;
}

function hermesRoot(context) {
  return context.env.HERMES_HOME || pathFor(context).join(context.home, '.hermes');
}

export default Object.freeze({
  id: 'hermes',
  aliases: Object.freeze(['hermes-agent', 'hermes-cli']),
  storageGroup: 'hermes',
  skillRoot(context) {
    return pathFor(context).join(hermesRoot(context), 'skills');
  },
  policyFile(context) {
    return pathFor(context).join(hermesRoot(context), 'SOUL.md');
  },
  invocation: 'the skill named chinese-code-comments',
  markers: VISIBLE_MARKERS,
});
