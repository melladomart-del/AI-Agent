'use strict';

/**
 * Real end-to-end integration tests of the autonomous agent loop.
 *
 * These do NOT mock the engine: they use the real Orchestrator, real Provider
 * (real OpenAI SDK HTTP client), real tool-call normalization, real tools
 * (real filesystem, real `npm test`), real verification, real correction, and
 * real memory. The ONLY thing replaced is the model inference, served by a
 * stateful mock OpenAI-compatible server (tests/fixtures/mock-openai-server.js)
 * that decides its next tool call from the genuine observations it receives.
 *
 * This is the standard way to validate an agent loop without a GPU: the mock
 * stands in for a local model server that is not available in this environment.
 * A real local model server is exercised by tests/test-live-e2e.js when
 * AI_AGENT_LIVE=1 is set and a server is reachable.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Orchestrator } = require('../src/engine/orchestrator');
const { buildConfig } = require('../src/config');
const { Memory } = require('../src/engine/memory');
const { startMockServer } = require('./fixtures/mock-openai-server');
const {
  makeBrokenAddProject, makeTwoBugProject, makeMultiFileProject,
} = require('./fixtures/temp-projects');

/**
 * Build a config pointing the real local Provider at the mock server's URL.
 * The agent engine and tools are 100% real; only the model endpoint is mocked.
 */
function makeConfig(proj, url, extra = {}) {
  const cfg = buildConfig();
  cfg.rootDir = proj.dir;
  cfg.provider = 'local';
  cfg.local = { baseUrl: url, model: 'mock-coder', apiKey: 'local' };
  cfg.cloudFallback = false; // never fall back; we want deterministic local runs
  cfg.maxSteps = extra.maxSteps ?? 24;
  cfg.maxRetries = extra.maxRetries ?? 3;
  cfg.observationMaxChars = extra.observationMaxChars ?? 4000;
  return cfg;
}

async function withServer(opts, fn) {
  const { server, url } = await startMockServer(opts);
  try {
    return await fn(url);
  } finally {
    server.close();
  }
}

test('integration: agent autonomously inspects, fixes, verifies, and records memory', async () => {
  const proj = makeBrokenAddProject();
  const result = await withServer({ fixes: proj.fixes }, async (url) => {
    const cfg = makeConfig(proj, url);
    const orch = new Orchestrator(cfg);
    const toolNames = [];
    orch.on('tool:call', ({ name }) => toolNames.push(name));
    const r = await orch.run(
      'Find and fix the failing test. Do not tell me how to fix it manually. Inspect the repository, identify the cause, modify the necessary files, run the tests, and verify the final result.',
      { verifyCommand: 'npm test' },
    );
    return { r, toolNames, memoryDir: cfg.memoryDir };
  });

  // 1. The agent genuinely used tools (not prose), chained across iterations.
  const { r: res, toolNames, memoryDir } = result;
  assert.ok(toolNames.length >= 4, `agent should call several tools; saw: ${toolNames.join(', ')}`);
  assert.ok(toolNames.includes('listFiles'), 'should list files first');
  assert.ok(toolNames.includes('readFile'), 'should read the broken file');
  assert.ok(toolNames.includes('editFile') || toolNames.includes('writeFile'), 'should edit the file');
  assert.ok(toolNames.includes('runTests') || toolNames.includes('finish'), 'should run tests / finish');

  // 2. The fix is real: add(2,3) === 5 (verified by actually requiring the file).
  assert.ok(proj.verify(), 'the real file must now produce correct results');

  // 3. Success depends on real verification, not on "a file was modified".
  assert.ok(res.verified && res.verified.passed, `verification should pass; got: ${JSON.stringify(res.verified)}`);
  assert.equal(res.ok, true);

  // 4. An experience was recorded (operational memory).
  const mem = new Memory(path.join(proj.dir, memoryDir));
  const all = mem.load();
  assert.equal(all.length, 1, 'one experience should be recorded');
  assert.equal(all[0].score, 1, 'a verified-successful task scores +1');
  assert.ok(all[0].actions.length >= 3, 'experience records the action sequence');

  process.chdir('/');
});

