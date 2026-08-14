const { execSync } = require('child_process');

function deployNetlify(folderPath) {
  try {
    const output = execSync(
      `npx netlify deploy --dir="${folderPath}" --prod --auth=$NETLIFY_TOKEN`,
      { encoding: 'utf-8' }
    );
    return output;
  } catch (error) {
    return `Erreur: ${error.message}`;
  }
}

module.exports = { deployNetlify };
