'use strict';

/**
 * Failure-recovery tests. These exercise the agent/observation/correction paths
 * against real tool execution (no tool mocking) using a scripted model so the
 * failures are deterministic:
 *   - a tool call with malformed JSON arguments,
 *   - a command that fails (non-zero exit) is observed,
 *   - a file edit that introduces a syntax error is caught by verification and
 *     corrected through the real Corrector loop,
 *   - a model (provider) error returns ok:false without faking success.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Agent } = require('../src/engine/agent');
const { EventBus } = require('../src/engine/event-bus');
const { Memory } = require('../src/engine/memory');
const { ContextSelector } = require('../src/engine/context-selector');
const { Verifier } = require('../src/engine/verification');
const { ToolRegistry } = require('../src/tools/registry');
const tools = require('../src/tools/files');

class ScriptedModel {
  constructor(script) { this.script = script; this.i = 0; }
  async complete() { return this.i < this.script.length ? this.script[this.i++] : { content: '(end)', tool_calls: [] }; }
}
function tc(id, name, args) { return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }; }
function tcRaw(id, name, raw) { return { id, type: 'function', function: { name, arguments: raw } }; }

function setupAgent(dir, model, verifier) {
  const config = {
    rootDir: dir, protectedPaths: ['.env', '.git/**', 'node_modules/**'],
    blockedCommands: ['sudo'], maxSteps: 12, maxRetries: 2,
    repoMapMaxTokens: 1024, skillTopK: 2, memoryDir: '.agent-memory',
    temperature: 0.2, maxTokens: 512, observationMaxChars: 4000,
  };
  const registry = new ToolRegistry(config);
  for (const t of [tools.listFiles, tools.readFile, tools.writeFile, tools.editFile, tools.runCommand, tools.runTests, tools.finish]) registry.register(t);
  const agent = new Agent({
    modelRouter: model, registry,
    contextSelector: new ContextSelector(config),
    planner: null, verifier, corrector: null,
    memory: new Memory(path.join(dir, '.agent-memory')),
    config, eventBus: new EventBus(),
  });
  return { agent, registry };
}

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fail-rec-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = { add: (a, b) => a + b };\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0', private: true, scripts: { test: 'node -e "require(\'./src/app.js\')"' } }, null, 2));
  return dir;
}

test('recovery: malformed JSON arguments produce a recoverable observation, not a crash', async () => {
  const dir = tmpProject();
  process.chdir(dir);
  const model = new ScriptedModel([
    { tool_calls: [tcRaw('1', 'readFile', '{path: "src/app.js"}')] }, // invalid JSON
    { tool_calls: [tc('2', 'readFile', { path: 'src/app.js' })] },     // valid retry
    { tool_calls: [tc('3', 'finish', { summary: 'done' })] },
  ]);
  const verifier = { verify: async () => ({ passed: true, output: 'tests PASSED' }) };
  const { agent } = setupAgent(dir, model, verifier);
  const res = await agent.run('read app.js');
  assert.equal(res.ok, true);
  assert.ok(res.errors.some((e) => /malformed JSON/.test(e.observation)), 'malformed-arg error should be recorded');
  process.chdir('/');
});

test('recovery: failing command is observed (not hidden) and surfaced as an error', async () => {
  const dir = tmpProject();
  process.chdir(dir);
  const model = new ScriptedModel([
    { tool_calls: [tc('1', 'runCommand', { command: 'node -e "process.exit(2)"' })] },
    { tool_calls: [tc('2', 'finish', { summary: 'done' })] },
  ]);
  const verifier = { verify: async () => ({ passed: false, output: 'tests FAILED' }) };
  const { agent } = setupAgent(dir, model, verifier);
  const res = await agent.run('run a command');
  // The failed command output is an observation containing an exit code.
  assert.ok(res.errors.length >= 1, 'failed command should be recorded as an error observation');
  assert.match(res.errors[0].observation, /exit|Error|\[exit/i);
  process.chdir('/');
});

test('recovery: syntax-error edit is caught by verification and corrected', async () => {
  const dir = tmpProject();
  process.chdir(dir);
  // Run 1: introduce a real syntax error (unbalanced paren), then finish.
  // Verification (node -e require) fails. Corrector resumes the agent:
  // editFile restores valid syntax, then finish. Verification passes.
  const model = new ScriptedModel([
    { tool_calls: [tc('1', 'editFile', { path: 'src/app.js', oldStr: 'a + b };', newStr: 'a + b );' })] },
    { tool_calls: [tc('2', 'finish', { summary: 'done' })] },
    // resumed (correction) run:
    { tool_calls: [tc('3', 'editFile', { path: 'src/app.js', oldStr: 'a + b );', newStr: 'a + b };' })] },
    { tool_calls: [tc('4', 'finish', { summary: 'fixed syntax' })] },
  ]);
  const config = {
    rootDir: dir, protectedPaths: ['.env', '.git/**'], blockedCommands: ['sudo'],
    maxSteps: 12, maxRetries: 2, repoMapMaxTokens: 512, skillTopK: 1,
    memoryDir: '.agent-memory', temperature: 0.2, maxTokens: 256, observationMaxChars: 4000,
  };
  const registry = new ToolRegistry(config);
  for (const t of [tools.listFiles, tools.readFile, tools.writeFile, tools.editFile, tools.runCommand, tools.runTests, tools.finish]) registry.register(t);
  const verifier = new Verifier({ registry, config });
  const corrector = require('../src/engine/corrector');
  const Corr = new corrector.Corrector({ agent: null, verifier, config });
  const agent = new Agent({
    modelRouter: model, registry,
    contextSelector: new ContextSelector(config), planner: null,
    verifier, corrector: Corr, memory: new Memory(path.join(dir, '.agent-memory')),
    config, eventBus: new EventBus(),
  });
  Corr.agent = agent;

  const res = await agent.run('edit app.js', { verifyCommand: 'node -e "require(\'./src/app.js\')"' });
  assert.ok(res.verified && res.verified.passed, `corrector should have fixed verification; got ${JSON.stringify(res.verified)}`);
  // The file should now parse again.
  delete require.cache[require.resolve(path.join(dir, 'src', 'app.js'))];
  const mod = require(path.join(dir, 'src', 'app.js'));
  assert.equal(typeof mod.add, 'function');
  process.chdir('/');
});

test('recovery: model error returns ok:false without faking success', async () => {
  const dir = tmpProject();
  process.chdir(dir);
  const model = { async complete() { const e = new Error('connection refused'); e.code = 'ECONNREFUSED'; throw e; } };
  const verifier = { verify: async () => ({ passed: false, output: '' }) };
  const { agent } = setupAgent(dir, model, verifier);
  const res = await agent.run('do something');
  assert.equal(res.ok, false);
  assert.match(res.summary, /model error/i);
  process.chdir('/');
});
