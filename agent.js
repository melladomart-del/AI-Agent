require('dotenv').config();
const fs = require('fs');
const OpenAI = require('openai');
const { readFile } = require('./tools/readFile');
const { writeFile } = require('./tools/writeFile');
const { runCommand } = require('./tools/runCommand');
const { gitCommit } = require('./tools/gitCommit');
const { searchCode } = require('./tools/searchCode');
const { deployNetlify } = require('./tools/deployNetlify');
const { listFiles } = require('./tools/listFiles');

function loadSkills() {
  const dir = './skills';
  if (!fs.existsSync(dir)) return '';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  return files.map(f => fs.readFileSync(dir + '/' + f, 'utf-8')).join('\n\n');
}

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

const tools = [
{
  type: "function",
  function: {
    name: "listFiles",
    description: "Liste les fichiers et dossiers du projet pour permettre à l'agent d'inspecter sa structure avant de lire ou modifier des fichiers.",
    parameters: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Dossier à explorer, par défaut ." },
        maxDepth: { type: "number", description: "Profondeur maximale de recherche" }
      },
      required: []
    }
  }
},
  { type: 'function', function: { name: 'readFile', description: 'Lit le contenu d un fichier', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'writeFile', description: 'Ecrit du contenu dans un fichier', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'runCommand', description: 'Execute une commande shell', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'gitCommit', description: 'Ajoute tous les fichiers et cree un commit git', parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } } },
  { type: 'function', function: { name: 'searchCode', description: 'Recherche un texte dans le code du projet', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'deployNetlify', description: 'Deploie un dossier sur Netlify et retourne l URL publique', parameters: { type: 'object', properties: { folderPath: { type: 'string' } }, required: ['folderPath'] } } },
];

function callTool(name, args) {
  if (name === "listFiles") return listFiles(args.dir || ".", args.maxDepth ?? 3);

  if (name === 'readFile') return readFile(args.path);
  if (name === 'writeFile') return writeFile(args.path, args.content);
  if (name === 'runCommand') return runCommand(args.command);
  if (name === 'gitCommit') return gitCommit(args.message);
  if (name === 'searchCode') return searchCode(args.query);
  if (name === 'deployNetlify') return deployNetlify(args.folderPath);
  return `Outil inconnu: ${name}`;
}

async function main() {
  const userRequest = process.argv.slice(2).join(' ');
  if (!userRequest) {
    console.log('Usage: node agent.js "ta demande"');
    return;
  }

  const messages = [
    { role: 'system', content: 'Tu es un agent capable de lire, ecrire des fichiers, executer des commandes shell, committer sur git et deployer sur Netlify pour accomplir des taches de developpement.\n\n' + loadSkills() },
    { role: 'user', content: userRequest },
  ];

  for (let step = 0; step < 30; step++) {
    const response = await client.chat.completions.create({ model: 'openrouter/free', messages, tools });
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
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: String(result) });
    }
  }
  console.log('Limite d etapes atteinte.');
}

main();
