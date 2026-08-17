'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { minimatch } = require('../src/util/minimatch');

test('minimatch matches exact segments', () => {
  assert.equal(minimatch('a/b/c', 'a/b/c'), true);
  assert.equal(minimatch('a/b/d', 'a/b/c'), false);
});

test('minimatch single * matches within a segment', () => {
  assert.equal(minimatch('.env', '.env'), true);
  assert.equal(minimatch('config.env', '*.env'), true);
  assert.equal(minimatch('a/config.env', 'a/*.env'), true);
  assert.equal(minimatch('a/b/config.env', 'a/*.env'), false);
});

test('minimatch ** matches multiple segments', () => {
  assert.equal(minimatch('.git/refs/heads', '.git/**'), true);
  assert.equal(minimatch('.git/config', '.git/**'), true);
  assert.equal(minimatch('src/.git/x', '.git/**'), false);
  assert.equal(minimatch('node_modules/foo/bar', 'node_modules/**'), true);
});

test('minimatch escaped special chars', () => {
  assert.equal(minimatch('secret.pem', '*.pem'), true);
  assert.equal(minimatch('secret.key', '*.key'), true);
  assert.equal(minimatch('secret.txt', '*.pem'), false);
});
