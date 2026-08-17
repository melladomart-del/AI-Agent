'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMessage } = require('../src/providers/tool-normalize');

const KNOWN = new Set(['readFile', 'writeFile', 'editFile', 'finish']);

function callName(msg) {
  return msg.tool_calls && msg.tool_calls[0] && msg.tool_calls[0].function.name;
}
function callArgs(msg) {
  return JSON.parse(msg.tool_calls[0].function.arguments);
}

test('normalize: native tool_calls pass through and are cleaned', () => {
  const out = normalizeMessage({
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'x1', type: 'function', function: { name: 'readFile', arguments: '{"path":"a.js"}' } }],
  }, { knownNames: KNOWN });
  assert.equal(callName(out), 'readFile');
  assert.deepEqual(callArgs(out), { path: 'a.js' });
  assert.equal(out.tool_calls[0].id, 'x1');
});

test('normalize: native arguments given as object are stringified', () => {
  const out = normalizeMessage({
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'x2', function: { name: 'writeFile', arguments: { path: 'b.js', content: 'x' } } }],
  }, { knownNames: KNOWN });
  assert.equal(callName(out), 'writeFile');
  assert.deepEqual(callArgs(out), { path: 'b.js', content: 'x' });
});

test('normalize: fenced JSON tool call in content becomes tool_calls', () => {
  const out = normalizeMessage({
    role: 'assistant',
    content: 'I will read the file.\n```json\n{"name":"readFile","arguments":{"path":"src/app.js"}}\n```',
  }, { knownNames: KNOWN });
  assert.equal(callName(out), 'readFile');
  assert.deepEqual(callArgs(out), { path: 'src/app.js' });
});

test('normalize: bare JSON object content becomes a tool call', () => {
  const out = normalizeMessage({
    role: 'assistant',
    content: '{"name":"finish","arguments":{"summary":"done"}}',
  }, { knownNames: KNOWN });
  assert.equal(callName(out), 'finish');
  assert.deepEqual(callArgs(out), { summary: 'done' });
});

test('normalize: HTTP-style tool_call tag wrapping JSON is parsed', () => {
  const open = '<' + 'tool_call' + '>';
  const close = '</' + 'tool_call' + '>';
  const out = normalizeMessage({
    role: 'assistant',
    content: `${open}\n{"name":"editFile","arguments":{"path":"c.js","oldStr":"a","newStr":"b"}}\n${close}`,
  }, { knownNames: KNOWN });
  assert.equal(callName(out), 'editFile');
  assert.deepEqual(callArgs(out), { path: 'c.js', oldStr: 'a', newStr: 'b' });
});

test('normalize: accepts {tool,input} and {function,parameters} spellings', () => {
  const a = normalizeMessage({ role: 'assistant', content: '{"tool":"readFile","input":{"path":"x"}}' }, { knownNames: KNOWN });
  assert.equal(callName(a), 'readFile');
  assert.deepEqual(callArgs(a), { path: 'x' });

  const b = normalizeMessage({ role: 'assistant', content: '{"function":"writeFile","parameters":{"path":"y","content":"z"}}' }, { knownNames: KNOWN });
  assert.equal(callName(b), 'writeFile');
  assert.deepEqual(callArgs(b), { path: 'y', content: 'z' });
});

test('normalize: arguments echoed as JSON string are parsed into an object', () => {
  const out = normalizeMessage({
    role: 'assistant',
    content: '{"name":"readFile","arguments":"{\\"path\\":\\"z.js\\"}"}',
  }, { knownNames: KNOWN });
  assert.equal(callName(out), 'readFile');
  assert.deepEqual(callArgs(out), { path: 'z.js' });
});

test('normalize: plain prose with no tool call returns empty tool_calls', () => {
  const out = normalizeMessage({ role: 'assistant', content: 'You should fix the bug in app.js by editing line 5.' }, { knownNames: KNOWN });
  assert.equal(out.tool_calls.length, 0);
  assert.match(out.content, /fix the bug/);
});

test('normalize: unknown tool name is rejected when knownNames provided', () => {
  const out = normalizeMessage({ role: 'assistant', content: '{"name":"deleteEverything","arguments":{}}' }, { knownNames: KNOWN });
  assert.equal(out.tool_calls.length, 0, 'unknown tool must not become a call');
});

test('normalize: malformed JSON in fence yields no tool call (no throw)', () => {
  const out = normalizeMessage({ role: 'assistant', content: '```json\n{name: readFile, args:}\n```' }, { knownNames: KNOWN });
  assert.equal(out.tool_calls.length, 0);
});

test('normalize: array of tool calls is expanded', () => {
  const out = normalizeMessage({
    role: 'assistant',
    content: '```json\n[{"name":"readFile","arguments":{"path":"a"}},{"name":"finish","arguments":{"summary":"ok"}}]\n```',
  }, { knownNames: KNOWN });
  assert.equal(out.tool_calls.length, 2);
  assert.equal(out.tool_calls[0].function.name, 'readFile');
  assert.equal(out.tool_calls[1].function.name, 'finish');
});

test('normalize: empty content returns empty tool_calls', () => {
  const out = normalizeMessage({ role: 'assistant', content: '' });
  assert.equal(out.tool_calls.length, 0);
});

test('normalize: missing id is generated for native calls', () => {
  const out = normalizeMessage({
    role: 'assistant', content: null,
    tool_calls: [{ type: 'function', function: { name: 'finish', arguments: '{"summary":"x"}' } }],
  }, { knownNames: KNOWN });
  assert.ok(out.tool_calls[0].id, 'id should be generated');
});
