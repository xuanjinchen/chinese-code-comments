import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeText, encodeText, newTextMetadata } from '../../src/files/text.js';

test('UTF-8 BOM and CRLF metadata round-trip byte-for-byte', () => {
  const input = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('用户规则\r\n', 'utf8'),
  ]);

  const decoded = decodeText(input, 'rules');

  assert.equal(decoded.bom, true);
  assert.equal(decoded.eol, '\r\n');
  assert.equal(decoded.finalNewline, true);
  assert.deepEqual(encodeText(decoded.text, decoded), input);
});

test('new files use UTF-8 without BOM and LF', () => {
  const metadata = newTextMetadata();
  assert.deepEqual(metadata, { bom: false, eol: '\n', finalNewline: true });
  assert.equal(encodeText('规则\n', metadata).toString('hex'), Buffer.from('规则\n').toString('hex'));
});

test('UTF-16, NUL, and malformed UTF-8 are rejected', () => {
  assert.throws(() => decodeText(Buffer.from([0xff, 0xfe, 0x41, 0x00]), 'rules'), /UTF-16/);
  assert.throws(() => decodeText(Buffer.from([0x61, 0x00, 0x62]), 'rules'), /NUL/);
  assert.throws(() => decodeText(Buffer.from([0xc3, 0x28]), 'rules'), /valid UTF-8/);
});

test('dominant existing newline style is detected without rewriting text', () => {
  const text = 'a\r\nb\r\nc\nd';
  const decoded = decodeText(Buffer.from(text), 'rules');
  assert.equal(decoded.eol, '\r\n');
  assert.equal(decoded.text, text);
  assert.equal(decoded.finalNewline, false);
});
