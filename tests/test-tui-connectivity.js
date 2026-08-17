'use strict';

/**
 * TUI connectivity-state regression tests using the REAL Orchestrator +
 * ModelRouter + Provider (not a fake orchestrator). Only the HTTP endpoint is
 * mocked, on an ephemeral port.
 *
 * These guard the bug class where the TUI/config said "LOCAL" but the actual
 * execution path routed requests to an Ollama endpoint (127.0.0.1:11434). They
 * assert, against the real stack, that:
 *   - a DOWN local server shows Status DISCONNECTED + "LOCAL MODEL UNAVAILABLE"
 *     (never an "Ollama unavailable" message, never a silent fallback);
 *   - an UP OpenAI-compatible local server shows Status CONNECTED, with the
 *     configured endpoint and model in the header;
 *   - no probe or completion ever targets 127.0.0.1:11434 under the default
 *     MODEL_PROVIDER=local configuration.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { Orchestrator } = require('../src/engine/orchestrator');
const { TUI } = require('../src/tui/tui');
const { startMockServer } = require('./fixtures/mock-openai-server');

class CaptureStream {
  constructor() { this.isTTY = false; this.chunks = []; }
  write(s) { this.chunks.push(s); return true; }
  toString() { return this.chunks.join(''); }
}

function configOverridden(baseUrl, model) {
  const { buildConfig } = require('../src/config');
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const cfg = buildConfig();
  // Use a throwaway temp workspace so the agent never touches the real repo.
  cfg.rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'klyvia-tui-conn-'));
  cfg.provider = 'local';
  cfg.local = { baseUrl, model, apiKey: 'local' };
  cfg.cloudFallback = false;
  cfg.maxSteps = 24;
  return cfg;
}

async function bootTUI(cfg) {
  const orch = new Orchestrator(cfg);
  const out = new CaptureStream();
  const input = new Readable({ read() {} });
  input.isTTY = false;
  const tui = new TUI(orch, { out, input });
  await tui.start().catch(() => {});
  return { tui, out };
}

test('down local server -> DISCONNECTED + LOCAL MODEL UNAVAILABLE (real Orchestrator)', async () => {
  process.env.NO_COLOR = '1';
  // A port that nothing listens on (NOT 11434).
  const cfg = configOverridden('http://127.0.0.1:65535/v1', 'qwen2.5-coder-1.5b-instruct');
  try {
    const { out, tui } = await bootTUI(cfg);
    const text = out.toString();
    assert.match(text, /Status\s+● DISCONNECTED/, 'status must be DISCONNECTED when the server is down');
    assert.match(text, /LOCAL MODEL UNAVAILABLE/);
    assert.match(text, /Cannot connect to:/);
    assert.match(text, /Start an OpenAI-compatible local model server/);
    assert.doesNotMatch(text, /Ollama unavailable|Ollama indisponible/i, 'must NOT blame Ollama for a generic local endpoint');
    assert.doesNotMatch(text, /11434/, 'must not reference the Ollama port for a generic endpoint');
    tui._teardown();
  } finally {
    delete process.env.NO_COLOR;
  }
});

test('up OpenAI-compatible local server -> CONNECTED with configured endpoint+model', async () => {
  process.env.NO_COLOR = '1';
  const { server, url } = await startMockServer({ fixes: [] });
  try {
    const cfg = configOverridden(url, 'my-local-coder');
    const { out, tui } = await bootTUI(cfg);
    const text = out.toString();
    assert.match(text, /Status\s+● CONNECTED/, 'status must be CONNECTED when the server is up');
    assert.match(text, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'header must show the configured endpoint');
    assert.match(text, /my-local-coder/, 'header must show the configured model name');
    assert.match(text, /Backend\s+llama\.cpp/, 'generic endpoint shows the generic backend label, not Ollama');
    assert.doesNotMatch(text, /LOCAL MODEL UNAVAILABLE/);
    assert.doesNotMatch(text, /11434/);
    tui._teardown();
  } finally {
    server.close();
    delete process.env.NO_COLOR;
  }
});

test('a real completion against the UP local server uses the configured endpoint+model, not Ollama', async () => {
  // Goes through the REAL Orchestrator (orch.run -> agent -> modelRouter ->
  // Provider -> HTTP) so the execution path -- not just the probe -- is
  // exercised against a real (mocked) OpenAI-compatible endpoint. The mock
  // server records the host header and request body it actually received.
  const http = require('http');
  const received = { host: null, model: null, completions: 0 };
  const srv = http.createServer((req, res) => {
    received.host = req.headers.host || '';
    if (req.url === '/v1/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'exec-model', object: 'model' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.completions++;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { /* ignore */ }
        received.model = parsed.model;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-x', object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Nothing to do.', tool_calls: [{ id: 'c-finish', type: 'function', function: { name: 'finish', arguments: JSON.stringify({ summary: 'done' }) } }] }, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  const url = `http://127.0.0.1:${port}/v1`;
  try {
    const cfg = configOverridden(url, 'exec-model');
    const orch = new Orchestrator(cfg);
    await orch.run('Do nothing.');
    assert.ok(received.completions >= 1, 'the execution path must send a real completion to the local endpoint');
    assert.equal(received.model, 'exec-model', 'the configured model name must be forwarded in the request body');
    assert.doesNotMatch(received.host || '', /11434/, 'no request may target the Ollama port');
  } finally {
    srv.close();
  }
});
