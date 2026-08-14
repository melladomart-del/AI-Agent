const OpenRouterProvider = require('./openrouter');
const GeminiProvider = require('./gemini');

function createProvider(type, config = {}) {
  switch (type) {
    case 'openrouter':
      return new OpenRouterProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    default:
      throw new Error(`Provider inconnu: ${type}`);
  }
}

module.exports = { createProvider };
