function countLiteral(text, value) {
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(value, offset)) !== -1) {
    count += 1;
    offset += value.length;
  }
  return count;
}

function locateBlock(text, markers) {
  const startCount = countLiteral(text, markers.start);
  const endCount = countLiteral(text, markers.end);
  if ((startCount === 0) !== (endCount === 0)) {
    throw new Error('Global rules contain an incomplete chinese-code-comments block');
  }
  if (startCount > 1 || endCount > 1) {
    throw new Error('Global rules contain a duplicate chinese-code-comments block');
  }
  if (startCount === 0) {
    return null;
  }

  const start = text.indexOf(markers.start);
  const end = text.indexOf(markers.end);
  if (end < start) {
    throw new Error('Global rules contain a chinese-code-comments block with reversed markers');
  }
  return { start, end: end + markers.end.length };
}

function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function withoutTerminalNewlines(text) {
  return text.replace(/(?:\r\n|\n)+$/, '');
}

export function upsertManagedBlock(current, block, markers) {
  const location = locateBlock(current, markers);
  if (location) {
    return current.slice(0, location.start) + withoutTerminalNewlines(block) + current.slice(location.end);
  }

  const eol = detectEol(block || current);
  const normalizedBlock = withoutTerminalNewlines(block);
  if (current.length === 0) {
    return normalizedBlock + eol;
  }

  // 固定插入两个换行作为托管分隔符，卸载时可精确移除而不猜测用户原有尾部格式。
  const preserveFinalNewline = /(?:\r\n|\n)$/.test(current);
  return current + eol + eol + normalizedBlock + (preserveFinalNewline ? eol : '');
}

export function removeManagedBlock(current, markers) {
  const location = locateBlock(current, markers);
  if (!location) {
    return { text: current, removed: false };
  }

  const eol = detectEol(current.slice(location.start, location.end));
  let before = current.slice(0, location.start);
  let after = current.slice(location.end);
  if (after === '' || after === eol) {
    const separator = eol + eol;
    if (before.endsWith(separator)) {
      before = before.slice(0, -separator.length);
    }
    after = '';
  }
  return { text: before + after, removed: true };
}
