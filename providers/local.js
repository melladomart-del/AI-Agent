const OpenAI = require('openai');
const AIProvider = require('./base');

class LocalProvider extends AIProvider {
  constructor(config = {}) {
    super(config);

    this.baseURL =
      config.baseURL ||
      process.env.OLLAMA_BASE_URL ||
      'http://127.0.0.1:11434/v1';

    this.timeout =
      Number(config.timeout || process.env.OLLAMA_TIMEOUT || 120000);

    this.retries =
      Number(config.retries ?? process.env.OLLAMA_RETRIES ?? 2);

    this.client = new OpenAI({
      apiKey: config.apiKey || 'local',
      baseURL: this.baseURL,
      timeout: this.timeout,
      maxRetries: 0
    });
  }

  async chat({
    model = 'qwen2.5-coder:3b',
    messages,
    tools
  }) {
    let lastError;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response =
          await this.client.chat.completions.create({
            model,
            messages,
            ...(tools?.length ? { tools } : {})
          });

        const message = response.choices?.[0]?.message;

        if (
          message &&
          !message.tool_calls &&
          typeof message.content === 'string'
        ) {
          try {
            const parsed = JSON.parse(message.content);

            if (
              parsed?.name &&
              parsed?.arguments !== undefined
            ) {
              message.tool_calls = [
                {
                  id: `local_${Date.now()}`,
                  type: 'function',
                  function: {
                    name: parsed.name,
                    arguments: JSON.stringify(parsed.arguments)
                  }
                }
              ];

              message.content = null;
            }
          } catch {
            // Réponse texte normale.
          }
        }

        return response;
      } catch (error) {
        lastError = error;

        const isLastAttempt = attempt >= this.retries;

        if (isLastAttempt) break;

        const delay = Math.min(1000 * 2 ** attempt, 5000);

        console.warn(
          `[local] tentative ${attempt + 1}/${this.retries + 1} échouée — nouvelle tentative dans ${delay}ms`
        );

        await new Promise(resolve =>
          setTimeout(resolve, delay)
        );
      }
    }

    throw new Error(
      `Ollama indisponible après ${this.retries + 1} tentative(s): ${
        lastError?.message || lastError
      }`
    );
  }
}

module.exports = LocalProvider;
