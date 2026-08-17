'use strict';

const OpenAI = require('openai');
const { normalizeMessage } = require('./tool-normalize');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A single OpenAI-compatible backend (llama.cpp, LM Studio, vLLM, OpenRouter,
 * OpenAI, or Ollama's OpenAI endpoint as an optional compatibility backend).
 * The agent engine never knows which one it is -- it only speaks the
 * OpenAI-compatible HTTP API, so any conformant local server works.
 *
 * Responsibilities:
 *   - call the backend via the OpenAI SDK
 *   - normalize whatever the model returns into ONE canonical message shape
 *     (so small local models that emit tool calls as text still work)
 *   - retry transient connection/timeout errors with backoff
 */
class Provider {
  constructor({ name, baseUrl, model, apiKey, temperature, maxTokens, timeoutMs, maxRetries, retryBackoffMs }) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.model = model;
    this.client = new OpenAI({
      apiKey: apiKey || 'local',
      baseURL: baseUrl,
      timeout: timeoutMs || 120000,
      maxRetries: 0, // we retry + fallback at the router/provider level
    });
    this.temperature = temperature ?? 0.2;
    this.maxTokens = maxTokens ?? 2048;
    this.maxRetries = maxRetries ?? 1;
    this.retryBackoffMs = retryBackoffMs ?? 750;
  }

  static isTransient(err) {
    if (!err) return false;
    // Connection / timeout / 5xx are worth retrying. 4xx (auth, bad request,
    // model not found) are not — retrying won't help and hides config errors.
    const status = err.status || err.statusCode;
    if (status && status >= 500 && status < 600) return true;
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') return true;
    if (err.name === 'APIConnectionError' || err.name === 'APITimeoutError') return true;
    return false;
  }

  /**
   * Short-timeout reachability probe. We build a throwaway client with a small
   * timeout (default 3s) so a hung server does not stall the TUI. Returns
   * { reachable, error }. Resolves rather than throws.
   */
  async probe({ timeoutMs = 3000 } = {}) {
    try {
      const probeClient = new OpenAI({
        apiKey: this.apiKey || 'local',
        baseURL: this.baseUrl,
        timeout: timeoutMs,
        maxRetries: 0,
      });
      await probeClient.models.list();
      return { reachable: true };
    } catch (err) {
      return { reachable: false, error: err.message, code: err.code, status: err.status || err.statusCode };
    }
  }

  /**
   * @param {object} opts
   * @param {Array} opts.messages
   * @param {Array} [opts.tools] - OpenAI-style function tool schemas
   * @param {Array<string>} [opts.knownToolNames] - valid tool names, for normalization
   * @param {string} [opts.toolChoice]
   * @param {number} [opts.temperature]
   * @param {number} [opts.maxTokens]
   * @returns {Promise<object>} canonical assistant message:
   *   { role, content, tool_calls: [{id,type,function:{name,arguments:string}}] }
   */
  async complete(opts) {
    const body = {
      model: this.model,
      messages: opts.messages,
      temperature: opts.temperature ?? this.temperature,
      max_tokens: opts.maxTokens ?? this.maxTokens,
    };
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools;
      if (opts.toolChoice) body.tool_choice = opts.toolChoice;
    }
    const known = opts.knownToolNames && opts.knownToolNames.length ? new Set(opts.knownToolNames) : null;

    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await this.client.chat.completions.create(body);
        return normalizeMessage(res.choices[0].message, { knownNames: known });
      } catch (err) {
        lastErr = err;
        if (attempt < this.maxRetries && Provider.isTransient(err)) {
          await sleep(this.retryBackoffMs * (attempt + 1));
          continue;
        }
        break;
      }
    }
    throw lastErr;
  }
}

module.exports = { Provider };
