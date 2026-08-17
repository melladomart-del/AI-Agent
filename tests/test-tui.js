'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventBus } = require('../src/engine/event-bus');
const { TUI } = require('../src/tui/tui');
const R = require('../src/tui/render');

// A writable stream that captures output for assertions.
class CaptureStream {
  constructor() { this.isTTY = false; this.chunks = []; }
  write(s) { this.chunks.push(s); return true; }
  toString() { return this.chunks.join(''); }
}

// Minimal fake orchestrator: a real EventBus plus stubs the TUI queries.
function fakeOrch({ reachable = true, model = 'qwen2.5-coder:1.5b', tasks = [] } = {}) {
  const bus = new EventBus();
  return {
    bus,
    config: { provider: 'local', local: { baseUrl: 'http://127.0.0.1:8080/v1', model }, cloud: {}, skillTopK: 4 },
    modelRouter: { isReachable: async () => ({ reachable, baseUrl: 'http://127.0.0.1:8080/v1', model }) },
    registry: { list: () => [{ name: 'listFiles', description: 'list files' }, { name: 'runTests', description: 'run tests' }] },
    memory: { load: () => tasks },
    contextSelector: {
      skills: {
        all: () => [{ name: 'react', title: 'React' }, { name: 'testing', title: 'Testing' }],
        _score: (task, s) => (task.includes(s.name) ? 1 : 0),
      },
    },
    // run() is replaced per-test to emit a scripted event sequence.
    run: async () => ({ ok: true, summary: '', verified: null }),
  };
}

function makeTUI(orch) {
  const out = new CaptureStream();
  const input = { on() {}, isTTY: false, destroy() {} };
  return { out, tui: new TUI(orch, { out, input }) };
}

// Drive a full run by emitting the canonical event sequence the engine sends.
function scriptedRun(orch, { passed = true, error = false } = {}) {
  return async (task) => {
    const b = orch.bus;
    b.emit('task:start', { task });
    b.emit('phase', { phase: 'SELECTING CONTEXT' });
    b.emit('phase', { phase: 'PLANNING' });
    b.emit('phase', { phase: 'EXECUTING' });
    b.emit('phase', { phase: 'THINKING', iteration: 1, maxIterations: 10 });
    b.emit('tool:call', { name: 'editFile', args: { path: 'engine/auth.js' } });
    b.emit('tool:result', { name: 'editFile', observation: 'Wrote 120 bytes to engine/auth.js' });
    b.emit('tool:call', { name: 'runTests', args: {} });
    b.emit('tool:result', { name: 'runTests', observation: '# pass 18\n# fail 0\n18 passed, 0 failures' });
    if (error) b.emit('error', { error: 'boom' });
    b.emit('phase', { phase: 'VERIFYING' });
    b.emit('verify:start', {});
    b.emit('verify:result', { passed });
    if (!passed) {
      b.emit('phase', { phase: 'CORRECTING' });
      b.emit('correct:start', { task });
      b.emit('correct:round', { attempt: 1, maxRetries: 3 });
      b.emit('correct:result', { fixed: false });
    }
    b.emit('memory:record', { result: passed ? 'passed' : 'failed' });
    b.emit('phase', { phase: passed ? 'COMPLETED' : 'FAILED' });
    b.emit('task:end', { task, result: { ok: true, verified: { passed } } });
    return { ok: true, summary: 'done', verified: { passed } };
  };
}

