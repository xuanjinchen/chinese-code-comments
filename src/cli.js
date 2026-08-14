import os from 'node:os';
import { createRequire } from 'node:module';

import { doctor } from './doctor.js';
import { install } from './install.js';
import { uninstall } from './uninstall.js';

const COMMANDS = new Set(['install', 'uninstall', 'doctor']);
const VERSION = createRequire(import.meta.url)('../package.json').version;

const HELP = `Chinese Code Comments

Usage:
  chinese-code-comments install [--agent <ids>]
  chinese-code-comments uninstall [--agent <ids>]
  chinese-code-comments doctor [--agent <ids>]
  chinese-code-comments --help
  chinese-code-comments --version

Options:
  --agent <ids>  Comma-separated agent ids; may be repeated. Defaults to all.
`;

export function parseArgs(argv) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return { command: 'help', agents: null };
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    return { command: 'version', agents: null };
  }

  const command = argv[0];
  if (!COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  const agents = [];
  const seen = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index];
    if (option !== '--agent') {
      throw new Error(`Unknown option: ${option}`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error('--agent requires at least one agent id');
    }
    index += 1;

    const ids = value.split(',').map((id) => id.trim());
    if (ids.every((id) => id.length === 0)) {
      throw new Error('--agent requires at least one agent id');
    }
    if (ids.some((id) => id.length === 0)) {
      throw new Error('--agent contains an empty agent id');
    }
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        agents.push(id);
      }
    }
  }

  return { command, agents: agents.length === 0 ? null : agents };
}

export function resolveHome(env, platform = process.platform) {
  const configured = platform === 'win32'
    ? env.USERPROFILE || env.HOME
    : env.HOME || env.USERPROFILE;
  return configured || os.homedir();
}

function runtimeContext(env) {
  return {
    home: resolveHome(env),
    env,
    platform: process.platform,
  };
}

export async function main({ argv, env, stdout, stderr, handlers }) {
  const parsed = parseArgs(argv);
  if (parsed.command === 'help') {
    stdout.write(HELP);
    return 0;
  }
  if (parsed.command === 'version') {
    stdout.write(`${VERSION}\n`);
    return 0;
  }

  const defaultHandlers = {
    async install({ agents }) {
      const result = await install({ agents, context: runtimeContext(env) });
      stdout.write(`Installed agents: ${result.agents.join(', ')}\n`);
      for (const group of result.storageGroups) {
        stdout.write(`Installed Skill group: ${group}\n`);
      }
      for (const policy of result.policies) {
        stdout.write(`Updated policy: ${policy}\n`);
      }
      for (const warning of result.warnings) {
        stderr.write(`WARNING: ${warning}\n`);
      }
      return 0;
    },
    async uninstall({ agents }) {
      const result = await uninstall({ agents, context: runtimeContext(env) });
      stdout.write(`Uninstalled agents: ${result.agents.join(', ')}\n`);
      for (const warning of result.warnings) {
        stderr.write(`WARNING: ${warning}\n`);
      }
      return 0;
    },
    async doctor({ agents }) {
      const result = await doctor({ agents, context: runtimeContext(env) });
      for (const check of result.checks) {
        stdout.write(`${check.agent}\t${check.subject}\t${check.status}\t${check.path}\t${check.message}\n`);
      }
      return result.healthy ? 0 : 1;
    },
  };
  const handler = handlers === undefined
    ? defaultHandlers[parsed.command]
    : handlers[parsed.command];
  if (typeof handler !== 'function') {
    stderr.write(`Command is not implemented yet: ${parsed.command}\n`);
    return 1;
  }
  return handler(parsed);
}
