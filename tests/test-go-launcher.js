'use strict';

/**
 * Tests for the `go` launcher (bin/go.js). These exercise the REAL launcher
 * functions against ephemeral mock model servers, covering:
 *   - endpoint probe (ok / refused / invalid URL / timeout)
 *   - auto-start with MODEL_START_CMD + health-wait (no double-start)
 *   - stop reaps the process and clears the PID file (no orphan)
 *   - status reflects READY/STOPPED via a real probe, not a PID
 *   - doctor detects a missing endpoint
 * The launcher only depends on Node stdlib + the project; no new deps.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const go = require('../bin/go.js');
const { buildConfig } = require('../src/config');

function makeHealthyServer() {
  return http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'm', object: 'model' }] }));
      return;
    }
    res.writeHead(404);
    res.end('nf');
  });
}

function startServer(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

/** Config pointed at a given endpoint, with an isolated runtime dir. */
function cfgFor(url, extra = {}) {
  const cfg = buildConfig({ rootDir: path.resolve(__dirname, '..') });
  cfg.local.baseUrl = url;
  cfg.local.model = 'qwen2.5-coder-1.5b-instruct';
  cfg.runtimeDir = '.agent-runtime-test';
  cfg.modelStartCmd = extra.modelStartCmd || '';
  cfg.modelStartArgs = extra.modelStartArgs || '';
  return cfg;
}

function resetRuntime(cfg) {
  try { fs.rmSync(go.runtimeDir(cfg), { recursive: true, force: true }); } catch { /* ignore */ }
}

test('probeEndpoint resolves ok=true for a healthy /v1/models endpoint', async () => {
  const srv = makeHealthyServer();
  const port = await startServer(srv);
  try {
    const probe = await go.probeEndpoint(`http://127.0.0.1:${port}/v1`, { timeoutMs: 2000 });
    assert.equal(probe.ok, true);
  } finally { srv.close(); }
});

test('probeEndpoint reports ok=false for a dead port (ECONNREFUSED)', async () => {
  const probe = await go.probeEndpoint('http://127.0.0.1:65535/v1', { timeoutMs: 1500 });
  assert.equal(probe.ok, false);
  assert.ok(probe.error, 'should carry an error reason');
});

test('probeEndpoint reports ok=false for an invalid URL', async () => {
  const probe = await go.probeEndpoint('not-a-url', { timeoutMs: 1500 });
  assert.equal(probe.ok, false);
});

test('startModelServer auto-starts MODEL_START_CMD and waits for health (no double-start)', async () => {
  // Reserve a port, close it, then have the spawned child rebind it after a
  // short delay (becoming healthy). The launcher must spawn the child, wait
  // for the probe to succeed, and report ready=true without a second spawn.
  const tmp = makeHealthyServer();
  const port = await startServer(tmp);
  tmp.close(); // free the port for the child to rebind
  const script = path.join(os.tmpdir(), `go-autostart-${process.pid}-${port}.js`);
  fs.writeFileSync(script, `const http=require('http');setTimeout(()=>{http.createServer((q,s)=>{if(q.url==='/v1/models'){s.writeHead(200);s.end(JSON.stringify({object:'list',data:[{id:'m',object:'model'}]}));return;}s.writeHead(404);s.end('nf');}).listen(${port},'127.0.0.1')},800);`);
  const cfg = cfgFor(`http://127.0.0.1:${port}/v1`, { modelStartCmd: process.execPath, modelStartArgs: script });
  resetRuntime(cfg);
  try {
    const res = await go.startModelServer(cfg);
    assert.equal(res.started, true, 'must spawn the model server because the endpoint was down');
    assert.equal(res.ready, true, 'must wait for the health check to succeed');
    // Second start: endpoint now reachable -> no second spawn.
    const again = await go.startModelServer(cfg);
    assert.equal(again.started, false, 'must not spawn a second instance when already reachable');
    assert.equal(again.ready, true);
  } finally {
    go.stopModelServer(cfg);
    resetRuntime(cfg);
    try { fs.unlinkSync(script); } catch { /* ignore */ }
  }
});

test('startModelServer with no MODEL_START_CMD and a dead endpoint returns a clear error', async () => {
  const cfg = cfgFor('http://127.0.0.1:65535/v1');
  resetRuntime(cfg);
  const res = await go.startModelServer(cfg);
  assert.equal(res.ready, false);
  assert.equal(res.alive, false);
  assert.match(res.error, /MODEL_START_CMD/, 'error must explain that no start command is configured');
  resetRuntime(cfg);
});

