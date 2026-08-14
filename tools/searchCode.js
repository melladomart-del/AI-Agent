const { execSync } = require('child_process');

function searchCode(query) {
  try {
    const output = execSync(`grep -rn "${query}" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" . --exclude-dir=node_modules --exclude-dir=.git`, { encoding: 'utf-8' });
    return output;
  } catch (error) {
    return 'Aucun resultat trouve.';
  }
}

module.exports = { searchCode };
