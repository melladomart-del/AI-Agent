'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Memory } = require('../src/engine/memory');

function setupMem() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mem-'));
  return new Memory(dir);
}

test('memory starts empty and persists after record', () => {
  const mem = setupMem();
  assert.equal(mem.load().length, 0);
  mem.record({ task: 'fix auth bug', result: 'passed', score: 1, tags: ['auth', 'bug'] });
  assert.equal(mem.load().length, 1);
});

test('retrieve returns relevant experiences by lexical overlap', () => {
  const mem = setupMem();
  mem.record({ task: 'fix authentication bug', result: 'passed', score: 1, tags: ['auth'] });
  mem.record({ task: 'optimize database query', result: 'passed', score: 1, tags: ['database'] });
  const found = mem.retrieve('fix the authentication error', 3);
  assert.ok(found.length > 0);
  assert.match(found[0].task, /authentication/);
});

test('retrieve prefers successful experiences', () => {
  const mem = setupMem();
  mem.record({ task: 'auth fix failed', result: 'failed', score: -1, tags: ['auth'] });
  mem.record({ task: 'auth fix success', result: 'passed', score: 1, tags: ['auth'] });
  const found = mem.retrieve('auth fix', 3);
  assert.ok(found.some((e) => e.score > 0));
});

test('retrieve returns empty when no overlap', () => {
  const mem = setupMem();
  mem.record({ task: 'unrelated thing', result: 'passed', score: 1, tags: ['xyz'] });
  assert.equal(mem.retrieve('authentication', 3).length, 0);
});

test('summarize formats experiences', () => {
  const mem = setupMem();
  const e = mem.record({ task: 'fix bug', result: 'passed', score: 1, errors: ['err1'] });
  const out = mem.summarize([e]);
  assert.match(out, /fix bug/);
  assert.match(out, /passed/);
  assert.match(out, /err1/);
});

test('memory survives reload from disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mem2-'));
  const m1 = new Memory(dir);
  m1.record({ task: 'persisted task', result: 'passed', score: 1, tags: ['persisted'] });
  const m2 = new Memory(dir);
  const all = m2.load();
  assert.equal(all.length, 1);
  assert.match(all[0].task, /persisted task/);
});

test('shared Memory instance sees recorded experiences immediately (no stale cache)', () => {
  // Regression: the agent and the context selector must share ONE Memory instance
  // so that an experience recorded during a run is retrievable afterwards without
  // reloading from disk (the per-instance cache would otherwise hide it).
  const { ContextSelector } = require('../src/engine/context-selector');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mem-shared-'));
  process.chdir(dir);
  const config = { rootDir: dir, repoMapMaxTokens: 256, skillTopK: 2, memoryDir: '.agent-memory' };
  const shared = new Memory(path.join(dir, config.memoryDir));
  shared.record({ task: 'fix the math bug in src/math.js', result: 'passed', score: 1, tags: ['math', 'bug'] });

  const cs = new ContextSelector(config, shared);
  const ctx = cs.build('fix the math bug again');
  assert.ok(ctx.experiences && ctx.experiences.length >= 1, 'shared memory should expose the recorded experience');
  assert.match(ctx.experiences[0].task, /math bug/);
  process.chdir('/');
});
