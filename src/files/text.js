const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function newTextMetadata() {
  return { bom: false, eol: '\n', finalNewline: true };
}

export function decodeText(buffer, label) {
  if (
    buffer.length >= 2
    && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))
  ) {
    throw new Error(`${label} must use valid UTF-8; UTF-16 is not supported`);
  }
  if (buffer.includes(0)) {
    throw new Error(`${label} contains NUL bytes and cannot be updated safely`);
  }

  const bom = buffer.subarray(0, 3).equals(UTF8_BOM);
  const payload = bom ? buffer.subarray(3) : buffer;
  let text;
  try {
    // fatal 模式禁止损坏字节被替换成 U+FFFD，避免安装器静默改写用户规则。
    text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
  } catch (error) {
    throw new Error(`${label} must use valid UTF-8`, { cause: error });
  }

  const crlfCount = (text.match(/\r\n/g) ?? []).length;
  const lfCount = (text.match(/\n/g) ?? []).length - crlfCount;
  return {
    text,
    bom,
    eol: crlfCount > lfCount ? '\r\n' : '\n',
    finalNewline: /(?:\r\n|\n)$/.test(text),
  };
}

export function encodeText(text, metadata) {
  const payload = Buffer.from(text, 'utf8');
  return metadata.bom ? Buffer.concat([UTF8_BOM, payload]) : payload;
}