test('status reports READY via probe (not PID) for a healthy endpoint', async () => {
  const srv = makeHealthyServer();
  const port = await startServer(srv);
  try {
    const cfg = cfgFor(`http://127.0.0.1:${port}/v1`);
    resetRuntime(cfg);
    const ok = await go.cmdStatus(cfg);
    assert.equal(ok, true, 'status must return true when the probe succeeds');
  } finally { srv.close(); resetRuntime(cfgFor('http://127.0.0.1:0/v1')); }
});

test('status reports STOPPED when the endpoint is down and no PID is managed', async () => {
  const cfg = cfgFor('http://127.0.0.1:65535/v1');
  resetRuntime(cfg);
  const ok = await go.cmdStatus(cfg);
  assert.equal(ok, false, 'status must return false when the endpoint is down');
  resetRuntime(cfg);
});

test('doctor flags an unreachable endpoint and exits non-zero (ok=false)', async () => {
  const cfg = cfgFor('http://127.0.0.1:65535/v1');
  resetRuntime(cfg);
  // Silence doctor's stdout during the test.
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    const ok = await go.cmdDoctor(cfg);
    assert.equal(ok, false, 'doctor must return false when the endpoint is unreachable');
  } finally {
    process.stdout.write = write;
    resetRuntime(cfg);
  }
});

test('doctor passes (ok=true) when node, deps, config, endpoint, llama and model are all good', async () => {
  const srv = makeHealthyServer();
  const port = await startServer(srv);
  const fakeModel = path.join(os.tmpdir(), `go-doc-model-${process.pid}.gguf`);
  fs.writeFileSync(fakeModel, 'dummy');
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    const cfg = cfgFor(`http://127.0.0.1:${port}/v1`);
    cfg.llamaBin = process.execPath; // a real executable on disk
    cfg.modelPath = fakeModel;       // a real file on disk
    resetRuntime(cfg);
    const ok = await go.cmdDoctor(cfg);
    assert.equal(ok, true, 'doctor must pass when everything is healthy');
  } finally {
    process.stdout.write = write;
    srv.close();
    try { fs.unlinkSync(fakeModel); } catch { /* ignore */ }
    resetRuntime(cfgFor('http://127.0.0.1:0/v1'));
  }
});

test('stop cleans a managed process + PID file (no orphan)', async () => {
  // Spawn a long-lived process the launcher "manages" by writing its PID.
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},60000)'], { stdio: 'ignore' });
  const cfg = cfgFor('http://127.0.0.1:65535/v1');
  resetRuntime(cfg);
  fs.mkdirSync(go.runtimeDir(cfg), { recursive: true });
  fs.writeFileSync(go.pidFile(cfg), String(child.pid));
  assert.equal(go.isProcessAlive(child.pid), true, 'precondition: child is alive');
  const res = go.stopModelServer(cfg);
  assert.equal(res.stopped, true, 'stop must report the process was stopped');
  // Give the OS a beat to reap.
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(go.isProcessAlive(child.pid), false, 'the managed child must be gone (no orphan)');
  assert.equal(fs.existsSync(go.pidFile(cfg)), false, 'the PID file must be removed');
});

test('double-start does not spawn a second instance when the endpoint is already up', async () => {
  const srv = makeHealthyServer();
  const port = await startServer(srv);
  try {
    const cfg = cfgFor(`http://127.0.0.1:${port}/v1`, { modelStartCmd: process.execPath, modelStartArgs: '-e', });
    resetRuntime(cfg);
    const first = await go.startModelServer(cfg);
    assert.equal(first.ready, true);
    const second = await go.startModelServer(cfg);
    assert.equal(second.started, false, 'second start must not spawn because endpoint is already reachable');
    assert.equal(second.ready, true);
    resetRuntime(cfg);
  } finally { srv.close(); }
});

