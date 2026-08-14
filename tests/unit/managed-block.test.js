import assert from 'node:assert/strict';
import test from 'node:test';

import { removeManagedBlock, upsertManagedBlock } from '../../src/files/managed-block.js';

const markers = {
  start: '<!-- chinese-code-comments:start -->',
  end: '<!-- chinese-code-comments:end -->',
};
const block = `${markers.start}\npolicy\n${markers.end}`;

test('a new block preserves existing text as an exact prefix', () => {
  const current = '用户规则\r\n';
  const rendered = block.replaceAll('\n', '\r\n');
  const next = upsertManagedBlock(current, rendered, markers);

  assert.equal(next, `${current}\r\n\r\n${rendered}\r\n`);
});

test('a valid block is replaced without changing surrounding text', () => {
  const current = `before\n${markers.start}\nold\n${markers.end}\nafter`;
  const next = upsertManagedBlock(current, block, markers);
  assert.equal(next, `before\n${block}\nafter`);
});

test('removal deletes the separator introduced by insertion', () => {
  const current = 'before\n';
  const installed = upsertManagedBlock(current, block, markers);
  assert.deepEqual(removeManagedBlock(installed, markers), { text: current, removed: true });
});

test('removing the only managed block yields an empty file', () => {
  const installed = upsertManagedBlock('', block, markers);
  assert.deepEqual(removeManagedBlock(installed, markers), { text: '', removed: true });
});

test('missing blocks are an idempotent no-op', () => {
  assert.deepEqual(removeManagedBlock('user text\n', markers), {
    text: 'user text\n',
    removed: false,
  });
});

for (const [name, current] of [
  ['missing end', `${markers.start}\npolicy`],
  ['missing start', `policy\n${markers.end}`],
  ['duplicate start', `${markers.start}\n${markers.start}\n${markers.end}`],
  ['duplicate end', `${markers.start}\n${markers.end}\n${markers.end}`],
  ['reversed markers', `${markers.end}\n${markers.start}`],
]) {
  test(`${name} is rejected`, () => {
    assert.throws(() => upsertManagedBlock(current, block, markers), /chinese-code-comments block/);
  });
}
