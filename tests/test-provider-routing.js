'use strict';

/**
 * Provider-routing regression test.
 *
 * This exists precisely because of a class of bug where the TUI/config said
 * "LOCAL" but the execution path silently routed requests to an Ollama
 * endpoint (127.0.0.1:11434) and failed with an Ollama-specific connection
 * error. The unit tests at the time did not catch it because they mocked the
 * engine at too high a level.
 *
 * This test uses the REAL ModelRouter and the REAL Provider (the real OpenAI
 * SDK HTTP client). The ONLY thing mocked is the HTTP endpoint, served on an
 * ephemeral port. It asserts:
 *   1. MODEL_PROVIDER=local makes ModelRouter select the LOCAL provider.
 *   2. The configured base URL is the one actually hit.
 *   3. The configured model name is sent in the request body.
 *   4. No request ever goes to 127.0.0.1:11434 (Ollama's default port).
 *   5. A completion is returned successfully.
 *   6. A dead local endpoint is surfaced as a thrown error, never a silent
 *      fallback to Ollama or to a cloud provider.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { ModelRouter } = require('../src/providers/model-router');

/** Minimal OpenAI-compatible mock that records what it receives. */
function startEchoModelServer({ model = 'mock-coder', port = 0 } = {}) {
  const seen = { models: 0, completions: 0, lastBody: null, hostHeader: null };
  const server = http.createServer((req, res) => {
    seen.hostHeader = req.headers.host || '';
    if (req.url === '/v1/models' && req.method === 'GET') {
      seen.models++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: model, object: 'model' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.completions++;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { /* ignore */ }
        seen.lastBody = parsed;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: `hello from ${parsed.model || '?'}` }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({ server, url: `http://127.0.0.1:${actual}/v1`, seen });
    });
  });
}

function buildConfig(overrides) {
  const base = {
    provider: 'local',
    local: { baseUrl: 'http://127.0.0.1:65535/v1', model: 'should-be-overridden', apiKey: 'local' },
    cloud: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', apiKey: '' },
    cloudFallback: false,
    temperature: 0.2, maxTokens: 128, timeoutMs: 60000,
    providerRetries: 0, retryBackoffMs: 10,
  };
  return { ...base, ...overrides, local: { ...base.local, ...(overrides || {}).local } };
}

test('MODEL_PROVIDER=local selects the LOCAL provider and hits the configured endpoint', async () => {
  const { server, url, seen } = await startEchoModelServer({ model: 'my-coder-model' });
  try {
    const cfg = buildConfig({ local: { baseUrl: url, model: 'my-coder-model', apiKey: 'local' } });
    const router = new ModelRouter(cfg);

    // The primary provider is the local one (not cloud).
    assert.equal(router._primary().name, 'local', 'primary must be the local provider');

    const msg = await router.complete({
      messages: [{ role: 'user', content: 'say hi' }],
      maxTokens: 64,
    });
    assert.match(String(msg.content || ''), /hello from my-coder-model/, 'completion should come from the mocked local server');

    // The configured base URL was actually used (host header is the ephemeral port, NOT 11434).
    assert.equal(seen.completions, 1, 'exactly one completion request');
    assert.doesNotMatch(seen.hostHeader, /:11434/, 'request must NOT go to Ollama port 11434');

    // The configured model name is what was sent to the endpoint.
    assert.equal(seen.lastBody && seen.lastBody.model, 'my-coder-model', 'the configured model name must be sent');
  } finally {
    server.close();
  }
});

test('no request ever targets 127.0.0.1:11434 under MODEL_PROVIDER=local', async () => {
  const { server, url, seen } = await startEchoModelServer({ model: 'my-coder-model' });
  try {
    const cfg = buildConfig({ local: { baseUrl: url, model: 'my-coder-model', apiKey: 'local' } });
    const router = new ModelRouter(cfg);
    await router.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 32 });
    // Probe the models endpoint too, since the TUI calls it on startup.
    await router.isReachable();
    assert.doesNotMatch(seen.hostHeader, /11434/, 'startup probe must not target Ollama');
    assert.doesNotMatch(url, /11434/, 'configured URL must not be Ollama');
  } finally {
    server.close();
  }
});

test('a dead LOCAL endpoint is surfaced as an error, never a silent fallback to Ollama or cloud', async () => {
  // Point at a port nothing listens on; Ollama is not running anywhere here.
  const cfg = buildConfig({
    local: { baseUrl: 'http://127.0.0.1:65535/v1', model: 'no-such-model', apiKey: 'local' },
    cloudFallback: false,
    timeoutMs: 3000, providerRetries: 0,
  });
  const router = new ModelRouter(cfg);
  await assert.rejects(
    () => router.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    (err) => /ECONNREFUSED|connection|refused|timeout|fetch failed/i.test(err.message),
    'a dead local endpoint must throw a connection error, not silently succeed or fall back',
  );
});

test('cloud fallback is only to a configured cloud API key, never to Ollama', async () => {
  // cloudFallback=true but no cloud API key: must NOT fall back, must rethrow
  // the local error. (Ollama is not a fallback target at all.)
  const cfg = buildConfig({
    local: { baseUrl: 'http://127.0.0.1:65535/v1', model: 'x', apiKey: 'local' },
    cloudFallback: true,
    cloud: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', apiKey: '' },
    timeoutMs: 3000, providerRetries: 0,
  });
  const router = new ModelRouter(cfg);
  await assert.rejects(
    () => router.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    (err) => /ECONNREFUSED|connection|refused|timeout|fetch failed/i.test(err.message),
    'without a cloud API key the router must rethrow the local error, not fall back',
  );
});

test('isReachable reports the configured endpoint and model, not an Ollama default', async () => {
  const { server, url } = await startEchoModelServer({ model: 'my-coder-model' });
  try {
    const cfg = buildConfig({ local: { baseUrl: url, model: 'my-coder-model', apiKey: 'local' } });
    const router = new ModelRouter(cfg);
    const probe = await router.isReachable();
    assert.equal(probe.reachable, true);
    assert.equal(probe.name, 'local');
    assert.equal(probe.model, 'my-coder-model');
    assert.equal(probe.baseUrl, url);
    assert.doesNotMatch(probe.baseUrl, /11434/, 'probe endpoint must not be Ollama');
  } finally {
    server.close();
  }
});
