require('dotenv').config();

const { Agent } = require('./engine/agent');

async function main() {
  const userRequest = process.argv.slice(2).join(' ');

  if (!userRequest) {
    console.log('Usage: node agent.js "ta demande"');
    return;
  }

  try {
    const agent = new Agent({
      provider: process.env.AI_PROVIDER || 'gemini',
      model: process.env.AI_MODEL || 'gemini-3.5-flash'
    });

    const result = await agent.run(userRequest);

    console.log('--- Reponse finale ---');
    console.log(result.content);
  } catch (error) {
    console.error('Erreur:', error.message);
    process.exitCode = 1;
  }
}

main();
