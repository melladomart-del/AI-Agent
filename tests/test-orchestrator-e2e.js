'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Orchestrator } = require('../src/engine/orchestrator');
const { buildConfig } = require('../src/config');

/* End-to-end test of the full Orchestrator with a scripted fake model, so we
 * exercise the real agent → tool → observation → verification → memory path
 * without a network or LLM. */
class ScriptedModel {
  constructor(script) { this.script = script; this.i = 0; }
  async complete() { return this.i < this.script.length ? this.script[this.i++] : { content: '(end)', tool_calls: null }; }
}

function makeToolCall(id, name, args) {
  return { id, function: { name, arguments: JSON.stringify(args) } };
}

test('orchestrator: full loop writes a file, verifies via runTests, records memory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-e2e-'));
  process.chdir(dir);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = function () { return 1; };\n');

  const cfg = buildConfig();
  cfg.rootDir = dir;
  cfg.maxSteps = 10;
  cfg.maxRetries = 1;
  cfg.provider = 'local';

  const orch = new Orchestrator(cfg);
  // Inject scripted models so the loop is deterministic (no real server).
  // The planner gets its own model returning a plan string; the agent loop
  // gets the tool-call script.
  orch.planner.modelRouter = { async complete() { return { content: '1. Write file\n2. Finish' }; } };
  orch.modelRouter = new ScriptedModel([
    { tool_calls: [makeToolCall('1', 'writeFile', { path: 'out.txt', content: 'done' })] },
    { tool_calls: [makeToolCall('2', 'finish', { summary: 'wrote out.txt' })] },
  ]);
  orch.agent.modelRouter = orch.modelRouter;
  // Make verification deterministic: stub runTests to pass.
  const tools = require('../src/tools/files');
  orch.registry.register({
    name: 'runTests', description: '', parameters: { type: 'object', properties: {} },
    permissions: {}, getSchema() { return { type: 'function', function: { name: 'runTests', description: '', parameters: { type: 'object', properties: {} } } }; },
    handler: async () => 'tests PASSED\n1 passing',
  });

  const res = await orch.run('Write a file and finish');
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'out.txt'), 'utf-8'), 'done');
  assert.ok(res.verified && res.verified.passed, 'verification should pass');
  // Memory should contain one experience.
  const { Memory } = require('../src/engine/memory');
  const m = new Memory(path.join(dir, cfg.memoryDir));
  assert.equal(m.load().length, 1);
  assert.equal(m.load()[0].score, 1);
  process.chdir('/');
});

test('orchestrator: failure triggers corrector retry path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-e2e2-'));
  process.chdir(dir);

  const cfg = buildConfig();
  cfg.rootDir = dir; cfg.maxSteps = 6; cfg.maxRetries = 2; cfg.provider = 'local';
  const orch = new Orchestrator(cfg);

  // First run: finish. Then verification fails. Corrector runs the agent again
  // (resume), which finishes again, and verification passes on the 2nd check.
  let verifyCalls = 0;
  orch.verifier.verify = async () => {
    verifyCalls++;
    return { passed: verifyCalls >= 2, output: verifyCalls >= 2 ? 'tests PASSED' : 'tests FAILED' };
  };
  orch.planner.modelRouter = { async complete() { return { content: '1. Fix\n2. Finish' }; } };
  orch.modelRouter = new ScriptedModel([
    { tool_calls: [makeToolCall('1', 'finish', { summary: 'first' })] },
    { tool_calls: [makeToolCall('2', 'finish', { summary: 'fixed' })] },
  ]);
  orch.agent.modelRouter = orch.modelRouter;

  const res = await orch.run('fix a bug');
  assert.equal(res.ok, true);
  assert.ok(res.verified && res.verified.passed, 'corrector should have fixed it');
  assert.ok(verifyCalls >= 2, 'verifier should have run at least twice');
  process.chdir('/');
});
