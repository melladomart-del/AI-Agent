const fs = require('fs');

function readFile(path) {
  return fs.readFileSync(path, 'utf-8');
}

module.exports = { readFile };
