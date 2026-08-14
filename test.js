require('dotenv').config();
const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENROUTER_KEY, baseURL: 'https://openrouter.ai/api/v1' });
async function main() {
  const response = await client.chat.completions.create({ model: 'openrouter/free', messages: [{ role: 'user', content: 'Réponds uniquement par OK' }] });
  console.log(response.choices[0].message.content);
}
main();
