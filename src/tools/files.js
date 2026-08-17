'use strict';

const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const { Tool } = require('./tool');

const IGNORED_DIRS = new Set(['node_modules', '.git', '.agent-memory', 'dist', 'build', '.next', '.cache']);

function safeRead(p) {
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8');
}

/* ---------- file system tools ---------- */

const listFiles = new Tool({
  name: 'listFiles',
  description:
    "List files and directories under a path (recursively up to maxDepth). Skips node_modules, .git and build output. Use this first to understand the repository structure.",
  parameters: {
    type: 'object',
    properties: {
      dir: { type: 'string', description: 'Directory to list, relative to the workspace root. Defaults to "."' },
      maxDepth: { type: 'number', description: 'Max recursion depth. Defaults to 3.' },
    },
    required: [],
  },
  handler: (args) => listFilesImpl(args.dir || '.', args.maxDepth ?? 3, 0, ''),
});

function listFilesImpl(dir, maxDepth, depth, prefix) {
  let root = dir || '.';
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const lines = [];
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const rel = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        lines.push(`${rel}/`);
        if (depth < maxDepth) {
          const sub = path.join(root, entry.name);
          lines.push(...listFilesImpl(sub, maxDepth, depth + 1, rel));
        }
      } else {
        lines.push(rel);
      }
    }
    return lines.join('\n');
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

const readFile = new Tool({
  name: 'readFile',
  description: 'Read the full contents of a file. Returns the raw text.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Path relative to the workspace root.' } },
    required: ['path'],
  },
  handler: (args) => {
    const content = safeRead(args.path);
    if (content === null) return `Error: file not found: ${args.path}`;
    return content;
  },
});

const writeFile = new Tool({
  name: 'writeFile',
  description: 'Create or overwrite a file with the given content. Creates parent directories.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path relative to the workspace root.' },
      content: { type: 'string', description: 'Full new content of the file.' },
    },
    required: ['path', 'content'],
  },
  permissions: { write: true },
  handler: (args) => {
    if (typeof args.content !== 'string') return 'Error: content must be a string.';
    const dir = path.dirname(args.path);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(args.path, args.content, 'utf-8');
    return `Wrote ${args.content.length} chars to ${args.path}.`;
  },
});

const editFile = new Tool({
  name: 'editFile',
  description:
    'Apply a string replacement to an existing file. oldStr must match exactly once (including whitespace). Use this for surgical edits instead of rewriting whole files.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      oldStr: { type: 'string', description: 'Exact text to find.' },
      newStr: { type: 'string', description: 'Replacement text.' },
    },
    required: ['path', 'oldStr', 'newStr'],
  },
  permissions: { write: true },
  handler: (args) => {
    const content = safeRead(args.path);
    if (content === null) return `Error: file not found: ${args.path}`;
    const idx = content.indexOf(args.oldStr);
    if (idx === -1) return `Error: oldStr not found in ${args.path}.`;
    const second = content.indexOf(args.oldStr, idx + 1);
    if (second !== -1) return `Error: oldStr matches multiple locations in ${args.path}; make it more specific.`;
    const updated = content.slice(0, idx) + args.newStr + content.slice(idx + args.oldStr.length);
    fs.writeFileSync(args.path, updated, 'utf-8');
    return `Edited ${args.path}.`;
  },
});

const deleteFile = new Tool({
  name: 'deleteFile',
  description: 'Delete a file. Refuses to delete directories for safety.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  permissions: { write: true, destructive: true },
  handler: (args) => {
    try {
      const stat = fs.statSync(args.path);
      if (stat.isDirectory()) return `Error: ${args.path} is a directory; deleteFile only removes files.`;
      fs.unlinkSync(args.path);
      return `Deleted ${args.path}.`;
    } catch (err) {
      return `Error: ${err.message}`;
    }
  },
});

/* ---------- search tool ---------- */

const searchCode = new Tool({
  name: 'searchCode',
  description: 'Search for a string or regex in the project source files (excludes node_modules/.git).',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'String or /regex/ pattern to search for.' },
      glob: { type: 'string', description: 'Optional file glob filter, e.g. "*.js".' },
    },
    required: ['query'],
  },
  handler: (args) => searchCodeImpl(args.query, args.glob),
});

