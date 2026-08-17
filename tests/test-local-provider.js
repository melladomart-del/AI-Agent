'use strict';

/**
 * Local provider smoke test.
 *
 * Verifies that the configured OpenAI-compatible LOCAL endpoint:
 *   1. is reachable,
 *   2. responds with a completion for a simple coding prompt,
 *   3. can represent a tool call (native or normalized from text),
 *   4. handles a malformed/unavailable response cleanly.
 *
 * This test NEVER silently falls back to a cloud provider. It is skipped with
 * a clear reason when no local server is reachable, so it cannot pass by
 * accident against the cloud backend.
 *
 * Enable against a running local server by setting:
 *   AI_AGENT_LIVE=1
 *   LOCAL_MODEL_BASE_URL=http://127.0.0.1:8080/v1
 *   LOCAL_MODEL_NAME=<your model id>
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Provider } = require('../src/providers/provider');
const { buildConfig } = require('../src/config');

const LIVE = process.env.AI_AGENT_LIVE === '1';
const cfg = buildConfig();
const baseUrl = cfg.local.baseUrl;
const modelName = cfg.local.model;

async function isReachable(url) {
  const u = new URL(url);
  const net = require('net');
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(3000);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.once('error', () => resolve(false));
    sock.connect(Number(u.port || 80), u.hostname);
  });
}

const skipReason = !LIVE ? 'set AI_AGENT_LIVE=1 with a running local server' : '';

// node:test treats { skip: <truthy> } as a skip directive, so only pass it
// when we actually want to skip (empty string is NOT skipped at the test level,
// but the helper below keeps this explicit).
const skip = skipReason || undefined;

test('local endpoint is reachable', { skip }, async () => {
  const ok = await isReachable(baseUrl);
  if (!ok) throw new Error(`Local model server not reachable at ${baseUrl}. Start it (e.g. llama-server / ollama serve) and set LOCAL_MODEL_BASE_URL.`);
  assert.equal(ok, true);
});

test('local model responds to a simple coding prompt', { skip }, async () => {
  const provider = new Provider({ name: 'local', baseUrl, model: modelName, apiKey: 'local', timeoutMs: 60000, maxRetries: 0 });
  const msg = await provider.complete({
    messages: [{ role: 'user', content: 'In one short sentence, what does `Array.map` do in JavaScript?' }],
    maxTokens: 128,
  });
  assert.ok(msg.content || (msg.tool_calls && msg.tool_calls.length), 'model returned no content and no tool calls');
});

test('local model can represent a tool call', { skip }, async () => {
  const provider = new Provider({ name: 'local', baseUrl, model: modelName, apiKey: 'local', timeoutMs: 60000, maxRetries: 0 });
  const msg = await provider.complete({
    messages: [
      { role: 'system', content: 'You call tools to inspect code. Available tool: readFile.' },
      { role: 'user', content: 'Read the file src/app.js using the readFile tool.' },
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'readFile',
        description: 'Read the full contents of a file.',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    }],
    knownToolNames: ['readFile'],
    maxTokens: 256,
  });
  assert.ok(
    msg.tool_calls && msg.tool_calls.length,
    `expected a tool call. content was: ${String(msg.content).slice(0, 200)}`,
  );
  assert.equal(msg.tool_calls[0].function.name, 'readFile');
});

test('provider handles a missing/unavailable model cleanly (no silent cloud fallback)', async () => {
  // Point at a port nothing is listening on; expect a thrown connection error,
  // never a fake success and never a fallback to a cloud provider.
  const provider = new Provider({
    name: 'local', baseUrl: 'http://127.0.0.1:65535/v1', model: 'no-such-model',
    apiKey: 'local', timeoutMs: 3000, maxRetries: 0,
  });
  await assert.rejects(
    () => provider.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    (err) => /ECONNREFUSED|connection|refused|timeout|fetch failed/i.test(err.message),
    'provider must surface the connection failure, not silently succeed or fall back',
  );
});
