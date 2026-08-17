'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Lightweight repository analyzer producing a token-budgeted "repo map".
 *
 * Inspired by Aider's tree-sitter repo map: extract symbol definitions
 * (functions, classes, exported identifiers), rank them by how often they are
 * referenced across the repo, and keep only the top symbols within a token
 * budget. Aider uses tree-sitter + PageRank + SQLite; we use regex symbol
 * extraction + reference counting, which is far lighter and good enough for the
 * small/medium repos this agent targets on an old PC.
 *
 * The output is a compact map like:
 *   src/engine/agent.js:
 *     - runAgent
 *     - Agent
 *   src/tools/files.js:
 *     - writeFile
 *     ...
 */

const IGNORED_DIRS = new Set(['node_modules', '.git', '.agent-memory', 'dist', 'build', '.next', '.cache']);
const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.c', '.cc', '.cpp', '.h', '.hpp']);

// Regex-based symbol extraction. Captures common "definition" shapes across
// several languages. Imperfect but dependency-free.
const SYMBOL_RE =
  // JS/TS: function declarations, const fn =, class, arrow consts, exports
  /(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?[^=]*=>)|(?:export\s+)?(?:class|interface|enum)\s+([A-Za-z_$][\w$]*)|def\s+([A-Za-z_][\w]*)|func\s+([A-Za-z_][\w]*)|public\s+(?:static\s+)?[A-Za-z<>\[\],\s]+\s+([A-Za-z_][\w]*)\s*\(/g;
// CommonJS / named-export fallback: `module.exports = function name()`,
// `exports.foo = ...`, and `module.exports = { a, b }`.
const EXPORTS_RE = /(?:module\.exports\s*=\s*function\s+([A-Za-z_$][\w$]*)|exports\.([A-Za-z_$][\w$]*)\s*=|module\.exports\s*=\s*\{([^}]*)\})/g;

function walkCodeFiles(rootDir) {
  const out = [];
  function walk(dir, prefix) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (CODE_EXT.has(path.extname(entry.name))) out.push(rel);
    }
  }
  walk(rootDir, '');
  return out;
}

function extractSymbols(content) {
  const symbols = new Set();
  let m;
  SYMBOL_RE.lastIndex = 0;
  while ((m = SYMBOL_RE.exec(content)) !== null) {
    for (let i = 1; i < m.length; i++) {
      if (m[i]) symbols.add(m[i]);
    }
  }
  EXPORTS_RE.lastIndex = 0;
  while ((m = EXPORTS_RE.exec(content)) !== null) {
    if (m[1]) symbols.add(m[1]);
    if (m[2]) symbols.add(m[2]);
    if (m[3]) {
      for (const name of m[3].split(/[,{]/)) {
        const trimmed = name.trim().split(':')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) symbols.add(trimmed);
      }
    }
  }
  return Array.from(symbols);
}

function countReferences(files, symbol) {
  // whole-word-ish reference count across repo, excluding the defining file line
  const re = new RegExp(`\\b${escapeRegex(symbol)}\\b`, 'g');
  let count = 0;
  for (const file of files) {
    re.lastIndex = 0;
    const idx = re.exec(file.content);
    // count occurrences in this file
    let c = 0;
    re.lastIndex = 0;
    while (re.exec(file.content) !== null) c++;
    count += c;
  }
  return count;
}

function escapeRegex(c) {
  return /[.*+?^${}()|[\]\\]/g.test(c) ? '\\' + c : c;
}

function approxTokens(text) {
  // rough heuristic: ~4 chars per token
  return Math.ceil(text.length / 4);
}

class RepoAnalyzer {
  constructor(rootDir) {
    this.rootDir = rootDir || process.cwd();
  }

  analyze(maxTokens = 1024) {
    const relFiles = walkCodeFiles(this.rootDir);
    const files = [];
    for (const rel of relFiles) {
      const full = path.join(this.rootDir, rel);
      const content = fs.readFileSync(full, 'utf-8');
      const symbols = extractSymbols(content);
      files.push({ rel, content, symbols });
    }

    // Aggregate all symbols with their reference counts across the whole repo.
    const allSymbols = new Map(); // symbol -> { count, files: Set }
    for (const file of files) {
      for (const sym of file.symbols) {
        if (!allSymbols.has(sym)) allSymbols.set(sym, { count: 0, files: new Set() });
        allSymbols.get(sym).files.add(file.rel);
      }
    }
    for (const sym of allSymbols.keys()) {
      allSymbols.get(sym).count = countReferences(files, sym);
    }

    // Rank symbols by reference count (higher = more central).
    const ranked = Array.from(allSymbols.entries()).sort((a, b) => b[1].count - a[1].count);

    // Build the map within a token budget, grouped by file.
    const linesByFile = new Map();
    let usedTokens = 0;
    for (const [sym, info] of ranked) {
      const line = `    - ${sym}`;
      const t = approxTokens(line);
      if (usedTokens + t > maxTokens) break;
      for (const fileRel of info.files) {
        if (!linesByFile.has(fileRel)) linesByFile.set(fileRel, []);
        linesByFile.get(fileRel).push(sym);
      }
      usedTokens += t;
    }

    const mapParts = [];
    const seen = new Set();
    for (const [fileRel, syms] of [...linesByFile.entries()].sort()) {
      seen.add(fileRel);
      mapParts.push(`${fileRel}:\n` + syms.map((s) => `    - ${s}`).join('\n'));
    }
    // Include code files that had no extractable symbols as bare entries, so a
    // small repo still shows its file surface in the map.
    for (const file of files) {
      if (seen.has(file.rel)) continue;
      if (file.symbols.length === 0) {
        const t = approxTokens(file.rel);
        if (usedTokens + t > maxTokens) continue;
        usedTokens += t;
        mapParts.push(file.rel);
      }
    }
    return {
      map: mapParts.join('\n\n'),
      fileCount: relFiles.length,
      symbolCount: ranked.length,
      files: relFiles,
    };
  }
}

module.exports = { RepoAnalyzer, extractSymbols, walkCodeFiles };
