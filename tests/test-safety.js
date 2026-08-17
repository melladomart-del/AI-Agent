'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SafetyGuard } = require('../src/engine/safety');

const config = {
  rootDir: '/tmp/agent-safety-test',
  protectedPaths: ['.env', '*.pem', '*.key', '.git/**', 'node_modules/**'],
  blockedCommands: ['rm -rf /', 'sudo', 'shutdown', 'reboot', 'mkfs'],
};

const guard = new SafetyGuard(config);

test('isProtected blocks exact and glob patterns', () => {
  assert.equal(guard.isProtected('.env'), true);
  assert.equal(guard.isProtected('server.pem'), true);
  assert.equal(guard.isProtected('keys/private.key'), true);
  assert.equal(guard.isProtected('.git/config'), true);
  assert.equal(guard.isProtected('node_modules/foo/index.js'), true);
});

test('isProtected allows normal files', () => {
  assert.equal(guard.isProtected('src/index.js'), false);
  assert.equal(guard.isProtected('README.md'), false);
  assert.equal(guard.isProtected('skills/react.md'), false);
});

test('isProtected blocks paths outside workspace', () => {
  assert.equal(guard.isProtected('../../etc/passwd'), true);
  assert.equal(guard.isProtected('/etc/passwd'), true);
});

test('blockedReason detects blocked commands', () => {
  assert.equal(guard.blockedReason('sudo rm -rf /'), 'sudo');
  assert.equal(guard.blockedReason('rm -rf /home'), 'rm -rf /');
  assert.equal(guard.blockedReason('mkfs.ext4 /dev/sda1'), 'mkfs');
});

test('blockedReason allows safe commands', () => {
  assert.equal(guard.blockedReason('npm test'), null);
  assert.equal(guard.blockedReason('git status'), null);
  assert.equal(guard.blockedReason('node index.js'), null);
});
