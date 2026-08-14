class AIProvider {
  constructor(config = {}) {
    this.config = config;
  }

  async chat() {
    throw new Error('chat() must be implemented by the provider');
  }
}

module.exports = AIProvider;