test('buildLlamaStartCommand builds serve args from LLAMA_BIN + MODEL_PATH + endpoint port', () => {
  // Use the node binary as a stand-in for "llama" and a temp file for the model.
  const fakeModel = path.join(os.tmpdir(), `go-fake-model-${process.pid}.gguf`);
  fs.writeFileSync(fakeModel, 'dummy');
  try {
    const cfg = cfgFor('http://127.0.0.1:8080/v1');
    cfg.llamaBin = process.execPath; // any executable on disk
    cfg.modelPath = fakeModel;
    cfg.llamaContext = '4096';
    const built = go.buildLlamaStartCommand(cfg);
    assert.ok(built, 'must build a command when both llama bin and model file exist');
    assert.equal(built.bin, process.execPath);
    assert.deepEqual(built.args, ['serve', '-m', fakeModel, '--port', '8080', '--host', '127.0.0.1', '-c', '4096']);
  } finally { try { fs.unlinkSync(fakeModel); } catch { /* ignore */ } }
});

test('buildLlamaStartCommand returns null when the model file is missing', () => {
  const cfg = cfgFor('http://127.0.0.1:8080/v1');
  cfg.llamaBin = process.execPath;
  cfg.modelPath = '/nonexistent/path/to/model.gguf';
  const built = go.buildLlamaStartCommand(cfg);
  assert.equal(built, null, 'must not build a command when the model file does not exist');
});

test('startModelServer with MODEL_PATH (missing file) and a dead endpoint gives a clear error mentioning MODEL_PATH', async () => {
  const cfg = cfgFor('http://127.0.0.1:65535/v1');
  cfg.llamaBin = process.execPath; // llama found, but model file missing
  cfg.modelPath = '/nonexistent/model.gguf';
  resetRuntime(cfg);
  const res = await go.startModelServer(cfg);
  assert.equal(res.ready, false);
  assert.equal(res.alive, false);
  assert.match(res.error, /MODEL_PATH/, 'error must guide the user to set MODEL_PATH');
  resetRuntime(cfg);
});

// --- KLYVIA mode resolution tests ---

test('resolveBackend: KLYVIA_MODE=local always uses the local backend', async () => {
  const cfg = cfgFor('http://127.0.0.1:65535/v1');
  cfg.klyviaMode = 'local';
  cfg.klyviaServerUrl = 'http://127.0.0.1:9999/v1';
  const b = await go.resolveBackend(cfg);
  assert.equal(b.backend, 'local');
});

test('resolveBackend: KLYVIA_MODE=remote fails hard when the server is unreachable', async () => {
  const cfg = cfgFor('http://127.0.0.1:65535/v1');
  cfg.klyviaMode = 'remote';
  cfg.klyviaServerUrl = 'http://127.0.0.1:65534/v1'; // nothing listening
  const b = await go.resolveBackend(cfg);
  assert.equal(b.backend, 'remote');
  assert.equal(b.reachable, false);
  assert.match(b.reason, /remote but server.*unreachable/i, 'must explain the failure, not silently fall back');
});

test('resolveBackend: KLYVIA_MODE=remote fails hard when KLYVIA_SERVER_URL is unset', async () => {
  const cfg = cfgFor('http://127.0.0.1:65535/v1');
  cfg.klyviaMode = 'remote';
  cfg.klyviaServerUrl = '';
  const b = await go.resolveBackend(cfg);
  assert.equal(b.backend, 'remote');
  assert.equal(b.reachable, false);
  assert.match(b.reason, /KLYVIA_SERVER_URL is not set/i);
});

test('resolveBackend: KLYVIA_MODE=auto falls back to local when the server is down', async () => {
  const cfg = cfgFor('http://127.0.0.1:65535/v1');
  cfg.klyviaMode = 'auto';
  cfg.klyviaServerUrl = 'http://127.0.0.1:65534/v1';
  const b = await go.resolveBackend(cfg);
  assert.equal(b.backend, 'local', 'auto must fall back to local when the server is down');
  assert.match(b.reason, /falling back to local/i, 'must clearly explain the fallback');
});

test('resolveBackend: KLYVIA_MODE=auto uses remote when the server is reachable', async () => {
  const srv = makeHealthyServer();
  const port = await startServer(srv);
  const cfg = cfgFor('http://127.0.0.1:65535/v1');
  cfg.klyviaMode = 'auto';
  cfg.klyviaServerUrl = `http://127.0.0.1:${port}/v1`;
  const b = await go.resolveBackend(cfg);
  assert.equal(b.backend, 'remote');
  assert.equal(b.reachable, true);
  srv.close();
});

