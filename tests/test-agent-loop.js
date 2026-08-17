'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Agent } = require('../src/engine/agent');
const { EventBus } = require('../src/engine/event-bus');
const { Memory } = require('../src/engine/memory');
const { RepoAnalyzer } = require('../src/engine/repo-analyzer');
const { SkillRegistry } = require('../src/engine/skill-registry');
const { ContextSelector } = require('../src/engine/context-selector');
const { Verifier } = require('../src/engine/verification');
const { ToolRegistry } = require('../src/tools/registry');
const tools = require('../src/tools/files');

/* A scripted fake model router. Each call to complete() returns the next
 * scripted message. Lets us test the action/observation loop deterministically
 * without any real LLM or network. */
class ScriptedModel {
  constructor(script) {
    this.script = script;
    this.i = 0;
    this.calls = 0;
  }
  async complete() {
    this.calls++;
    if (this.i >= this.script.length) {
      return { content: '(no more script)', tool_calls: null };
    }
    return this.script[this.i++];
  }
}

function makeToolCall(id, name, args) {
  return {
    id,
    function: { name, arguments: JSON.stringify(args) },
  };
}

function setupTmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-loop-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = function () { return 1; };\n');
  return dir;
}

function makeAgent(tmpDir, model, opts = {}) {
  const config = {
    rootDir: tmpDir,
    protectedPaths: ['.env', '.git/**', 'node_modules/**'],
    blockedCommands: ['sudo'],
    maxSteps: 10,
    maxRetries: 2,
    repoMapMaxTokens: 1024,
    skillTopK: 2,
    memoryDir: '.agent-memory',
    temperature: 0.2,
    maxTokens: 512,
  };
  const registry = new ToolRegistry(config);
  for (const t of [
    tools.readFile, tools.writeFile, tools.editFile, tools.runCommand,
    tools.gitStatus, tools.runTests, tools.finish,
  ]) registry.register(t);

  const memory = new Memory(path.join(tmpDir, '.agent-memory'));
  const contextSelector = new ContextSelector(config);
  const verifier = new Verifier({ registry, config });
  const agent = new Agent({
    modelRouter: model,
    registry,
    contextSelector,
    planner: null,
    verifier,
    corrector: null,
    memory,
    config,
    eventBus: new EventBus(),
  });
  return { agent, registry, verifier, memory };
}

test('agent loop: read file then finish', async () => {
  const dir = setupTmpRepo();
  process.chdir(dir);
  const model = new ScriptedModel([
    { tool_calls: [makeToolCall('1', 'readFile', { path: 'src/app.js' })] },
    { tool_calls: [makeToolCall('2', 'finish', { summary: 'read the file' })] },
  ]);
  const { agent } = makeAgent(dir, model);
  const res = await agent.run('Read app.js');
  assert.equal(res.ok, true);
  assert.match(res.summary, /read the file/);
  assert.equal(model.calls, 2);
  process.chdir('/');
});

test('agent loop: unknown tool returns observation, not crash', async () => {
  const dir = setupTmpRepo();
  process.chdir(dir);
  const model = new ScriptedModel([
    { tool_calls: [makeToolCall('1', 'nonexistent', {})] },
    { tool_calls: [makeToolCall('2', 'finish', { summary: 'done' })] },
  ]);
  const { agent } = makeAgent(dir, model);
  const res = await agent.run('test');
  assert.equal(res.ok, true);
  assert.ok(res.errors.length >= 1);
  assert.match(res.errors[0].observation, /unknown tool/);
  process.chdir('/');
});

test('agent loop: write then finish actually writes the file', async () => {
  const dir = setupTmpRepo();
  process.chdir(dir);
  const model = new ScriptedModel([
    { tool_calls: [makeToolCall('1', 'writeFile', { path: 'out.txt', content: 'hello' })] },
    { tool_calls: [makeToolCall('2', 'finish', { summary: 'wrote file' })] },
  ]);
  const { agent } = makeAgent(dir, model);
  const res = await agent.run('Write a file');
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'out.txt'), 'utf-8'), 'hello');
  process.chdir('/');
});

test('agent loop: records experience in memory after completion', async () => {
  const dir = setupTmpRepo();
  process.chdir(dir);
  const model = new ScriptedModel([
    { tool_calls: [makeToolCall('1', 'finish', { summary: 'done' })] },
  ]);
  const { agent, memory } = makeAgent(dir, model);
  await agent.run('fix authentication bug');
  const all = memory.load();
  assert.equal(all.length, 1);
  assert.match(all[0].task, /authentication bug/);
  process.chdir('/');
});

test('agent loop: step budget enforced', async () => {
  const dir = setupTmpRepo();
  process.chdir(dir);
  // never finishes — always calls readFile
  const loopCall = makeToolCall('1', 'readFile', { path: 'src/app.js' });
  const model = new ScriptedModel(Array(20).fill({ tool_calls: [loopCall] }));
  const config = {
    rootDir: dir, protectedPaths: [], blockedCommands: [],
    maxSteps: 3, maxRetries: 1, repoMapMaxTokens: 512, skillTopK: 1,
    memoryDir: '.agent-memory', temperature: 0.2, maxTokens: 256,
  };
  const registry = new ToolRegistry(config);
  registry.register(tools.readFile);
  registry.register(tools.finish);
  const agent = new Agent({
    modelRouter: model, registry,
    contextSelector: new ContextSelector(config),
    planner: null,
    verifier: { verify: async () => ({ passed: false, output: 'no tests' }) },
    corrector: null,
    memory: new Memory(path.join(dir, '.agent-memory')),
    config, eventBus: new EventBus(),
  });
  const res = await agent.run('loop forever');
  assert.equal(res.ok, false);
  process.chdir('/');
});

test('context selector builds repo map + skills without sending whole repo', () => {
  const dir = setupTmpRepo();
  process.chdir(dir);
  const config = {
    rootDir: dir, repoMapMaxTokens: 512, skillTopK: 2,
    memoryDir: '.agent-memory',
  };
  const cs = new ContextSelector(config);
  const ctx = cs.build('examine the app');
  assert.match(ctx.repoMap, /app/);
  assert.equal(typeof ctx.skills, 'string');
  process.chdir('/');
});
