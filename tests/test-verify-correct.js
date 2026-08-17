'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Verifier } = require('../src/engine/verification');
const { Corrector } = require('../src/engine/corrector');
const { ToolRegistry } = require('../src/tools/registry');
const tools = require('../src/tools/files');

function makeRegistry() {
  const config = { rootDir: process.cwd(), protectedPaths: [], blockedCommands: ['sudo'] };
  const reg = new ToolRegistry(config);
  reg.register(tools.runTests);
  reg.register(tools.runCommand);
  return reg;
}

test('verifier passes when runTests returns PASSED', async () => {
  // Stub runTests handler to return a passing result.
  const config = { rootDir: process.cwd(), protectedPaths: [], blockedCommands: [] };
  const reg = new ToolRegistry(config);
  reg.register({
    name: 'runTests', description: '', parameters: { type: 'object', properties: {} },
    getSchema() { return { type: 'function', function: { name: 'runTests', description: '', parameters: { type: 'object', properties: {} } } }; },
    handler: async () => 'tests PASSED\n3 passing',
  });
  const v = new Verifier({ registry: reg, config });
  const res = await v.verify({});
  assert.equal(res.passed, true);
  assert.match(res.output, /PASSED/);
});

test('verifier fails when runTests returns FAILED', async () => {
  const config = { rootDir: process.cwd(), protectedPaths: [], blockedCommands: [] };
  const reg = new ToolRegistry(config);
  reg.register({
    name: 'runTests', description: '', parameters: { type: 'object', properties: {} },
    getSchema() { return { type: 'function', function: { name: 'runTests', description: '', parameters: { type: 'object', properties: {} } } }; },
    handler: async () => '[exit 1] tests FAILED\nAssertionError',
  });
  const v = new Verifier({ registry: reg, config });
  const res = await v.verify({});
  assert.equal(res.passed, false);
});

test('verifier uses custom verifyCommand', async () => {
  const reg = makeRegistry();
  const v = new Verifier({ registry: reg, config: { rootDir: process.cwd(), protectedPaths: [], blockedCommands: [] } });
  const res = await v.verify({ verifyCommand: 'echo PASSED' });
  assert.equal(res.passed, true);
});

test('corrector retries and succeeds when fix works', async () => {
  let verifyCalls = 0;
  const fakeVerifier = {
    verify: async () => {
      verifyCalls++;
      return { passed: verifyCalls > 1, output: verifyCalls > 1 ? 'tests PASSED' : 'tests FAILED' };
    },
  };
  let agentRuns = 0;
  const fakeAgent = {
    run: async () => {
      agentRuns++;
      return { ok: true, summary: 'fixed' };
    },
  };
  const corrector = new Corrector({ agent: fakeAgent, verifier: fakeVerifier, config: { maxRetries: 3 } });
  const res = await corrector.correct({ failureOutput: 'tests FAILED', task: 'fix it', verifyCommand: null });
  assert.equal(res.fixed, true);
  assert.ok(agentRuns >= 1);
  assert.ok(verifyCalls >= 2);
});

test('corrector gives up after maxRetries', async () => {
  const fakeVerifier = { verify: async () => ({ passed: false, output: 'still FAILED' }) };
  const fakeAgent = { run: async () => ({ ok: false }) };
  const corrector = new Corrector({ agent: fakeAgent, verifier: fakeVerifier, config: { maxRetries: 2 } });
  const res = await corrector.correct({ failureOutput: 'FAILED', task: 'x', verifyCommand: null });
  assert.equal(res.fixed, false);
});
