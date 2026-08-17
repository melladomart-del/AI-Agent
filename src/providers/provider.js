'use strict';

const OpenAI = require('openai');

/**
 * A single OpenAI-compatible backend (llama.cpp, Ollama, LM Studio, vLLM,
 * OpenRouter, OpenAI, ...). The agent engine never knows which one it is.
 */
class Provider {
  constructor({ name, baseUrl, model, apiKey, temperature, maxTokens, timeoutMs }) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.model = model;
    this.client = new OpenAI({
      apiKey: apiKey || 'local',
      baseURL: baseUrl,
      timeout: timeoutMs || 120000,
      maxRetries: 0, // we retry + fallback at the router level
    });
    this.temperature = temperature ?? 0.2;
    this.maxTokens = maxTokens ?? 2048;
  }

  /**
   * @param {object} opts
   * @param {Array} opts.messages
   * @param {Array} [opts.tools] - OpenAI-style function tool schemas
   * @param {string} [opts.toolChoice]
   * @param {number} [opts.temperature]
   * @param {number} [opts.maxTokens]
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
    const res = await this.client.chat.completions.create(body);
    return res.choices[0].message;
  }
}

module.exports = { Provider };
