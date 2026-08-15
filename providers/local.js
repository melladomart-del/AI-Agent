const OpenAI = require('openai');
const AIProvider = require('./base');

class LocalProvider extends AIProvider {
  constructor(config = {}) {
    super(config);

    this.client = new OpenAI({
      apiKey: config.apiKey || 'local',
      baseURL: config.baseURL || 'http://localhost:11434/v1',
    });
  }

  async chat({ model = 'qwen2.5-coder:3b', messages, tools }) {
    const response = await this.client.chat.completions.create({
      model,
      messages,
      tools,
    });

    const message = response.choices?.[0]?.message;

    if (message && !message.tool_calls && typeof message.content === 'string') {
      try {
        const parsed = JSON.parse(message.content);

        if (parsed?.name && parsed?.arguments !== undefined) {
          message.tool_calls = [{
            id: `local_${Date.now()}`,
            type: 'function',
            function: {
              name: parsed.name,
              arguments: JSON.stringify(parsed.arguments)
            }
          }];

          message.content = null;
        }
      } catch {
        // Réponse normale, pas un tool call JSON.
      }
    }

    return response;
  }
}

module.exports = LocalProvider;
