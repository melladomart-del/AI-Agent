require('dotenv').config();
const OpenAI = require('openai');
const { readFile } = require('./tools/readFile');
const { writeFile } = require('./tools/writeFile');
const { runCommand } = require('./tools/runCommand');
const { gitCommit } = require('./tools/gitCommit');
const { searchCode } = require('./tools/searchCode');

const fs = require('fs');
function loadSkills() {
  const dir = './skills';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  return files.map(f => fs.readFileSync(dir + '/' + f, 'utf-8')).join('\n\n');
}
const client = new OpenAI({
  apiKey: process.env.OPENROUTER_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

const tools = [
  {
    type: 'function',
    function: {
      name: 'readFile',
      description: 'Lit le contenu d\'un fichier',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Chemin du fichier' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'writeFile',
      description: 'Ecrit du contenu dans un fichier',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin du fichier' },
          content: { type: 'string', description: 'Contenu a ecrire' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runCommand',
      description: 'Execute une commande shell',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Commande a executer' } },
        required: ['command'],
      },
    },
  },
];

const gitCommitTool = {
  type: 'function',
  function: {
    name: 'gitCommit',
    description: 'Ajoute tous les fichiers modifies et cree un commit git',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Message du commit' } },
      required: ['message'],
    },
  },
};
tools.push(gitCommitTool);
tools.push({
  type: 'function',
  function: {
    name: 'searchCode',
    description: 'Recherche un texte dans tous les fichiers de code du projet',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Texte a rechercher' } },
      required: ['query'],
    },
  },
});

function callTool(name, args) {
  if (name === 'readFile') return readFile(args.path);
  if (name === 'writeFile') return writeFile(args.path, args.content);
  if (name === 'runCommand') return runCommand(args.command);
  if (name === 'gitCommit') return gitCommit(args.message);
  if (name === 'searchCode') return searchCode(args.query);
  return `Outil inconnu: ${name}`;
}

async function main() {
  const userRequest = process.argv.slice(2).join(' ');
  if (!userRequest) {
    console.log('Usage: node agent.js "ta demande"');
    return;
  }

  const messages = [
    { role: 'system', content: 'Tu es un agent capable de lire, ecrire des fichiers et executer des commandes shell pour accomplir des taches de developpement.\n\n' + loadSkills() },
    { role: 'user', content: userRequest },
  ];

  for (let step = 0; step < 30; step++) {
    const response = await client.chat.completions.create({
      model: 'openrouter/free',
      messages,
      tools,
    });

    const message = response.choices[0].message;
    messages.push(message);

    if (!message.tool_calls) {
      console.log('--- Reponse finale ---');
      console.log(message.content);
      return;
    }

    for (const toolCall of message.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);
      console.log(`--- Outil appele: ${toolCall.function.name}(${JSON.stringify(args)}) ---`);
      const result = callTool(toolCall.function.name, args);
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: String(result),
      });
    }
  }

  console.log('Limite d\'etapes atteinte.');
}

main();
