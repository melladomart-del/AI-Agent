'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');

/**
 * Idempotency: running install.sh twice must not overwrite an existing user
 * config, and must (re)create the global symlinks. We run install.sh in an
 * in-place mode from the repo against a throwaway HOME so the real ~/.klyvia
 * and ~/.local/bin are never touched. A sentinel .env confirms preservation.
 */
test('install.sh (in-place) is idempotent: preserves an existing .env and creates klyvia/go/GO symlinks', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'klyvia-install-'));
  const binDir = path.join(tmpHome, '.local', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  // Pre-create a user .env with a sentinel value that must survive re-install.
  const realEnv = path.join(REPO, '.env');
  const hadEnv = fs.existsSync(realEnv);
  if (hadEnv) fs.renameSync(realEnv, realEnv + '.bak');
  try {
    fs.writeFileSync(realEnv, 'KLYVIA_MODE=auto\nMODEL_PATH=/my/sentinel/model.gguf\nLOCAL_MODEL_BASE_URL=http://127.0.0.1:8080/v1\nLOCAL_MODEL_NAME=qwen2.5-coder\n');
    const env = { ...process.env, HOME: tmpHome, PATH: `${binDir}:${process.env.PATH}` };
    // Run install.sh twice in-place.
    execFileSync('bash', [path.join(REPO, 'install.sh')], { env, stdio: 'pipe', cwd: REPO });
    execFileSync('bash', [path.join(REPO, 'install.sh')], { env, stdio: 'pipe', cwd: REPO });
    // The sentinel must survive both runs (config never overwritten in-place).
    const after = fs.readFileSync(realEnv, 'utf-8');
    assert.match(after, /sentinel/, 'user MODEL_PATH must survive a re-install');
    // klyvia, go and GO symlinks must exist in the throwaway bin dir.
    assert.ok(fs.existsSync(path.join(binDir, 'klyvia')), 'klyvia symlink created');
    assert.ok(fs.existsSync(path.join(binDir, 'go')), 'go symlink created');
    assert.ok(fs.existsSync(path.join(binDir, 'GO')), 'GO symlink created');
  } finally {
    try { fs.unlinkSync(realEnv); } catch { /* ignore */ }
    if (hadEnv) fs.renameSync(realEnv + '.bak', realEnv);
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

