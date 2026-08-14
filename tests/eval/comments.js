const PROFILES = {
  c: { slash: true, block: true },
  cpp: { slash: true, block: true },
  java: { slash: true, block: true },
  javascript: { slash: true, block: true, backtick: true },
  typescript: { slash: true, block: true, backtick: true },
  python: { hash: true, docstrings: true },
  sql: { dash: true, block: true },
  terraform: { slash: true, hash: true, block: true },
  json: {},
};

const ALIASES = {
  'c++': 'cpp',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  ts: 'typescript',
  tsx: 'typescript',
  hcl: 'terraform',
};

function profileFor(language) {
  const normalized = String(language).toLowerCase();
  return PROFILES[ALIASES[normalized] ?? normalized] ?? PROFILES.javascript;
}

function cleanComment(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

export function extractComments(language, code) {
  const profile = profileFor(language);
  const comments = [];
  let index = 0;
  let state = 'code';
  let escaped = false;
  let buffer = '';
  let blockKind = 'block';
  let quote = '';

  const push = (kind) => {
    const text = cleanComment(buffer);
    if (text) comments.push({ text, kind });
    buffer = '';
  };

  // 状态机只启用目标语言支持的语法，避免把字符串、整除或预处理符误判为注释。
  while (index < code.length) {
    const current = code[index];
    const next = code[index + 1] ?? '';

    if (state === 'code') {
      const triple = code.slice(index, index + 3);
      if (profile.docstrings && (triple === '"""' || triple === "'''")) {
        state = 'docstring';
        quote = triple;
        buffer = '';
        index += 3;
        continue;
      }
      if (profile.slash && current === '/' && next === '/') {
        state = 'line';
        buffer = '';
        index += 2;
        continue;
      }
      if (profile.dash && current === '-' && next === '-') {
        state = 'line';
        buffer = '';
        index += 2;
        continue;
      }
      if (profile.block && current === '/' && next === '*') {
        blockKind = code[index + 2] === '*' ? 'doc' : 'block';
        state = 'block';
        buffer = '';
        index += blockKind === 'doc' ? 3 : 2;
        continue;
      }
      if (profile.hash && current === '#') {
        state = 'line';
        buffer = '';
        index += 1;
        continue;
      }
      if (current === '"' || current === "'" || (profile.backtick && current === '`')) {
        state = 'string';
        quote = current;
        escaped = false;
      }
      index += 1;
      continue;
    }

    if (state === 'line') {
      if (current === '\r' || current === '\n') {
        push('line');
        state = 'code';
      } else {
        buffer += current;
      }
      index += 1;
      continue;
    }

    if (state === 'block') {
      if (current === '*' && next === '/') {
        push(blockKind);
        state = 'code';
        index += 2;
      } else {
        buffer += current;
        index += 1;
      }
      continue;
    }

    if (state === 'docstring') {
      if (code.slice(index, index + 3) === quote) {
        push('doc');
        state = 'code';
        index += 3;
      } else {
        buffer += current;
        index += 1;
      }
      continue;
    }

    if (escaped) {
      escaped = false;
    } else if (current === '\\') {
      escaped = true;
    } else if (current === quote) {
      state = 'code';
    }
    index += 1;
  }

  if (state === 'line') push('line');
  return comments;
}
