'use strict';

/**
 * End-to-end TUI + agent test against a mock OpenAI-compatible local server.
 *
 * This is the regression test the provider-routing bug class demanded: it
 * drives the REAL stack TUI -> Agent -> Orchestrator -> ModelRouter ->
 * LocalProvider -> (mock) OpenAI-compatible HTTP endpoint -> tool call ->
 * tool result -> verification -> memory, and asserts what the user actually
 * sees in the terminal. Only model inference is mocked.
 *
 * It proves:
 *  - the TUI header reports Backend=LOCAL, the configured Endpoint and Model;
 *  - a task reaches the LOCAL provider (requests go to the mock, NOT :11434);
 *  - real tools run (files are really edited, tests really executed);
 *  - verification runs and passes against the real files;
 *  - the task is recorded in memory;
 *  - no request targets 127.0.0.1:11434.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { Orchestrator } = require('../src/engine/orchestrator');
const { TUI } = require('../src/tui/tui');
const { startMockServer } = require('./fixtures/mock-openai-server');
const { makeBrokenAddProject } = require('./fixtures/temp-projects');

class CaptureStream {
  constructor() { this.isTTY = false; this.chunks = []; }
  write(s) { this.chunks.push(s); return true; }
  toString() { return this.chunks.join(''); }
}

function buildConfig(proj, url) {
  const { buildConfig } = require('../src/config');
  const cfg = buildConfig();
  cfg.rootDir = proj.dir;
  cfg.provider = 'local';
  cfg.local = { baseUrl: url, model: 'mock-coder', apiKey: 'local' };
  cfg.cloudFallback = false;
  cfg.maxSteps = 24;
  cfg.maxRetries = 3;
  cfg.observationMaxChars = 4000;
  return cfg;
}

test('e2e TUI: LOCAL backend header, real tool flow, verification, memory; no Ollama port', async () => {
  // Render decides color from process.stdout.isTTY (global), not our capture
  // stream, so force plain text to keep assertions ANSI-stable.
  process.env.NO_COLOR = '1';
  const proj = makeBrokenAddProject();
  const { server, url } = await startMockServer({ fixes: proj.fixes });
  try {
    const cfg = buildConfig(proj, url);
    const orch = new Orchestrator(cfg);

    // Instrument the router so we can assert no request leaks to Ollama.
    const ollamaHits = { count: 0 };
    const origComplete = orch.modelRouter.local.complete.bind(orch.modelRouter.local);
    orch.modelRouter.local.complete = async function (opts) {
      if (/:11434/.test(this.baseUrl)) ollamaHits.count++;
      return origComplete(opts);
    };

    const out = new CaptureStream();
    // Drive the task directly (bypass readline) so the test is deterministic:
    // we call _dispatch, wait for the run to finish, then teardown. The header
    // is still printed by start(), which we call after wiring the probe.
    const input = new Readable({ read() {} });
    input.isTTY = false;
    const tui = new TUI(orch, { out, input });

    // start() prints the header + probe, then creates readline over `input`.
    // We never push any line into it -- we drive _dispatch directly below.
    await tui.start().catch(() => {});

    const runPromise = tui._dispatch('Fix the failing add test.');
    const deadline = Date.now() + 30000;
    while (tui.running && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await runPromise.catch(() => {});
    tui._teardown();

    const text = out.toString();

    // 1. Header reflects the real LOCAL config (not Ollama). The backend
    //    label is derived from the endpoint; a generic OpenAI-compatible URL
    //    shows "llama.cpp" (never "Ollama" since the URL has no :11434).
    assert.match(text, /Backend\s+llama\.cpp/, 'header should show the generic local backend label');
    assert.match(text, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'header should show the configured endpoint');
    assert.match(text, /mock-coder/, 'header should show the configured model name');
    assert.match(text, /Status\s+● CONNECTED/, 'header should show a connected status from the real probe');
    assert.doesNotMatch(text, /11434/, 'TUI output must not mention the Ollama port');

    // 2. The agent really used tools and verified.
    assert.match(text, /▶ listFiles/);
    assert.match(text, /▶ editFile/);
    assert.match(text, /▶ runTests/);
    assert.match(text, /passed/i);

    // 3. The real file was actually fixed (proves real tool execution).
    assert.ok(proj.verify(), 'the real file must now produce correct results');

    // 4. The task was recorded in memory.
    const { Memory } = require('../src/engine/memory');
    const mem = new Memory(require('path').join(proj.dir, cfg.memoryDir));
    const all = mem.load();
    assert.ok(all.length >= 1, 'an experience should be recorded');

    // 5. No request leaked to Ollama.
    assert.equal(ollamaHits.count, 0, 'no completion request may target :11434');
  } finally {
    server.close();
    delete process.env.NO_COLOR;
  }
});
