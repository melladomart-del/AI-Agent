'use strict';

/**
 * REAL end-to-end acceptance test of the autonomous agent loop against a live
 * local model. This is NOT mocked: it uses the real Orchestrator, real tools,
 * real verification, and the real configured local model server.
 *
 * Scenario: a temp project contains a deliberately broken JavaScript function
 * and a real `node --test` test that fails. We ask the agent to inspect the
 * project, find the bug, fix it, run the tests, and finish. The agent must:
 *   - call tools (listFiles/readFile/searchCode, editFile, runTests/runCommand, finish),
 *   - observe the test failure and correct itself if needed,
 *   - end with a passing test, and
 *   - record an experience in memory.
 *
 * Gated by AI_AGENT_LIVE=1 plus a reachable LOCAL_MODEL_BASE_URL so it cannot
 * run by accident against a cloud backend. When no live server is configured it
 * is SKIPPED with a clear reason (it never silently passes, never falls back).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Orchestrator } = require('../src/engine/orchestrator');
const { buildConfig } = require('../src/config');
const { Memory } = require('../src/engine/memory');

const LIVE = process.env.AI_AGENT_LIVE === '1';
const skipReason = !LIVE ? 'set AI_AGENT_LIVE=1 with a running local server (LOCAL_MODEL_BASE_URL/LOCAL_MODEL_NAME)' : '';
const skip = skipReason || undefined;

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agent-live-'));
  // Broken: add(a,b) returns a-b instead of a+b.
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'math.js'),
    'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n',
  );
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  // Plain assertion script (not node --test): running `node --test` as a child
  // of this test runner makes node skip the nested files ("run() is being
  // called recursively"), which would mask real failures. A plain script's
  // exit code is the real verdict and works inside and outside the runner.
  fs.writeFileSync(
    path.join(dir, 'test', 'run-tests.js'),
    "const assert = require('assert');\n" +
      "const { add } = require('../src/math');\n" +
      "assert.equal(add(2, 3), 5, 'add(2,3) should be 5');\n" +
      "assert.equal(add(0, 0), 0, 'add(0,0) should be 0');\n" +
      "console.log('all tests passed');\n",
  );
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'tmp-live-project', version: '1.0.0', private: true,
      scripts: { test: 'node test/run-tests.js' },
    }, null, 2),
  );
  fs.writeFileSync(path.join(dir, '.env'), 'LOCAL_MODEL_BASE_URL=dummy\n');
  return dir;
}

test('LIVE e2e: agent fixes a broken function and verifies', { skip }, async () => {
  const dir = makeTempProject();
  process.chdir(dir);

  const cfg = buildConfig();
  cfg.rootDir = dir;
  cfg.provider = 'local';
  cfg.cloudFallback = false; // never fall back to cloud in the live test
  cfg.maxSteps = 24;
  cfg.maxRetries = 3;
  cfg.memoryDir = '.agent-memory';
  cfg.observationMaxChars = 4000;

  const orch = new Orchestrator(cfg);
  const toolNames = [];
  orch.on('tool:call', ({ name }) => toolNames.push(name));

  const task = 'Inspect this project, find the bug in src/math.js, fix it so the tests pass, run the tests to verify, then finish.';
  const result = await orch.run(task, { verifyCommand: 'npm test' });

  // 1. The agent must have actually called tools.
  assert.ok(toolNames.length >= 3, `agent should call several tools; saw: ${toolNames.join(', ')}`);
  // 2. It must have edited the file.
  assert.ok(toolNames.includes('editFile') || toolNames.includes('writeFile'), 'agent should edit the broken file');

  // 3. The fix must be real: add(2,3) === 5.
  const fixed = fs.readFileSync(path.join(dir, 'src', 'math.js'), 'utf-8');
  assert.match(fixed, /a\s*\+\s*b|return a \+ b/, 'math.js should now add rather than subtract');
  // eslint-disable-next-line no-eval
  const mod = require(path.join(dir, 'src', 'math.js'));
  assert.equal(mod.add(2, 3), 5, 'add(2,3) must return 5 after the fix');
  assert.equal(mod.add(0, 0), 0);

  // 4. Verification must have passed (either by the agent's own runTests or the
  //    verifyCommand, possibly via the corrector retry path).
  assert.ok(result.verified && result.verified.passed, `verification should pass. result: ${JSON.stringify({ ok: result.ok, summary: result.summary, verified: result.verified, errors: result.errors })}`);
  assert.equal(result.ok, true);

  // 5. An experience must be recorded.
  const mem = new Memory(path.join(dir, cfg.memoryDir));
  const all = mem.load();
  assert.equal(all.length, 1);
  assert.equal(all[0].score, 1, 'successful task should be scored positively');

  // 6. A second similar task retrieves the prior experience.
  const cs = orch.contextSelector;
  const ctx = cs.build('fix the math bug again');
  assert.ok(ctx.experiences && ctx.experiences.length >= 1, 'a similar task should retrieve the prior experience');

  process.chdir('/');
});