test('resolveBackend: auto with no server configured uses local', async () => {
  const cfg = cfgFor('http://127.0.0.1:65535/v1');
  cfg.klyviaMode = 'auto';
  cfg.klyviaServerUrl = '';
  const b = await go.resolveBackend(cfg);
  assert.equal(b.backend, 'local');
  assert.match(b.reason, /no KLYVIA_SERVER_URL/i);
});

// --- config masking test ---

test('cmdConfig masks API keys and never prints them in full', async () => {
  const cfg = cfgFor('http://127.0.0.1:8080/v1');
  cfg.klyviaApiKey = 'sk-supersecret-key-1234567890';
  const captured = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { captured.push(String(s)); return true; };
  try {
    await go.cmdConfig(cfg);
  } finally {
    process.stdout.write = write;
  }
  const out = captured.join('');
  assert.doesNotMatch(out, /supersecret/, 'the full secret must never appear in config output');
  assert.match(out, /hidden|set/i, 'the key presence is indicated without revealing it');
});

// --- welcome banner test ---

test('welcomeBanner renders a KLYVIA box with backend + status', () => {
  const cfg = cfgFor('http://127.0.0.1:8080/v1');
  cfg.local.model = 'qwen2.5-coder';
  cfg.rootDir = '/tmp/my-user-project';
  const banner = go.welcomeBanner(cfg, { backend: 'local' }, { ok: true });
  assert.match(banner, /K L Y V I A/i);
  assert.match(banner, /llama\.cpp/);
  assert.match(banner, /qwen2\.5-coder/);
  // The banner must show the USER's project (rootDir), not the app install dir.
  assert.match(banner, /Project.*\/tmp\/my-user-project/, 'banner shows the user project path');
  // A boxed banner has top and bottom borders.
  assert.match(banner, /╭[─]+╮/);
  assert.match(banner, /╰[─]+╯/);
});

// --- version + managed-install detection ---

test('readVersion returns the package.json version', () => {
  const v = go.readVersion();
  assert.match(v, /^\d+\.\d+\.\d+/, 'version looks like semver');
});

test('isManagedInstall returns false for a dev clone (APP_ROOT != ~/.klyvia/app)', () => {
  // The test runs from the repo, which is NOT ~/.klyvia/app, so this is a dev clone.
  assert.equal(go.isManagedInstall(), false);
});

// --- uninstall logic test (non-interactive, --yes, no purge) ---

test('cmdUninstall with --yes removes app + runtime + symlinks but keeps config', async () => {
  // Build a fake managed install in a temp HOME so we don't touch the real one.
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'klyvia-uninstall-'));
  const oldHome = process.env.HOME;
  process.env.HOME = tmpHome;
  const fakeApp = path.join(tmpHome, '.klyvia', 'app');
  const fakeConfigDir = path.join(tmpHome, '.klyvia', 'config');
  const fakeRuntime = path.join(tmpHome, '.klyvia', 'runtime');
  fs.mkdirSync(path.join(fakeApp, 'bin'), { recursive: true });
  fs.mkdirSync(fakeConfigDir, { recursive: true });
  fs.mkdirSync(fakeRuntime, { recursive: true });
  fs.writeFileSync(path.join(fakeConfigDir, 'config.env'), 'KLYVIA_MODE=auto\nMODEL_PATH=/keep/me.gguf\n');
  fs.writeFileSync(path.join(fakeApp, 'package.json'), '{}');
  const binDir = path.join(tmpHome, '.local', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const n of ['klyvia', 'go', 'GO']) fs.writeFileSync(path.join(binDir, n), 'link');
  try {
    const cfg = cfgFor('http://127.0.0.1:65535/v1');
    const captured = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { captured.push(String(s)); return true; };
    try {
      const ok = await go.cmdUninstall(cfg, ['--yes']);
      assert.equal(ok, true);
    } finally {
      process.stdout.write = write;
    }
    assert.equal(fs.existsSync(fakeApp), false, 'app code removed');
    assert.equal(fs.existsSync(fakeRuntime), false, 'runtime removed');
    assert.equal(fs.existsSync(path.join(binDir, 'klyvia')), false, 'symlink removed');
    assert.equal(fs.existsSync(path.join(fakeConfigDir, 'config.env')), true, 'config preserved by default');
  } finally {
    process.env.HOME = oldHome;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

