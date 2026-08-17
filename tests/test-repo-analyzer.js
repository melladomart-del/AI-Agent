'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { RepoAnalyzer, extractSymbols } = require('../src/engine/repo-analyzer');

function setupRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-repo-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'),
    'export function foo() { return 1; }\nexport const bar = () => foo();\n');
  fs.writeFileSync(path.join(dir, 'src', 'b.js'),
    'import { foo } from "./a.js";\nclass Baz { run() { return foo(); } }\n');
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'junk.js'), 'function ignored() {}');
  fs.writeFileSync(path.join(dir, 'README.md'), '# readme');
  return dir;
}

test('extractSymbols finds functions, consts, classes', () => {
  const syms = extractSymbols('function foo() {} const bar = () => {} class Baz {}');
  assert.ok(syms.includes('foo'));
  assert.ok(syms.includes('bar'));
  assert.ok(syms.includes('Baz'));
});

test('RepoAnalyzer ignores node_modules and non-code files', () => {
  const dir = setupRepo();
  const a = new RepoAnalyzer(dir);
  const res = a.analyze(2048);
  assert.equal(res.fileCount, 2); // only src/a.js, src/b.js
  assert.ok(res.files.every((f) => !f.includes('node_modules')));
});

test('RepoAnalyzer map contains ranked symbols', () => {
  const dir = setupRepo();
  const res = new RepoAnalyzer(dir).analyze(2048);
  assert.match(res.map, /foo/);
  assert.match(res.map, /Baz/);
});

test('RepoAnalyzer respects token budget', () => {
  const dir = setupRepo();
  const small = new RepoAnalyzer(dir).analyze(10).map;
  const big = new RepoAnalyzer(dir).analyze(4000).map;
  assert.ok(big.length >= small.length);
});
