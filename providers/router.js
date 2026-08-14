const { createProvider } = require('./index');

class ProviderRouter {
  constructor(config = {}) {
    this.providers = {};

    if (config.openrouter !== false) {
      this.providers.openrouter = createProvider('openrouter', config.openrouter || {});
    }

    if (config.gemini !== false) {
      this.providers.gemini = createProvider('gemini', config.gemini || {});
    }
  }

  get(name) {
    const provider = this.providers[name];

    if (!provider) {
      throw new Error(`Provider non disponible: ${name}`);
    }

    return provider;
  }

  list() {
    return Object.keys(this.providers);
  }
}

module.exports = ProviderRouter;
