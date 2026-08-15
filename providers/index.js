const OpenRouterProvider = require('./openrouter');
const GeminiProvider = require('./gemini');
const LocalProvider = require('./local');

function createProvider(type, config = {}) {
  switch (type) {
    case 'openrouter':
      return new OpenRouterProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'local':
      return new LocalProvider(config);
    default:
      throw new Error(`Provider inconnu: ${type}`);
  }
}

module.exports = { createProvider };
