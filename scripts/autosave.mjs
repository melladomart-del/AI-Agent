import { execSync } from 'node:child_process';

const INTERVAL = 5 * 60 * 1000;

function run(command) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function save() {
  try {
    const status = run('git status --porcelain');

    if (!status) {
      console.log(`[autosave] ${new Date().toLocaleTimeString()} — rien à sauvegarder`);
      return;
    }

    run('git add -A');

    // Sécurité : ne jamais versionner les fichiers d'environnement.
    run('git reset -- .env .env.* 2>/dev/null || true');

    const remaining = run('git status --porcelain');

    if (!remaining) {
      console.log('[autosave] uniquement des fichiers ignorés/sensibles');
      return;
    }

    run(`git commit -m "chore: autosave ${new Date().toISOString()}"`);
    run('git push -u origin autosave');

    console.log('[autosave] sauvegarde poussée ✓');
  } catch (error) {
    console.error('[autosave] erreur:', error.message);
  }
}

console.log('[autosave] actif — sauvegarde toutes les 5 minutes');
save();
setInterval(save, INTERVAL);
