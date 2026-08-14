const { execSync } = require('child_process');

function runCommand(command) {
  try {
    const output = execSync(command, { encoding: 'utf-8' });
    return output;
  } catch (error) {
    return `Erreur: ${error.message}`;
  }
}

module.exports = { runCommand };
