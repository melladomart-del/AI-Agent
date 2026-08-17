'use strict';

/**
 * Helpers to build small, isolated throwaway projects in the OS temp dir for
 * integration tests. Each project ships a PLAIN assertion script (NOT
 * `node --test`) as its `npm test` entry, so verification is a real exit-code
 * check that works identically inside and outside a `node --test` runner.
 *
 * (Running `node --test` as a child of a `node --test` process makes node skip
 * the nested files with "run() is being called recursively", masking real
 * failures. A plain script with assert + process.exit avoids that entirely.)
 *
 * Nothing here is committed to the AI-Agent repo -- these live under os.tmpdir
 * and are discarded after the tests.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function mkdtemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Write a package.json whose `test` runs a plain node assertion script. */
function writePkg(dir, name) {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', private: true, scripts: { test: 'node test/run-tests.js' } }, null, 2),
  );
}

function makeBrokenAddProject() {
  const dir = mkdtemp('ai-agent-add-');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'calc.js'),
    'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n',
  );
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'test', 'run-tests.js'),
    'const assert = require("assert");\n' +
      'const { add } = require("../src/calc");\n' +
      'assert.equal(add(2, 3), 5, "add(2,3) should be 5");\n' +
      'assert.equal(add(0, 0), 0, "add(0,0) should be 0");\n' +
      'console.log("all tests passed");\n',
  );
  writePkg(dir, 'tmp-add');
  return {
    dir,
    fixes: [{ fixPath: 'src/calc.js', buggyPattern: '  return a - b;', fixedPattern: '  return a + b;' }],
    verify: () => {
      const mod = require(path.join(dir, 'src', 'calc.js'));
      return mod.add(2, 3) === 5 && mod.add(0, 0) === 0;
    },
  };
}

/**
 * A project with TWO bugs: subtract returns a+b, multiply returns a+b. The
 * mock's first edit repairs subtract only, so tests STILL fail; the agent must
 * observe the remaining failure and fix multiply too. This exercises the
 * failure -> diagnose -> correct branch (success depends on real verification,
 * not on "a file was modified").
 */
function makeTwoBugProject() {
  const dir = mkdtemp('ai-agent-twobug-');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'calc.js'),
    'function subtract(a, b) {\n  return a + b;\n}\n' +
      'function multiply(a, b) {\n  return a + b;\n}\n' +
      'module.exports = { subtract, multiply };\n',
  );
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'test', 'run-tests.js'),
    'const assert = require("assert");\n' +
      'const { subtract, multiply } = require("../src/calc");\n' +
      'assert.equal(subtract(5, 3), 2, "subtract(5,3) should be 2");\n' +
      'assert.equal(multiply(2, 3), 6, "multiply(2,3) should be 6");\n' +
      'console.log("all tests passed");\n',
  );
  writePkg(dir, 'tmp-twobug');
  return {
    dir,
    fixes: [
      { fixPath: 'src/calc.js', buggyPattern: 'function subtract(a, b) {\n  return a + b;\n}', fixedPattern: 'function subtract(a, b) {\n  return a - b;\n}' },
      { fixPath: 'src/calc.js', buggyPattern: 'function multiply(a, b) {\n  return a + b;\n}', fixedPattern: 'function multiply(a, b) {\n  return a * b;\n}' },
    ],
    verify: () => {
      const mod = require(path.join(dir, 'src', 'calc.js'));
      return mod.subtract(5, 3) === 2 && mod.multiply(2, 3) === 6;
    },
  };
}

/**
 * A project with several UNRELATED files plus one bug, used to check that the
 * context selector does not dump the whole repo into the model prompt and that
 * the agent fixes only the relevant file.
 */
function makeMultiFileProject() {
  const dir = mkdtemp('ai-agent-multi-');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'auth.js'),
    'function login(user, pass) {\n  return pass !== user.secret;\n}\nmodule.exports = { login };\n',
  );
  fs.writeFileSync(path.join(dir, 'src', 'logger.js'), 'function log(msg) { console.log(msg); }\nmodule.exports = { log };\n');
  fs.writeFileSync(path.join(dir, 'src', 'utils.js'), 'function id(x) { return x; }\nmodule.exports = { id };\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Demo project\nA demo with a few unrelated files.\n');
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'test', 'run-tests.js'),
    'const assert = require("assert");\n' +
      'const { login } = require("../src/auth");\n' +
      'assert.equal(login({ secret: "pw" }, "nope"), false, "wrong password should fail");\n' +
      'assert.equal(login({ secret: "pw" }, "pw"), true, "right password should succeed");\n' +
      'console.log("all tests passed");\n',
  );
  writePkg(dir, 'tmp-multi');
  return {
    dir,
    fixes: [{ fixPath: 'src/auth.js', buggyPattern: 'return pass !== user.secret;', fixedPattern: 'return pass === user.secret;' }],
    verify: () => {
      const mod = require(path.join(dir, 'src', 'auth.js'));
      return mod.login({ secret: 'pw' }, 'pw') === true && mod.login({ secret: 'pw' }, 'nope') === false;
    },
  };
}

module.exports = { mkdtemp, makeBrokenAddProject, makeTwoBugProject, makeMultiFileProject };
