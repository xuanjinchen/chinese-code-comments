const LANGUAGE_PROFILES = {
  python: { hash: true, triple: true },
  sql: { dash: true, block: true },
  terraform: { hash: true, slash: true, block: true },
  c: { slash: true, block: true },
  cpp: { slash: true, block: true },
  java: { slash: true, block: true },
  javascript: { slash: true, block: true, backtick: true },
  typescript: { slash: true, block: true, backtick: true },
};

const ALIASES = { 'c++': 'cpp', py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', hcl: 'terraform' };

function profileFor(language) {
  const normalized = String(language).toLowerCase();
  return LANGUAGE_PROFILES[ALIASES[normalized] ?? normalized] ?? LANGUAGE_PROFILES.javascript;
}

export function codeOnly(language, code) {
  const profile = profileFor(language);
  let result = '';
  let state = 'code';
  let quote = '';
  let escaped = false;

  // 保留换行和分隔符位置，只屏蔽注释与字符串，供后续控制流和配对检查使用。
  for (let index = 0; index < code.length; index += 1) {
    const current = code[index];
    const next = code[index + 1] ?? '';
    const triple = code.slice(index, index + 3);

    if (state === 'code') {
      if (profile.triple && (triple === '"""' || triple === "'''")) {
        result += '   ';
        state = 'triple';
        quote = triple;
        index += 2;
      } else if (profile.slash && current === '/' && next === '/') {
        result += '  ';
        state = 'line';
        index += 1;
      } else if (profile.dash && current === '-' && next === '-') {
        result += '  ';
        state = 'line';
        index += 1;
      } else if (profile.block && current === '/' && next === '*') {
        result += '  ';
        state = 'block';
        index += 1;
      } else if (profile.hash && current === '#') {
        result += ' ';
        state = 'line';
      } else if (current === '"' || current === "'" || (profile.backtick && current === '`')) {
        result += ' ';
        state = 'string';
        quote = current;
        escaped = false;
      } else {
        result += current;
      }
      continue;
    }

    if (state === 'line') {
      if (current === '\r' || current === '\n') {
        result += current;
        state = 'code';
      } else {
        result += ' ';
      }
      continue;
    }

    if (state === 'block') {
      if (current === '*' && next === '/') {
        result += '  ';
        state = 'code';
        index += 1;
      } else {
        result += current === '\r' || current === '\n' ? current : ' ';
      }
      continue;
    }

    if (state === 'triple') {
      if (triple === quote) {
        result += '   ';
        state = 'code';
        index += 2;
      } else {
        result += current === '\r' || current === '\n' ? current : ' ';
      }
      continue;
    }

    result += current === '\r' || current === '\n' ? current : ' ';
    if (escaped) escaped = false;
    else if (current === '\\') escaped = true;
    else if (current === quote) state = 'code';
  }

  return { code: result, closed: state === 'code' || state === 'line' };
}

export function isStructurallyValid(language, code) {
  if (typeof code !== 'string' || !code.trim()) return false;
  const { code: visibleCode, closed } = codeOnly(language, code);
  if (!closed) return false;

  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (const character of visibleCode) {
    if ('([{'.includes(character)) stack.push(character);
    else if (pairs[character] && stack.pop() !== pairs[character]) return false;
  }
  if (stack.length > 0) return false;

  if (['python', 'py'].includes(String(language).toLowerCase())) {
    for (const line of visibleCode.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (/^(?:async\s+)?def\b/.test(trimmed) && !trimmed.includes(':')) return false;
      if (/^(?:if|elif|else|for|while|try|except|finally|with)\b/.test(trimmed) && !trimmed.includes(':')) return false;
    }
  }
  return true;
}
