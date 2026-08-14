const { execSync } = require('child_process');

function gitCommit(message) {
  try {
    execSync('git add -A', { encoding: 'utf-8' });
    const output = execSync(`git commit -m "${message}"`, { encoding: 'utf-8' });
    return output;
  } catch (error) {
    return `Erreur: ${error.message}`;
  }
}

module.exports = { gitCommit };