test('integration: failure recovery — first edit insufficient, agent diagnoses and corrects', async () => {
  const proj = makeTwoBugProject();
  const result = await withServer({ fixes: proj.fixes }, async (url) => {
    const cfg = makeConfig(proj, url);
    const orch = new Orchestrator(cfg);
    const toolNames = [];
    orch.on('tool:call', ({ name }) => toolNames.push(name));
    // Capture runTests observations to prove the agent actually saw a failure.
    const testObservations = [];
    orch.on('tool:result', ({ name, observation }) => {
      if (name === 'runTests') testObservations.push(String(observation));
    });
    return orch.run('Fix the failing calc tests.', { verifyCommand: 'npm test' })
      .then((r) => ({ r, toolNames, testObservations }));
  });

  const { r: res, toolNames, testObservations } = result;

  // The mock's first edit repairs `subtract` but leaves `multiply` wrong, so
  // tests STILL fail. The agent must observe that failure and fix `multiply`
  // too (either within its own loop or via the corrector).
  const editCount = toolNames.filter((n) => n === 'editFile' || n === 'writeFile').length;
  assert.ok(editCount >= 2, `agent should make at least two edits for the two bugs; saw ${editCount}`);
  assert.ok(toolNames.filter((n) => n === 'runTests').length >= 1, 'agent should run the tests');

  // At least one runTests observation must show a FAILURE before the final
  // pass — proving success is not declared just because a file was edited.
  assert.ok(testObservations.some((o) => /tests FAILED|\[exit [1-9]/.test(o)),
    `the agent must have observed a test failure; runTests observations: ${JSON.stringify(testObservations)}`);
  assert.ok(res.verified && res.verified.passed, 'final verification should pass');
  assert.ok(proj.verify(), 'both bugs must actually be fixed in the real file');

  process.chdir('/');
});

test('integration: premature finish is caught by the corrector and recovered', async () => {
  const proj = makeTwoBugProject();
  const result = await withServer({ fixes: proj.fixes, prematureFinishAfterEdit: true }, async (url) => {
    const cfg = makeConfig(proj, url);
    const orch = new Orchestrator(cfg);
    const correctRounds = [];
    orch.on('correct:round', ({ attempt }) => correctRounds.push(attempt));
    return orch.run('Fix the failing calc tests.', { verifyCommand: 'npm test' })
      .then((r) => ({ r, correctRounds }));
  });

  const { r: res, correctRounds } = result;
  // The mock claims done after the first edit; verification fails (multiply
  // still wrong); the dedicated Corrector must run and recover.
  assert.ok(correctRounds.length >= 1, 'corrector should run after premature finish');
  assert.ok(res.verified && res.verified.passed, 'corrector should achieve a passing verification');
  assert.ok(proj.verify(), 'both bugs must actually be fixed');
  process.chdir('/');
});

test('integration: tool-call normalization works for both fenced-JSON and native tool_calls', async () => {
  for (const mode of ['fenced', 'native']) {
    const proj = makeBrokenAddProject();
    // eslint-disable-next-line no-await-in-loop
    await withServer({ fixes: proj.fixes, mode }, async (url) => {
      const cfg = makeConfig(proj, url);
      const orch = new Orchestrator(cfg);
      const res = await orch.run('Fix the failing test.', { verifyCommand: 'npm test' });
      assert.ok(res.verified && res.verified.passed, `mode=${mode}: verification should pass`);
      assert.ok(proj.verify(), `mode=${mode}: the real file should be fixed`);
      process.chdir('/');
    });
  }
});

test('integration: context selection keeps the prompt small and relevant', async () => {
  const proj = makeMultiFileProject();
  // Build context for an auth-focused task and assert it does NOT include
  // every file's full body — only a token-budgeted repo map + relevant skills.
  const cfg = buildConfig();
  cfg.rootDir = proj.dir;
  const orch = new Orchestrator(cfg);
  const ctx = orch.contextSelector.build('fix the login authentication bug');

  // The repo map should mention the auth file (and is token-budgeted, so it
  // is far smaller than dumping every file's contents).
  assert.match(ctx.repoMap, /auth/, 'repo map should include the auth file');
  const mapChars = ctx.repoMap.length;
  const allFileChars = ['src/auth.js', 'src/logger.js', 'src/utils.js', 'README.md']
    .map((f) => fs.readFileSync(path.join(proj.dir, f), 'utf-8').length)
    .reduce((a, b) => a + b, 0);
  assert.ok(mapChars < allFileChars, `repo map (${mapChars} chars) should be smaller than the sum of all files (${allFileChars} chars)`);
  assert.equal(typeof ctx.skills, 'string');
  process.chdir('/');
});

test('integration: skills are selected dynamically, not all loaded per request', async () => {
  // Point the orchestrator at THIS repo (where skills/ lives) explicitly, so
  // the test is independent of whatever cwd a prior test left behind. Skills
  // are bundled with the app, so appRoot must also point at the repo.
  const repo = path.resolve(__dirname, '..');
  const cfg = buildConfig();
  cfg.rootDir = repo;
  cfg.appRoot = repo;
  const orch = new Orchestrator(cfg);
  const reactSkills = orch.contextSelector.skills.select('build a React component for the UI', 4);
  const sqlSkills = orch.contextSelector.skills.select('design a PostgreSQL schema for users', 4);
  // React task should include the react skill; SQL task should include SQL/db-ish skills.
  assert.match(reactSkills, /react/i, 'a React task should load the react skill');
  // The selection is dynamic: the two tasks produce different skill bundles.
  assert.notEqual(reactSkills, sqlSkills, 'different tasks should select different skills');
});

test('integration: safety — protected paths and blocked commands are rejected as observations', async () => {
  const proj = makeBrokenAddProject();
  const cfg = buildConfig();
  cfg.rootDir = proj.dir;
  cfg.protectedPaths = ['.env', '*.key', '.git/**', 'node_modules/**'];
  cfg.blockedCommands = ['rm -rf /', 'sudo', 'mkfs'];
  const orch = new Orchestrator(cfg);
  // Protected write target.
  fs.writeFileSync(path.join(proj.dir, '.env'), 'SECRET=1\n');
  const blocked = await orch.registry.dispatch('writeFile', { path: '.env', content: 'overwritten' });
  assert.match(blocked, /protected/i, 'writing a protected path should be rejected');
  // Outside-workspace write.
  const outside = await orch.registry.dispatch('writeFile', { path: '../../escape.txt', content: 'x' });
  assert.match(outside, /outside the workspace/i, 'writing outside the workspace should be rejected');
  // Blocked shell command.
  const cmd = await orch.registry.dispatch('runCommand', { command: 'rm -rf /' });
  assert.match(cmd, /blocked by safety policy/i, 'dangerous commands should be blocked');
  // A normal command still works (safety is not over-restrictive).
  const ok = await orch.registry.dispatch('runCommand', { command: 'node -e "console.log(42)"' });
  assert.match(ok, /42/, 'a benign command should still execute');
  // .env untouched.
  assert.equal(fs.readFileSync(path.join(proj.dir, '.env'), 'utf-8'), 'SECRET=1\n');
  process.chdir('/');
});

test('integration: malformed tool arguments are observed and the agent can recover', async () => {
  const proj = makeBrokenAddProject();
  const cfg = buildConfig();
  cfg.rootDir = proj.dir;
  const orch = new Orchestrator(cfg);
  // Malformed JSON arguments for editFile -> the tool returns an error
  // observation (not a crash), and the file is left untouched.
  const before = fs.readFileSync(path.join(proj.dir, 'src/calc.js'), 'utf-8');
  const obs = await orch.registry.dispatch('editFile', {
    path: 'src/calc.js',
    oldStr: 123, // wrong type
    newStr: 'x',
  });
  assert.match(obs, /Error/i, 'malformed args should produce an error observation');
  assert.equal(fs.readFileSync(path.join(proj.dir, 'src/calc.js'), 'utf-8'), before, 'file must be unchanged on a failed edit');
  process.chdir('/');
});

test('integration: git status reflects agent changes without auto-committing', async () => {
  const proj = makeBrokenAddProject();
  // Initialize a git repo in the temp project so gitStatus works.
  const { execSync } = require('child_process');
  execSync('git init -q', { cwd: proj.dir });
  execSync('git add -A', { cwd: proj.dir });
  execSync('git -c user.email=a@b.c -c user.name=t commit -qm init', { cwd: proj.dir });

  const result = await withServer({ fixes: proj.fixes }, async (url) => {
    const cfg = makeConfig(proj, url);
    const orch = new Orchestrator(cfg);
    // The agent edits the file; we do NOT call gitCommit. Verify git status
    // shows the change and nothing was auto-committed/pushed.
    const toolNames = [];
    orch.on('tool:call', ({ name }) => toolNames.push(name));
    const res = await orch.run('Fix the failing test.', { verifyCommand: 'npm test' });
    return { res, toolNames, status: execSync('git status --porcelain', { cwd: proj.dir, encoding: 'utf-8' }) };
  });

  const { toolNames, status } = result;
  assert.ok(!toolNames.includes('gitCommit'), 'the agent should not auto-commit unless asked');
  assert.match(status, /src\/calc\.js/, 'git status should show the modified file');
  process.chdir('/');
});

test('integration: experience retrieval influences a second similar task', async () => {
  const proj = makeBrokenAddProject();
  await withServer({ fixes: proj.fixes }, async (url) => {
    const cfg = makeConfig(proj, url);
    const orch = new Orchestrator(cfg);
    // First task: records an experience.
    await orch.run('Fix the failing add test in calc.', { verifyCommand: 'npm test' });
    const mem = new Memory(path.join(proj.dir, cfg.memoryDir));
    assert.equal(mem.load().length, 1, 'first task records an experience');
    // Second similar task: retrieval should surface the prior experience.
    const ctx = orch.contextSelector.build('fix the add function again in calc');
    assert.ok(ctx.experiences && ctx.experiences.length >= 1, 'a similar task should retrieve the prior experience');
    assert.match(ctx.experiences[0].task, /add|calc/i, 'the retrieved experience should be the related one');
    process.chdir('/');
  });
});

test('integration: model reachability probe against the mock server', async () => {
  const proj = makeBrokenAddProject();
  await withServer({ fixes: proj.fixes }, async (url) => {
    const cfg = makeConfig(proj, url);
    const orch = new Orchestrator(cfg);
    const probe = await orch.modelRouter.isReachable();
    assert.equal(probe.reachable, true, 'the mock server should be reachable');
    assert.equal(probe.baseUrl, url);
    process.chdir('/');
  });
});

test('integration: unreachable model is reported, not hung, and the agent fails cleanly', async () => {
  const proj = makeBrokenAddProject();
  const cfg = makeConfig(proj, 'http://127.0.0.1:1/v1'); // port 1 = nothing listening
  cfg.timeoutMs = 1500;
  const orch = new Orchestrator(cfg);
  const probe = await orch.modelRouter.isReachable();
  assert.equal(probe.reachable, false, 'a dead endpoint should be unreachable');
  // The agent run itself should fail cleanly (ok:false) rather than hang.
  const res = await orch.run('Fix the failing test.', { verifyCommand: 'npm test' });
  assert.equal(res.ok, false, 'agent should report failure, not fake success, when the model is unreachable');
  process.chdir('/');
});
