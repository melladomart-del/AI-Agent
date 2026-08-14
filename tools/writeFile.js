const fs = require('fs');

function writeFile(path, content) {
  fs.writeFileSync(path, content, 'utf-8');
  return `Fichier ${path} écrit avec succès.`;
}

module.exports = { writeFile };