test('render helpers are pure and NO_COLOR-safe', () => {
  process.env.NO_COLOR = '1';
  const h = R.header({ provider: 'local', local: { baseUrl: 'http://127.0.0.1:8080/v1', model: 'q' }, cloud: {} });
  assert.match(h, /AI CODING AGENT/);
  assert.doesNotMatch(h, /\x1b\[/, 'no ANSI when NO_COLOR set');
  assert.match(R.modelUnavailable({ baseUrl: 'http://x' }), /LOCAL MODEL UNAVAILABLE/);
  assert.equal(R.parseTestSummary('18 passed, 0 failures').ok, true);
  assert.equal(R.parseTestSummary('# pass 2\n# fail 1').ok, false);
  assert.match(R.completionLine({ ok: true, verified: { passed: true } }), /completed successfully/);
  assert.match(R.completionLine({ ok: false }), /failed/);
  delete process.env.NO_COLOR;
});

test('TUI startup prints header and (when reachable) no unavailable banner', async () => {
  const orch = fakeOrch({ reachable: true });
  const { out, tui } = makeTUI(orch);
  // avoid readline blocking: call start but resolve the probe synchronously
  await tui.start().catch(() => {});
  const text = out.toString();
  assert.match(text, /AI CODING AGENT/);
  assert.doesNotMatch(text, /LOCAL MODEL UNAVAILABLE/);
  tui._cleanup();
});

test('TUI startup shows actionable unavailable banner when model is down', async () => {
  const orch = fakeOrch({ reachable: false });
  const { out, tui } = makeTUI(orch);
  await tui.start().catch(() => {});
  const text = out.toString();
  assert.match(text, /LOCAL MODEL UNAVAILABLE/);
  assert.match(text, /Start your local model server/);
  tui._cleanup();
});

test('task submission renders tool blocks, verification and completion', async () => {
  const orch = fakeOrch();
  orch.run = scriptedRun(orch, { passed: true });
  const { out, tui } = makeTUI(orch);
  tui._wireEvents();
  await tui._runTask('fix the auth bug');
  const text = out.toString();
  assert.match(text, /▶ editFile/);
  assert.match(text, /engine\/auth\.js/);
  assert.match(text, /18 passed, 0 failures/);
  assert.match(text, /completed successfully/);
});

test('failure path surfaces verification failure and correction rounds', async () => {
  const orch = fakeOrch();
  orch.run = scriptedRun(orch, { passed: false });
  const { out, tui } = makeTUI(orch);
  tui._wireEvents();
  await tui._runTask('fix the broken tests');
  const text = out.toString();
  assert.match(text, /TEST FAILURE/);
  assert.match(text, /Correction round 1 \/ 3/);
  assert.match(text, /Correction failed/);
});

test('event counters accumulate from real events (no faked progress)', async () => {
  const orch = fakeOrch();
  orch.run = scriptedRun(orch, { passed: true });
  const { tui } = makeTUI(orch);
  tui._wireEvents();
  await tui._runTask('t');
  assert.equal(tui.state.tools, 2, 'two tool calls counted');
  assert.equal(tui.state.files, 1, 'one file edit counted');
  assert.equal(tui.state.errors, 0);
  assert.equal(tui.state.phase, 'COMPLETED');
});

test('error event is surfaced', async () => {
  const orch = fakeOrch();
  orch.run = scriptedRun(orch, { passed: true, error: true });
  const { out, tui } = makeTUI(orch);
  tui._wireEvents();
  await tui._runTask('t');
  assert.match(out.toString(), /✗ Error: boom/);
});

test('memory retrieve event renders a memory panel', async () => {
  const orch = fakeOrch();
  const { out, tui } = makeTUI(orch);
  tui._wireEvents();
  orch.bus.emit('memory:retrieve', { experiences: [{ task: 'JWT auth failure', result: 'passed', score: 1 }] });
  const text = out.toString();
  assert.match(text, /MEMORY/);
  assert.match(text, /Retrieved previous experience/);
  assert.match(text, /JWT auth failure/);
});

test('commands render real orchestrator state', async () => {
  const orch = fakeOrch({ tasks: [{ task: 'old task', result: 'passed', score: 1 }] });
  const { tui } = makeTUI(orch);
  assert.match(tui._helpText(), /\/exit/);
  assert.match(tui._toolsText(), /listFiles/);
  assert.match(tui._memoryText(), /old task/);
  const skills = tui._skillsText('react');
  assert.match(skills, /react/);
  assert.match(skills, /●/);
});

test('unknown command is reported, /exit signals close', async () => {
  const orch = fakeOrch();
  const { out, tui } = makeTUI(orch);
  assert.equal(await tui._handleCommand('/nope'), true);
  assert.match(out.toString(), /Unknown command/);
  assert.equal(await tui._handleCommand('/exit'), false);
});

test('cleanup unsubscribes and is idempotent', () => {
  const orch = fakeOrch();
  const { tui } = makeTUI(orch);
  tui._wireEvents();
  tui._cleanup();
  tui._cleanup(); // second call must not throw
  // After cleanup, emitting should not reach the (removed) listeners.
  const before = out_of(orch, tui);
  orch.bus.emit('tool:call', { name: 'listFiles', args: {} });
  assert.equal(out_of(orch, tui).length, before.length);
});

function out_of(orch, tui) { return tui.out.toString(); }
