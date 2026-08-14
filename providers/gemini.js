const OpenAI = require('openai');
const AIProvider = require('./base');

class GeminiProvider extends AIProvider {
  constructor(config = {}) {
    super(config);

    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.GEMINI_API_KEY,
      baseURL: config.baseURL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
    });
  }

  async chat({ model = 'gemini-2.5-flash', messages, tools }) {
    return this.client.chat.completions.create({
      model,
      messages,
      tools,
    });
  }
}

module.exports = GeminiProvider;
