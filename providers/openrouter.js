const OpenAI = require('openai');
const AIProvider = require('./base');

class OpenRouterProvider extends AIProvider {
  constructor(config = {}) {
    super(config);

    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENROUTER_KEY,
      baseURL: config.baseURL || 'https://openrouter.ai/api/v1',
    });
  }

  async chat({ model = 'openrouter/free', messages, tools }) {
    return this.client.chat.completions.create({
      model,
      messages,
      tools,
    });
  }
}

module.exports = OpenRouterProvider;
