const AIProvider = require('./base');

class GeminiProvider extends AIProvider {
  constructor(config = {}) {
    super(config);

    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    this.baseURL =
      config.baseURL ||
      'https://generativelanguage.googleapis.com/v1beta';
  }

  async chat({ model = 'gemini-3.5-flash', messages = [], tools = [] }) {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY manquante');
    }

    const contents = [];
    let systemInstruction = null;

    for (const message of messages) {
      if (message.role === 'system') {
        systemInstruction = {
          parts: [{ text: message.content || '' }]
        };
        continue;
      }

      if (message.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: message.content || '' }]
        });
        continue;
      }

      if (message.role === 'assistant') {
        const parts = [];

        if (message.content) {
          parts.push({ text: message.content });
        }

        if (message.tool_calls) {
          for (const call of message.tool_calls) {
            const functionCall = {
              name: call.function.name,
              args: JSON.parse(call.function.arguments || '{}')
            };

            const part = { functionCall };

            if (call.thought_signature) {
              part.thoughtSignature = call.thought_signature;
            }

            parts.push(part);
          }
        }

        contents.push({
          role: 'model',
          parts
        });
        continue;
      }

      if (message.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: message.name || 'tool',
                response: {
                  result: message.content || ''
                }
              }
            }
          ]
        });
      }
    }

    const body = {
      contents
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    if (tools.length) {
      body.tools = [
        {
          functionDeclarations: tools
            .filter(tool => tool.type === 'function')
            .map(tool => ({
              name: tool.function.name,
              description: tool.function.description,
              parameters: tool.function.parameters
            }))
        }
      ];
    }

    const response = await fetch(
      `${this.baseURL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        `Gemini ${response.status}: ${
          data.error?.message || 'Erreur inconnue'
        }`
      );
    }

    return this.normalizeResponse(data);
  }

  normalizeResponse(data) {
    const parts = data.candidates?.[0]?.content?.parts || [];

    let content = '';
    const tool_calls = [];

    for (const part of parts) {
      if (part.text) {
        content += part.text;
      }

      if (part.functionCall) {
        const toolCall = {
          id: `gemini_${tool_calls.length + 1}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {})
          }
        };

        if (part.thoughtSignature) {
          toolCall.thought_signature = part.thoughtSignature;
        }

        tool_calls.push(toolCall);
      }
    }

    const message = {
      role: 'assistant',
      content: content || null
    };

    if (tool_calls.length) {
      message.tool_calls = tool_calls;
    }

    return {
      choices: [{ message }],
      raw: data
    };
  }
}

module.exports = GeminiProvider;
