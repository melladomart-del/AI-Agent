'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ToolRegistry } = require('../src/tools/registry');
const tools = require('../src/tools/files');

function makeRegistry(tmpDir) {
  const config = {
    rootDir: tmpDir,
    protectedPaths: ['.env', '*.pem', '.git/**', 'node_modules/**'],
    blockedCommands: ['rm -rf /', 'sudo', 'shutdown', 'reboot', 'mkfs'],
  };
  const reg = new ToolRegistry(config);
  for (const t of [
    tools.readFile, tools.writeFile, tools.editFile, tools.deleteFile,
    tools.searchCode, tools.runCommand, tools.gitCommit, tools.gitStatus,
    tools.runTests, tools.finish, tools.listFiles,
  ]) reg.register(t);
  return reg;
}

function setupTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tools-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'function foo() { return 1; }\n');
  fs.writeFileSync(path.join(dir, 'b.js'), 'const bar = () => foo();\n');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sub', 'c.js'), 'export const baz = 42;\n');
  return dir;
}

test('readFile reads existing file', async () => {
  const dir = setupTmp();
  const reg = makeRegistry(dir);
  process.chdir(dir);
  const out = await reg.dispatch('readFile', { path: 'a.js' });
  assert.match(out, /function foo/);
  process.chdir('/');
});

test('readFile errors on missing file', async () => {
  const dir = setupTmp();
  process.chdir(dir);
  const reg = makeRegistry(dir);
  const out = await reg.dispatch('readFile', { path: 'missing.js' });
  assert.match(out, /^Error: file not found/);
  process.chdir('/');
});

test('writeFile creates file and parent dirs', async () => {
  const dir = setupTmp();
  process.chdir(dir);
  const reg = makeRegistry(dir);
  const out = await reg.dispatch('writeFile', { path: 'new/dir/x.txt', content: 'hello' });
  assert.match(out, /Wrote/);
  assert.equal(fs.readFileSync(path.join(dir, 'new/dir/x.txt'), 'utf-8'), 'hello');
  process.chdir('/');
});

test('writeFile is blocked on protected paths', async () => {
  const dir = setupTmp();
  process.chdir(dir);
  const reg = makeRegistry(dir);
  const out = await reg.dispatch('writeFile', { path: '.env', content: 'x' });
  assert.match(out, /protected/i);
  assert.ok(!fs.existsSync(path.join(dir, '.env')));
  process.chdir('/');
});

test('writeFile blocked outside workspace', async () => {
  const dir = setupTmp();
  process.chdir(dir);
  const reg = makeRegistry(dir);
  const out = await reg.dispatch('writeFile', { path: '../escape.txt', content: 'x' });
  assert.match(out, /outside the workspace/i);
  process.chdir('/');
});

test('editFile replaces a unique string', async () => {
  const dir = setupTmp();
  process.chdir(dir);
  const reg = makeRegistry(dir);
  const out = await reg.dispatch('editFile', { path: 'a.js', oldStr: 'return 1;', newStr: 'return 2;' });
  assert.match(out, /Edited/);
  assert.match(fs.readFileSync(path.join(dir, 'a.js'), 'utf-8'), /return 2;/);
  process.chdir('/');
});

test('editFile errors when oldStr not found', async () => {
  const dir = setupTmp();
  process.chdir(dir);
  const reg = makeRegistry(dir);
  const out = await reg.dispatch('editFile', { path: 'a.js', oldStr: 'NOPE', newStr: 'x' });
  assert.match(out, /not found/);
  process.chdir('/');
});

test('editFile errors when oldStr matches multiple times', async () => {
  const dir = setupTmp();
  process.chdir(dir);
  fs.writeFileSync(path.join(dir, 'dup.js'), 'x x x\n');
  const reg = makeRegistry(dir);
  const out = await reg.dispatch('editFile', { path: 'dup.js', oldStr: 'x', newStr: 'y' });
  assert.match(out, /multiple locations/);
  process.chdir('/');
});

test('deleteFile removes a file', async () => {
  const dir = setupTmp();
  process.chdir(dir);
  const reg = makeRegistry(dir);
  const out = await reg.dispatch('deleteFile', { path: 'a.js' });
  assert.match(out, /Deleted/);
  assert.ok(!fs.existsSync(path.join(dir, 'a.js')));
  process.chdir('/');
});

test('searchCode finds matches', async () => {
  const dir = setupTmp();
  process.chdir(dir);
  const reg = makeRegistry(dir);
  const out = await reg.dispatch('searchCode', { query: 'foo' });
  assert.match(out, /foo/);
  process.chdir('/');
});

test('searchCode with regex', async () => {
  const dir = setupTmp();
  process.chdir(dir);
  const reg = makeRegistry(dir);
  const out = await reg.dispatch('searchCode', { query: '/ba[rz]/' });
  assert.ok(out.includes('bar') || out.includes('baz'));
  process.chdir('/');
});

test('runCommand executes and returns output', async () => {
  const reg = makeRegistry(setupTmp());
  const out = await reg.dispatch('runCommand', { command: 'echo hello' });
  assert.match(out, /hello/);
});

test('runCommand blocks dangerous commands', async () => {
  const reg = makeRegistry(setupTmp());
  const out = await reg.dispatch('runCommand', { command: 'sudo rm -rf /' });
  assert.match(out, /blocked by safety policy/);
});

test('unknown tool returns error observation', async () => {
  const reg = makeRegistry(setupTmp());
  const out = await reg.dispatch('nope', {});
  assert.match(out, /unknown tool/);
});

test('schemas return OpenAI function format', () => {
  const reg = makeRegistry(setupTmp());
  const s = reg.schemas();
  assert.ok(s.some((x) => x.function.name === 'writeFile'));
  assert.ok(s.some((x) => x.function.name === 'runTests'));
});

test('finish tool signals completion', async () => {
  const reg = makeRegistry(setupTmp());
  const out = await reg.dispatch('finish', { summary: 'done' });
  assert.equal(out, '__FINISH__done');
});
