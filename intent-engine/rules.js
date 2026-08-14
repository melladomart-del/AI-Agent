const COMMANDS = {
  '/help': 'help',
  '/model': 'model',
  '/tools': 'tools',
  '/skills': 'skills',
  '/status': 'status',
  '/clear': 'clear',
  '/exit': 'exit',
  '/quit': 'exit'
};

function classify(input) {
  const text = input.trim();
  const lower = text.toLowerCase();

  if (!text) {
    return { intent: 'empty', confidence: 1 };
  }

  if (COMMANDS[text]) {
    return {
      intent: COMMANDS[text],
      confidence: 1,
      source: 'command'
    };
  }

  if (/^(salut|bonjour|hello|hey|yo)\b/i.test(text)) {
    return {
      intent: 'conversation',
      confidence: 0.95,
      source: 'rule'
    };
  }

  if (
    /\b(liste|montre|explore|inspecte)\b/.test(lower) &&
    /\b(fichier|fichiers|dossier|dossiers|projet|structure)\b/.test(lower)
  ) {
    return {
      intent: 'inspect_project',
      confidence: 0.95,
      source: 'rule'
    };
  }

  if (
    /\b(lis|lire|ouvre|ouvrir|regarde)\b/.test(lower) &&
    (
      /\b(fichier|code|contenu)\b/.test(lower) ||
      /\.(js|mjs|jsx|ts|tsx|json|css|html|md|py|java|c|cpp)\b/i.test(lower)
    )
  ) {
    return {
      intent: 'read_file',
      confidence: 0.9,
      source: 'rule'
    };
  }

  if (
    /\b(modifie|modifier|change|changer|écris|ecris|crée|cree|ajoute|supprime)\b/.test(lower)
  ) {
    return {
      intent: 'modify_code',
      confidence: 0.85,
      source: 'rule'
    };
  }

  if (
    /\b(test|teste|tester|lance|exécute|execute|commande|npm|node|git)\b/.test(lower)
  ) {
    return {
      intent: 'run_command',
      confidence: 0.85,
      source: 'rule'
    };
  }

  if (
    /\b(bug|erreur|error|ne marche|fonctionne pas|problème|probleme|debug)\b/.test(lower)
  ) {
    return {
      intent: 'debug',
      confidence: 0.9,
      source: 'rule'
    };
  }

  return {
    intent: 'agent_task',
    confidence: 0.5,
    source: 'fallback'
  };
}

module.exports = {
  classify,
  COMMANDS
};
