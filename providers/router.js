const { createProvider } = require('./index');

class ProviderRouter {
  constructor(config = {}) {
    this.config = config;
    this.providers = {};
  }

  get(name) {
    if (this.providers[name]) {
      return this.providers[name];
    }

    const providerConfig = this.config[name];

    if (providerConfig === false) {
      throw new Error(`Provider non disponible: ${name}`);
    }

    const provider = createProvider(name, providerConfig || {});
    this.providers[name] = provider;

    return provider;
  }

  list() {
    return Object.keys(this.providers);
  }
}

module.exports = ProviderRouter;
