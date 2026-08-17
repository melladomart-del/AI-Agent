'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _applyEdit } = require('../src/tools/files');

const FILE = 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n';

test('applyEdit: exact match replaces once', () => {
  const r = _applyEdit(FILE, 'return a - b;', 'return a + b;');
  assert.ok(r.updated);
  assert.ok(!r.updated.includes('a - b'));
  assert.ok(r.updated.includes('a + b'));
});

test('applyEdit: multiple matches returns an error', () => {
  const r = _applyEdit('a\na\n', 'a', 'b');
  assert.ok(r.error && /multiple/i.test(r.error));
});

test('applyEdit: literal backslash-n in oldStr is relaxed to a real newline', () => {
  // Small model emits oldStr with literal "\n" (backslash + n) instead of newline.
  const r = _applyEdit(FILE, 'function add(a, b) {\\n  return a - b;', 'function add(a, b) {\\n  return a + b;');
  assert.ok(r.updated, 'should match via lenient fallback');
  assert.ok(r.updated.includes('return a + b;'));
  assert.ok(!r.updated.includes('return a - b;'));
});

test('applyEdit: literal escapes in newStr become real whitespace (lenient path)', () => {
  // Both oldStr and newStr use literal "\n" (backslash + n), as small models do.
  const r = _applyEdit(FILE, 'function add(a, b) {\\n  return a - b;', 'function add(a, b) {\\n  return a + b;\\n');
  assert.ok(r.updated, 'should match via lenient fallback');
  assert.ok(r.updated.includes('return a + b;\n'), 'newStr literal \\n should become a real newline');
  assert.ok(!r.updated.includes('return a - b;'));
});

test('applyEdit: no match and no escapes -> clean error', () => {
  const r = _applyEdit(FILE, 'no-such-text-here', 'x');
  assert.equal(r.error, 'oldStr not found');
});

test('applyEdit: non-string args -> clean error', () => {
  const r = _applyEdit(FILE, null, 'x');
  assert.ok(r.error);
});

test('applyEdit: whitespace-normalized fallback matches a single-line rendering of a multi-line block', () => {
  // Small model collapses the multi-line function to one line in oldStr.
  const r = _applyEdit(FILE, 'function add(a, b) { return a - b; }', 'function add(a, b) { return a + b; }');
  assert.ok(r.updated, 'normalized fallback should match the multi-line span');
  assert.ok(r.updated.includes('return a + b;'));
  assert.ok(!r.updated.includes('return a - b;'));
  assert.match(r.updated, /module\.exports = \{ add \}/, 'rest of file is preserved');
});

test('applyEdit: normalized fallback reports multiple matches when ambiguous', () => {
  const dup = 'foo bar\nfoo bar\n';
  const r = _applyEdit(dup, 'foo bar', 'baz');
  assert.ok(r.error && /multiple/i.test(r.error), 'ambiguous normalized match should be rejected');
});