function searchCodeImpl(query, glob) {
  let pattern;
  if (query.startsWith('/') && query.lastIndexOf('/') > 0) {
    const last = query.lastIndexOf('/');
    pattern = new RegExp(query.slice(1, last), query.slice(last + 1));
  } else {
    pattern = new RegExp(escapeRegex(query), 'g');
  }
  const results = [];
  function walk(dir, prefix) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const rel = path.join(prefix, entry.name);
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
      } else {
        if (glob && !matchGlob(entry.name, glob)) continue;
        const text = safeRead(full);
        if (text == null) continue;
        text.split('\n').forEach((line, i) => {
          pattern.lastIndex = 0;
          if (pattern.test(line)) results.push(`${rel}:${i + 1}: ${line}`);
        });
        if (results.length > 200) return;
      }
    }
  }
  walk('.', '');
  return results.length ? results.join('\n') : 'No matches found.';
}

function matchGlob(name, pat) {
  return new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(name);
}

/* ---------- shell tool ---------- */

const runCommand = new Tool({
  name: 'runCommand',
  description:
    'Execute a shell command in the workspace. Use for running tests, builds, git status, etc. Returns stdout+stderr. Dangerous commands are blocked.',
  parameters: {
    type: 'object',
    properties: { command: { type: 'string', description: 'Shell command to execute.' } },
    required: ['command'],
  },
  permissions: { shell: true },
  handler: (args) =>
    new Promise((resolve) => {
      exec(args.command, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 8 }, (err, stdout, stderr) => {
        if (err) {
          resolve(`[exit ${err.code ?? 1}] ${stderr || err.message}\n${stdout || ''}`);
        } else {
          resolve(`${stdout}${stderr ? '\n[stderr]\n' + stderr : ''}`);
        }
      });
    }),
});

/* ---------- git tools ---------- */

const gitCommit = new Tool({
  name: 'gitCommit',
  description: 'Stage all changes and create a git commit with the given message.',
  parameters: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
  permissions: { shell: true },
  handler: (args) => {
    try {
      execSync('git add -A', { encoding: 'utf-8' });
      execSync(`git commit -m "${args.message.replace(/"/g, '\\"')}"`, { encoding: 'utf-8', stdio: 'pipe' });
      return `Committed: ${args.message}`;
    } catch (err) {
      return `Error: ${err.message}`;
    }
  },
});

const gitStatus = new Tool({
  name: 'gitStatus',
  description: 'Return the current git status (porcelain) of the repository.',
  parameters: { type: 'object', properties: {}, required: [] },
  permissions: { shell: true },
  handler: () => {
    try {
      return execSync('git status --porcelain', { encoding: 'utf-8' }) || 'Working tree clean.';
    } catch (err) {
      return `Error: ${err.message}`;
    }
  },
});

/* ---------- test runner ---------- */

const runTests = new Tool({
  name: 'runTests',
  description: 'Run the project test suite (npm test) and return output. Used by the agent to verify changes.',
  parameters: { type: 'object', properties: {}, required: [] },
  permissions: { shell: true },
  handler: () =>
    new Promise((resolve) => {
      exec('npm test --silent', { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 8 }, (err, stdout, stderr) => {
        const out = `${stdout}${stderr ? '\n[stderr]\n' + stderr : ''}`;
        if (err) resolve(`[exit ${err.code ?? 1}] tests FAILED\n${out}`);
        else resolve(`tests PASSED\n${out}`);
      });
    }),
});

/* ---------- finish ---------- */

const finish = new Tool({
  name: 'finish',
  description: 'Signal that the task is complete. Provide a short summary of what was done.',
  parameters: {
    type: 'object',
    properties: { summary: { type: 'string', description: 'Short summary of the completed work.' } },
    required: ['summary'],
  },
  handler: (args) => `__FINISH__${args.summary || ''}`,
});

function escapeRegex(c) {
  return /[.*+?^${}()|[\]\\]/.test(c) ? '\\' + c : c;
}

module.exports = {
  listFiles,
  readFile,
  writeFile,
  editFile,
  deleteFile,
  searchCode,
  runCommand,
  gitCommit,
  gitStatus,
  runTests,
  finish,
  // for testing
  _listFilesImpl: listFilesImpl,
  _searchCodeImpl: searchCodeImpl,
  IGNORED_DIRS,
};
