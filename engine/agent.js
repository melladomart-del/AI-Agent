require('dotenv').config();
const fs = require('fs');
const ProviderRouter = require('../providers/router');

const { readFile } = require('../tools/readFile');
const { writeFile } = require('../tools/writeFile');
const { runCommand } = require('../tools/runCommand');
const { gitCommit } = require('../tools/gitCommit');
const { searchCode } = require('../tools/searchCode');
const { deployNetlify } = require('../tools/deployNetlify');
const { listFiles } = require('../tools/listFiles');

function loadSkills() {
  const dir = './skills';
  if (!fs.existsSync(dir)) return '';

  return fs.readdirSync(dir)
    .filter(file => file.endsWith('.md'))
    .map(file => fs.readFileSync(`${dir}/${file}`, 'utf8'))
    .join('\n\n');
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'listFiles',
      description: 'Liste les fichiers et dossiers du projet.',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string' },
          maxDepth: { type: 'number' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'readFile',
      description: 'Lit le contenu d’un fichier.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'writeFile',
      description: 'Écrit du contenu dans un fichier.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'runCommand',
      description: 'Exécute une commande shell.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'gitCommit',
      description: 'Ajoute les fichiers et crée un commit git.',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'searchCode',
      description: 'Recherche un texte dans le code.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deployNetlify',
      description: 'Déploie un dossier sur Netlify.',
      parameters: {
        type: 'object',
        properties: { folderPath: { type: 'string' } },
        required: ['folderPath']
      }
    }
  }
];

function callTool(name, args) {
  switch (name) {
    case 'listFiles':
      return listFiles(args.dir || '.', args.maxDepth ?? 3);
    case 'readFile':
      return readFile(args.path);
    case 'writeFile':
      return writeFile(args.path, args.content);
    case 'runCommand':
      return runCommand(args.command);
    case 'gitCommit':
      return gitCommit(args.message);
    case 'searchCode':
      return searchCode(args.query);
    case 'deployNetlify':
      return deployNetlify(args.folderPath);
    default:
      return `Outil inconnu: ${name}`;
  }
}

class Agent {
  constructor(config = {}) {
    this.providerName = config.provider || 'openrouter';
    this.model = config.model || 'openrouter/free';
    this.router = new ProviderRouter();
  }

  async run(userRequest, options = {}) {
    const providerName = options.provider || this.providerName;
    const model = options.model || this.model;
    const provider = this.router.get(providerName);

    const messages = [
      {
        role: 'system',
        content:
          'Tu es un agent autonome de développement. ' +
          'Inspecte le projet avant de modifier des fichiers. ' +
          'Utilise les outils nécessaires et vérifie ton travail.\n\n' +
          loadSkills()
      },
      { role: 'user', content: userRequest }
    ];

    for (let step = 0; step < 30; step++) {
      const response = await provider.chat({
        model,
        messages,
        tools
      });

      const message = response.choices[0].message;
      messages.push(message);

      if (!message.tool_calls) {
        return {
          content: message.content || '',
          messages,
          steps: step + 1
        };
      }

      for (const toolCall of message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        const result = callTool(toolCall.function.name, args);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: String(result)
        });
      }
    }

    throw new Error('Limite de 30 étapes atteinte.');
  }
}

module.exports = {
  Agent,
  tools,
  callTool,
  loadSkills
};
