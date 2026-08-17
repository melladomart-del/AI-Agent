'use strict';

const { Provider } = require('./provider');

/**
 * Routes model calls to a primary backend and, optionally, falls back to a
 * cloud backend when the primary fails. This is the only place that knows
 * about "local" vs "cloud"; the rest of the agent just calls modelRouter.
 *
 * Inspired by OpenHands' provider-agnostic LLM interface and OpenCode's
 * "not coupled to any model vendor" design principle.
 */
class ModelRouter {
  constructor(config) {
    this.config = config;
    this.local = new Provider({
      name: 'local',
      baseUrl: config.local.baseUrl,
      model: config.local.model,
      apiKey: config.local.apiKey,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs,
      maxRetries: config.providerRetries,
      retryBackoffMs: config.retryBackoffMs,
    });
    this.cloud = new Provider({
      name: 'cloud',
      baseUrl: config.cloud.baseUrl,
      model: config.cloud.model,
      apiKey: config.cloud.apiKey,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs,
      maxRetries: config.providerRetries,
      retryBackoffMs: config.retryBackoffMs,
    });
  }

  _primary() {
    return this.config.provider === 'cloud' ? this.cloud : this.local;
  }

  async complete(opts) {
    const primary = this._primary();
    try {
      return await primary.complete(opts);
    } catch (err) {
      if (!this.config.cloudFallback) throw err;
      // Only fall back to a configured cloud backend with an API key.
      if (!this.config.cloud.apiKey && this.config.provider !== 'cloud') throw err;
      this._warn(`primary provider "${primary.name}" failed (${err.message}); falling back to cloud`);
      return this.cloud.complete(opts);
    }
  }

  _warn(msg) {
    // eslint-disable-next-line no-console
    console.error(`[model-router] ${msg}`);
  }
}

module.exports = { ModelRouter };
