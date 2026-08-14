const fs = require("fs");
const path = require("path");

function listFiles(dir = ".", maxDepth = 3, currentDepth = 0) {
  if (currentDepth > maxDepth) return [];

  const results = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(fullPath + "/");
      results.push(...listFiles(fullPath, maxDepth, currentDepth + 1));
    } else {
      results.push(fullPath);
    }
  }

  return results;
}

module.exports = { listFiles };
