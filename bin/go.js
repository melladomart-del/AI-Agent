#!/usr/bin/env node
'use strict';

/**
 * `go` — the KLYVIA launcher and service manager.
 *
 *   go             # ensure services + launch the TUI (default)
 *   go start       # start services (model server if configured), no TUI
 *   go stop        # stop services started by this launcher
 *   go restart     # stop + start
 *   go status      # show service readiness (real health probes, not PIDs)
 *   go logs        # tail the launcher / model-server logs
 *   go doctor      # diagnose: node, deps, config, endpoint, ports, perms
 *
 * Design rules (from the project brief):
 *   - A service is READY only after a real health check, never because its
 *     process exists.
 *   - No second instance: a PID file prevents double-starting the model server.
 *   - Clean shutdown: SIGTERM the model-server child, reap it, clear the PID
 *     file. CTRL+C is trapped.
 *   - No machine-specific paths: the project root is resolved from this file's
 *     location (so `go` works from any directory), and all model-server
 *     invocation is via env (MODEL_START_CMD/MODEL_START_ARGS), never assumed.
 *   - No opaque external dependency; only Node stdlib + the project itself.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync, execSync } = require('child_process');

// APP_ROOT = where KLYVIA's own code/skills/.env live (the install dir or the
// dev clone). WORK_DIR = the user's current project (cwd) — the thing the agent
// should read/edit. Keeping these separate is what lets a globally-installed
// `klyvia` target the user's project instead of its own install directory.
const APP_ROOT = path.resolve(__dirname, '..');
const WORK_DIR = process.cwd();
const { buildConfig } = require(path.join(APP_ROOT, 'src', 'config'));

// Official repo + distribution branch for `klyvia update` and curl-pipe install.
// The branch is real (verified): the launcher work lives on feat/local-coding-agent.
const KLYVIA_REPO = process.env.KLYVIA_REPO || 'melladomart-del/AI-Agent';
const KLYVIA_BRANCH = process.env.KLYVIA_BRANCH || 'feat/local-coding-agent';
const KLYVIA_HOME = path.join(process.env.HOME || '', '.klyvia');
const KLYVIA_APP_INSTALL = path.join(KLYVIA_HOME, 'app');
const KLYVIA_CONFIG_DIR = path.join(KLYVIA_HOME, 'config');
const KLYVIA_CONFIG_FILE = path.join(KLYVIA_CONFIG_DIR, 'config.env');
const KLYVIA_RUNTIME = path.join(KLYVIA_HOME, 'runtime');

// ANSI helpers (disabled when not a TTY or NO_COLOR set).
const C = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (C ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => c('32', s);
const red = (s) => c('31', s);
const yellow = (s) => c('33', s);
const dim = (s) => c('2', s);
const bold = (s) => c('1', s);

function log(msg) { process.stdout.write(msg + '\n'); }

// Resolve the runtime dir. For a managed install (~/.klyvia/app) this is
// ~/.klyvia/runtime (set as an absolute RUNTIME_DIR by install.sh). For a dev
// clone it stays under the app root (.agent-runtime, gitignored).
function runtimeDir(cfg) {
  const rd = cfg.runtimeDir || '.agent-runtime';
  const dir = path.isAbsolute(rd) ? rd : path.resolve(cfg.appRoot || cfg.rootDir, rd);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function pidFile(cfg) { return path.join(runtimeDir(cfg), 'model.pid'); }
function logFile(cfg) { return path.join(runtimeDir(cfg), 'model.log'); }

function readPid(cfg) {
  try {
    const raw = fs.readFileSync(pidFile(cfg), 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch { return null; }
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killProcess(pid, sig = 'SIGTERM') {
  try { process.kill(pid, sig); return true; } catch { return false; }
}

/**
 * Real health check: HTTP GET {baseUrl}/models with a short timeout. A service
 * is READY only when this returns. baseUrl is an OpenAI base (ends in /v1).
 */
function probeEndpoint(baseUrl, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(baseUrl); } catch { return resolve({ ok: false, error: 'invalid URL' }); }
    const req = http.get(
      { host: url.hostname, port: url.port, path: `${url.pathname.replace(/\/$/, '')}/models`, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: body.slice(0, 200) }));
      },
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (err) => resolve({ ok: false, error: err.code || err.message }));
  });
}

function parsePort(baseUrl) {
  try { return new URL(baseUrl).port || (new URL(baseUrl).protocol === 'https:' ? '443' : '80'); }
  catch { return '?'; }
}

function cmdArgs(str) {
  return String(str || '').match(/\S+/g) || [];
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Find the llama.cpp server binary: explicit LLAMA_BIN, then PATH lookup for
 * `llama` and `llama-server`, then ~/.local/bin/llama (a common manual install
 * location). Returns the resolved path or null. Never assumes a path exists.
 */
function findLlamaBin(cfg) {
  const tryPath = (p) => { try { if (p && fs.existsSync(p) && fs.accessSync(p, fs.constants.X_OK) === undefined) return p; } catch { /* ignore */ } return null; };
  if (cfg.llamaBin) {
    const found = tryPath(cfg.llamaBin);
    if (found) return found;
  }
  for (const name of ['llama', 'llama-server']) {
    try {
      const out = execSync(`command -v ${name} 2>/dev/null || true`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
      if (out && fs.existsSync(out)) return out;
    } catch { /* ignore */ }
  }
  const homeLocal = path.join(process.env.HOME || '', '.local', 'bin', 'llama');
  return tryPath(homeLocal);
}

/**
 * Build a llama.cpp `serve` command from LLAMA_BIN + MODEL_PATH, deriving host
 * and port from LOCAL_MODEL_BASE_URL. Returns { bin, args } or null if either
 * the binary or the model file is missing.
 */
function buildLlamaStartCommand(cfg) {
  const bin = findLlamaBin(cfg);
  if (!bin) return null;
  const model = cfg.modelPath;
  if (!model || !fs.existsSync(model)) return null;
  let port = '8080';
  let host = cfg.llamaHost || '127.0.0.1';
  try {
    const u = new URL(cfg.local.baseUrl);
    if (u.port) port = u.port;
    if (u.hostname) host = u.hostname;
  } catch { /* keep defaults */ }
  const args = ['serve', '-m', model, '--port', port, '--host', host, '-c', String(cfg.llamaContext || '4096')];
  return { bin, args };
}

/**
 * Start the model server when the endpoint is not already reachable. The start
 * command is resolved in this order:
 *   1. explicit MODEL_START_CMD + MODEL_START_ARGS (any server, full control)
 *   2. auto-built llama.cpp command from LLAMA_BIN (or PATH/~.local/bin/llama)
 *      + MODEL_PATH (.gguf), deriving host/port from LOCAL_MODEL_BASE_URL
 * Resolves to { started, ready, alive, error? }.
 */
async function startModelServer(cfg) {
  const probe = await probeEndpoint(cfg.local.baseUrl);
  if (probe.ok) return { started: false, ready: true, alive: true };

  const existing = readPid(cfg);
  if (existing && isProcessAlive(existing)) {
    return { started: false, ready: false, alive: true, error: 'model process running but endpoint not responding (still warming up?)' };
  }

  // Resolve the start command: explicit MODEL_START_CMD first, otherwise the
  // llama.cpp auto-build from LLAMA_BIN + MODEL_PATH (when both are available).
  let bin = cfg.modelStartCmd;
  let args = cmdArgs(cfg.modelStartArgs);
  if (!bin) {
    const built = buildLlamaStartCommand(cfg);
    if (built) { bin = built.bin; args = built.args; }
  }

  if (!bin) {
    const llamaBin = findLlamaBin(cfg);
    const modelMissing = !cfg.modelPath || !fs.existsSync(cfg.modelPath);
    let hint;
    if (llamaBin && modelMissing) {
      hint = `endpoint ${cfg.local.baseUrl} is not reachable. llama.cpp was found at ${llamaBin}, but no MODEL_PATH (.gguf) is configured (or the file is missing). Set MODEL_PATH in .env to your model file.`;
    } else if (!llamaBin && modelMissing) {
      hint = `endpoint ${cfg.local.baseUrl} is not reachable and neither MODEL_START_CMD nor (LLAMA_BIN + MODEL_PATH) is configured.\nInstall llama.cpp, set MODEL_PATH to your .gguf, or set MODEL_START_CMD in .env.`;
    } else if (!llamaBin) {
      hint = `endpoint ${cfg.local.baseUrl} is not reachable. MODEL_PATH is set but llama.cpp was not found on PATH or ~/.local/bin/llama. Set LLAMA_BIN in .env to your llama binary.`;
    } else {
      hint = `endpoint ${cfg.local.baseUrl} is not reachable. Set MODEL_START_CMD (or LLAMA_BIN + MODEL_PATH) in .env so 'go' can start your model server.`;
    }
    return { started: false, ready: false, alive: false, error: hint };
  }

  const out = fs.openSync(logFile(cfg), 'a');
  const err = fs.openSync(logFile(cfg), 'a');
  const child = spawn(bin, args, { stdio: ['ignore', out, err], detached: true, cwd: cfg.rootDir });
  fs.writeFileSync(pidFile(cfg), String(child.pid));
  child.unref();

  const ready = await waitForReady(cfg, 20000);
  return { started: true, ready, alive: isProcessAlive(child.pid) };
}

async function waitForReady(cfg, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probeEndpoint(cfg.local.baseUrl, { timeoutMs: 2000 });
    if (probe.ok) return true;
    await sleep(1000);
  }
  return false;
}

function stopModelServer(cfg) {
  const pid = readPid(cfg);
  if (!pid) return { stopped: false, reason: 'no model server PID recorded by this launcher' };
  if (!isProcessAlive(pid)) {
    try { fs.unlinkSync(pidFile(cfg)); } catch { /* ignore */ }
    return { stopped: false, reason: 'process already gone (cleaned PID file)' };
  }
  killProcess(pid, 'SIGTERM');
  // give it a moment, then force if still alive
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) { if (!isProcessAlive(pid)) break; sleepSync(100); }
  if (isProcessAlive(pid)) killProcess(pid, 'SIGKILL');
  try { fs.unlinkSync(pidFile(cfg)); } catch { /* ignore */ }
  return { stopped: true, pid };
}

// Synchronous sleep (used only for short reaping windows in stop).
function sleepSync(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { /* spin briefly */ }
}

// --- KLYVIA mode resolution ---
// local  : only the local backend (llama.cpp). Auto-start it if possible.
// remote : require KLYVIA_SERVER_URL; if unreachable, fail hard (no silent local).
// auto   : if KLYVIA_SERVER_URL is set AND reachable, use remote; else local.
// Returns { backend: 'local'|'remote', url, reachable, reason }.
async function resolveBackend(cfg) {
  const mode = cfg.klyviaMode;
  const serverUrl = cfg.klyviaServerUrl;
  if (mode === 'local') return { backend: 'local', reachable: false, reason: 'KLYVIA_MODE=local' };
  if (serverUrl) {
    const probe = await probeEndpoint(serverUrl, { timeoutMs: 3000 });
    if (probe.ok) return { backend: 'remote', url: serverUrl, reachable: true, reason: 'KLYVIA server reachable' };
    if (mode === 'remote') {
      return { backend: 'remote', url: serverUrl, reachable: false, reason: `KLYVIA_MODE=remote but server ${serverUrl} is unreachable (${probe.error})` };
    }
    // auto: server configured but down → fall back to local (and say so).
    return { backend: 'local', reachable: false, reason: `KLYVIA server unreachable (${probe.error}); falling back to local backend` };
  }
  // No server configured.
  if (mode === 'remote') {
    return { backend: 'remote', reachable: false, reason: 'KLYVIA_MODE=remote but KLYVIA_SERVER_URL is not set' };
  }
  return { backend: 'local', reachable: false, reason: 'no KLYVIA_SERVER_URL configured; using local backend' };
}

// A compact welcome banner printed before the TUI. Pure formatting, no I/O side
// effects beyond writing to stdout.
function welcomeBanner(cfg, backend, probe) {
  const model = backend.backend === 'remote' ? '(remote server)' : (cfg.local.model || '—');
  const backendLabel = backend.backend === 'remote' ? 'KLYVIA server' : 'llama.cpp';
  const status = probe && probe.ok
    ? green('● CONNECTED')
    : (backend.backend === 'remote' ? red('● DISCONNECTED') : yellow('○ STARTING'));
  const lines = [
    `${bold(c('cyan', 'K L Y V I A'))}  ${dim('· local AI coding agent')}`,
    `${dim('Project')}  ${cfg.rootDir}`,
    `${dim('Backend')}  ${backendLabel}`,
    `${dim('Model')}    ${model}`,
    `${dim('Status')}   ${status}`,
  ];
  const inner = Math.max(...lines.map((l) => stripAnsi(l).length)) + 2;
  const top = `╭${'─'.repeat(inner)}╮`;
  const bot = `╰${'─'.repeat(inner)}╯`;
  const mid = lines.map((l) => `│ ${l}${' '.repeat(Math.max(0, inner - stripAnsi(l).length - 1))}│`);
  return [top, ...mid, bot].join('\n');
}
function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }

// Subcommand implementations -------------------------------------------------

async function cmdStart(cfg) {
  const backend = await resolveBackend(cfg);
  log(bold('Starting services…') + dim(`  (mode: ${cfg.klyviaMode})`));
  if (backend.backend === 'remote') {
    if (!backend.reachable) {
      log(red('✗') + ' KLYVIA server required but unavailable.');
      log(dim(backend.reason));
      log(dim('Set KLYVIA_MODE=auto to fall back to the local backend, or start the KLYVIA server.'));
      return false;
    }
    log(green('✓') + ` KLYVIA server READY at ${backend.url}`);
    return true;
  }
  // local backend
  if (backend.reason && backend.reason.includes('falling back')) {
    log(yellow('•') + ' ' + backend.reason);
  }
  const res = await startModelServer(cfg);
  if (res.ready) { log(green('✓') + ` model server READY at ${cfg.local.baseUrl}`); return true; }
  log(red('✗') + ' model server NOT ready');
  if (res.error) log(dim(res.error));
  if (res.alive) log(dim('A process is running but the endpoint did not become healthy in time.'));
  return false;
}

async function cmdStop(cfg) {
  log(bold('Stopping services…'));
  const res = stopModelServer(cfg);
  if (res.stopped) log(green('✓') + ` stopped model server (pid ${res.pid})`);
  else log(yellow('•') + ' ' + res.reason);
  return true;
}

async function cmdRestart(cfg) {
  await cmdStop(cfg);
  log('');
  return cmdStart(cfg);
}

async function cmdStatus(cfg) {
  const backend = await resolveBackend(cfg);
  if (backend.backend === 'remote') {
    log(bold('Service status'));
    log(`  Agent    ${green('READY')}`);
    log(`  Backend  ${backend.reachable ? green('READY') : red('UNREACHABLE')}  ${dim('(remote)')}`);
    log(`  Server   ${cfg.klyviaServerUrl}`);
    log(`  Mode     ${cfg.klyviaMode}`);
    log(`  Project  ${dim(cfg.rootDir)}`);
    return backend.reachable;
  }
  const probe = await probeEndpoint(cfg.local.baseUrl);
  const pid = readPid(cfg);
  const managedAlive = pid && isProcessAlive(pid);
  const llmState = probe.ok ? green('READY') : (managedAlive ? yellow('STARTING') : red('STOPPED'));
  log(bold('Service status'));
  log(`  Agent    ${green('READY')}`);
  log(`  LLM      ${llmState}`);
  log(`  Mode     ${cfg.klyviaMode}  ${dim('(local backend)')}`);
  log('');
  log(`  Endpoint ${cfg.local.baseUrl}`);
  log(`  Model    ${cfg.local.model}`);
  log(`  PID      ${pid ? (managedAlive ? String(pid) + dim(' (alive)') : String(pid) + red(' (dead)')) : dim('— (not managed by klyvia)')}`);
  log(`  Project  ${dim(cfg.rootDir)}`);
  return probe.ok;
}

async function cmdLogs(cfg, { lines = 40 } = {}) {
  const f = logFile(cfg);
  if (!fs.existsSync(f)) { log(dim('No logs yet at ' + f)); return; }
  try {
    const out = execFileSync('tail', ['-n', String(lines), f], { encoding: 'utf-8' });
    process.stdout.write(out);
  } catch {
    const data = fs.readFileSync(f, 'utf-8');
    process.stdout.write(data.split('\n').slice(-lines).join('\n'));
  }
}

async function cmdDoctor(cfg) {
  let ok = true;
  const check = (label, cond, detail) => {
    log(`${cond ? green('✓') : red('✗')} ${label}${detail ? dim('  ' + detail) : ''}`);
    if (!cond) ok = false;
  };

  log(bold('KLYVIA doctor\n'));
  check('Node.js', true, `v${process.version.replace(/^v/, '')}`);
  check('KLYVIA app code', fs.existsSync(path.join(APP_ROOT, 'package.json')), APP_ROOT);
  const nm = fs.existsSync(path.join(APP_ROOT, 'node_modules'));
  check('dependencies installed', nm, nm ? '' : 'run `npm install` in the app dir');
  const envFile = fs.existsSync(path.join(APP_ROOT, '.env'));
  // Configuration absence is informational, not a failure: the app runs with
  // defaults. Only flag a hard failure if deps/code are missing.
  log(`${envFile ? green('✓') : yellow('•')} configuration (.env)${envFile ? '' : dim('  using defaults; run `klyvia config` or copy .env.example')}`);
  check('install type', true, isManagedInstall() ? `managed (~/.klyvia/app)` : 'dev clone');
  check('working project (cwd)', true, cfg.rootDir);

  // KLYVIA mode + remote server
  const backend = await resolveBackend(cfg);
  check('KLYVIA_MODE', true, `${cfg.klyviaMode} → backend: ${backend.backend}`);
  if (cfg.klyviaServerUrl) {
    check('KLYVIA server reachable', backend.reachable, backend.reason);
  }

  // Local backend checks (only relevant when local is in play)
  if (backend.backend !== 'remote' || !backend.reachable) {
    const port = parsePort(cfg.local.baseUrl);
    check('local endpoint URL valid', port !== '?', cfg.local.baseUrl);
    const probe = await probeEndpoint(cfg.local.baseUrl);
    check('local model endpoint reachable', probe.ok, probe.ok ? '' : (probe.error || 'no response'));
    check('model name set', !!cfg.local.model, cfg.local.model || '(empty)');
    if (cfg.modelStartCmd) check('MODEL_START_CMD set', true, cfg.modelStartCmd);
    else {
      const llamaBin = findLlamaBin(cfg);
      check('llama.cpp binary', !!llamaBin, llamaBin ? llamaBin : 'not found on PATH or ~/.local/bin/llama (set LLAMA_BIN)');
      const modelExists = cfg.modelPath && fs.existsSync(cfg.modelPath);
      check('model file (MODEL_PATH)', !!modelExists, modelExists ? cfg.modelPath : (cfg.modelPath ? `${cfg.modelPath} (missing!)` : 'not set (set MODEL_PATH to your .gguf)'));
      if (llamaBin && modelExists) check('auto-start ready', true, dim('klyvia can start llama.cpp for you'));
    }
  }
  check('safety guard configured', cfg.protectedPaths.length > 0, `${cfg.protectedPaths.length} protected patterns`);

  log('');
  log(ok ? green('All critical checks passed.') : red('Some checks failed — see above.'));
  return ok;
}

async function cmdTui(cfg) {
  const started = await cmdStart(cfg);
  if (!started) {
    log(red('\nRefusing to launch the TUI: the model backend is not ready.'));
    log(dim('Fix the above and run `klyvia` again, or run `klyvia doctor`.'));
    process.exit(1);
  }
  const backend = await resolveBackend(cfg);
  const probe = backend.backend === 'remote'
    ? { ok: backend.reachable }
    : await probeEndpoint(cfg.local.baseUrl);
  log('');
  log(welcomeBanner(cfg, backend, probe));
  log(bold('\nLaunching TUI…') + dim(' (CTRL+C to exit)\n'));
  // Launch the TUI against the USER's project (WORK_DIR), not the app install
  // dir. KLYVIA_APP_ROOT is exported so the child's buildConfig() can locate
  // the bundled skills/.env even though cwd is the user's project.
  const tui = path.join(APP_ROOT, 'index.js');
  const child = spawn(process.execPath, [tui], {
    stdio: 'inherit',
    cwd: WORK_DIR,
    env: { ...process.env, KLYVIA_APP_ROOT: APP_ROOT },
  });
  const stop = () => { try { stopModelServer(cfg); } catch { /* ignore */ } };
  process.on('SIGINT', () => { child.kill('SIGINT'); });
  process.on('SIGTERM', () => { child.kill('SIGTERM'); });
  child.on('exit', (code) => { stop(); process.exit(code ?? 0); });
}

// --- Install management helpers ---

// A "managed install" is one cloned into ~/.klyvia/app by install.sh. A dev
// clone (run from the repo) is NOT managed. `klyvia update`/`uninstall` only
// operate on managed installs.
function isManagedInstall() {
  try { return path.resolve(APP_ROOT) === path.resolve(klyviaAppInstall()); }
  catch { return false; }
}

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf-8'));
    return pkg.version || 'unknown';
  } catch { return 'unknown'; }
}

function readInstallCommit() {
  try { return execSync('git rev-parse --short HEAD', { cwd: APP_ROOT, encoding: 'utf-8', stdio: 'pipe' }).trim(); }
  catch { return 'unknown'; }
}

// Print a config value, masking anything that looks like a secret key.
function displayValue(key, val) {
  if (!val) return dim('(empty)');
  if (/API_KEY|TOKEN|SECRET|PASSWORD/i.test(key)) {
    const s = String(val);
    return s.length > 6 ? dim(s.slice(0, 3) + '…' + s.slice(-2) + ' (hidden)') : dim('(set)');
  }
  return val;
}

async function cmdConfig(cfg) {
  log(bold('KLYVIA configuration\n'));
  log(dim('Config source: ' + (fs.existsSync(path.join(APP_ROOT, '.env')) ? path.join(APP_ROOT, '.env') : 'defaults (no .env)')));
  log(dim('Install type:  ' + (isManagedInstall() ? 'managed (~/.klyvia/app)' : 'dev clone')));
  log('');
  const rows = [
    ['KLYVIA_MODE', cfg.klyviaMode],
    ['KLYVIA_SERVER_URL', cfg.klyviaServerUrl],
    ['KLYVIA_API_KEY', cfg.klyviaApiKey],
    ['MODEL_PROVIDER', cfg.provider],
    ['LOCAL_MODEL_BASE_URL', cfg.local.baseUrl],
    ['LOCAL_MODEL_NAME', cfg.local.model],
    ['MODEL_PATH', cfg.modelPath],
    ['LLAMA_BIN', cfg.llamaBin || dim('(auto-detect)')],
    ['LLAMA_CONTEXT', cfg.llamaContext],
    ['LLAMA_HOST', cfg.llamaHost],
  ];
  for (const [k, v] of rows) {
    log(`  ${dim(k.padEnd(22))} ${displayValue(k, v)}`);
  }
  log('');
  log(dim('Edit these in: ' + (isManagedInstall() ? klyviaConfigFile() : path.join(APP_ROOT, '.env'))));
  log(dim('Or set them as environment variables before running klyvia.'));
}

async function cmdUpdate(cfg) {
  log(bold('KLYVIA update\n'));
  if (!isManagedInstall()) {
    log(yellow('This is a dev clone, not a managed install.'));
    log(dim('To update, run: git pull && npm install'));
    log(dim('To use the managed installer: curl -fsSL https://raw.githubusercontent.com/' + KLYVIA_REPO + '/' + KLYVIA_BRANCH + '/install.sh | bash'));
    return false;
  }
  const oldCommit = readInstallCommit();
  const oldVersion = readVersion();
  log(dim('Current: v' + oldVersion + ' (' + oldCommit + ')'));
  log(dim('Pulling from ' + KLYVIA_REPO + ':' + KLYVIA_BRANCH + '…'));
  try {
    execSync(`git fetch origin ${KLYVIA_BRANCH}`, { cwd: APP_ROOT, stdio: 'pipe' });
    execSync(`git reset --hard origin/${KLYVIA_BRANCH}`, { cwd: APP_ROOT, stdio: 'pipe' });
  } catch (e) {
    log(red('✗ git update failed: ' + (e.stderr ? e.stderr.toString().trim() : e.message)));
    return false;
  }
  log(dim('Installing dependencies…'));
  try { execSync('npm install --silent', { cwd: APP_ROOT, stdio: 'pipe' }); }
  catch (e) { log(yellow('• npm install reported warnings.')); }
  const newCommit = readInstallCommit();
  const newVersion = readVersion();
  log(green('✓ updated.') + dim(`  v${oldVersion} (${oldCommit}) → v${newVersion} (${newCommit})`));
  if (oldCommit === newCommit) log(dim('Already up to date.'));
  log(dim('Your configuration was preserved.'));
  return true;
}

// Resolve KLYVIA home paths dynamically (so HOME can be overridden in tests).
function klyviaHome() { return path.join(process.env.HOME || '', '.klyvia'); }
function klyviaAppInstall() { return path.join(klyviaHome(), 'app'); }
function klyviaConfigDir() { return path.join(klyviaHome(), 'config'); }
function klyviaConfigFile() { return path.join(klyviaConfigDir(), 'config.env'); }
function klyviaRuntime() { return path.join(klyviaHome(), 'runtime'); }

async function cmdUninstall(cfg, args = []) {
  const purge = args.includes('--purge');
  const yes = args.includes('--yes');
  const APP = klyviaAppInstall();
  const RUNTIME = klyviaRuntime();
  const CONFIG_FILE = klyviaConfigFile();
  log(bold('KLYVIA uninstall\n'));
  log('This will remove:');
  log('  • ' + APP + dim(' (the app code)'));
  log('  • ' + RUNTIME + dim(' (runtime: pid, logs)'));
  log('  • ~/.local/bin/{klyvia,go,GO} symlinks');
  log('');
  if (purge) {
    log(red('  --purge: ALSO remove ' + CONFIG_FILE + dim(' (your configuration)')));
  } else {
    log(dim('Kept (not removed):'));
    log(dim('  • ' + CONFIG_FILE + ' (your configuration)'));
    log(dim('  • your .gguf models and llama.cpp'));
    log(dim('  • your projects'));
  }
  log('');
  if (!yes) {
    const tty = process.stdin.isTTY;
    if (!tty) {
      log(red('Refusing to uninstall non-interactively without --yes.'));
      return false;
    }
    process.stdout.write(yellow('Proceed? [y/N] '));
    const ans = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    const reply = await new Promise((r) => ans.question('', (a) => { ans.close(); r(a.trim().toLowerCase()); }));
    if (reply !== 'y' && reply !== 'yes') { log('Aborted.'); return false; }
  }
  // Stop services first.
  try { stopModelServer(cfg); } catch { /* ignore */ }
  const binDir = path.join(process.env.HOME || '', '.local', 'bin');
  for (const name of ['klyvia', 'go', 'GO']) {
    try { fs.unlinkSync(path.join(binDir, name)); } catch { /* ignore */ }
  }
  try { fs.rmSync(APP, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(RUNTIME, { recursive: true, force: true }); } catch { /* ignore */ }
  if (purge) {
    try { fs.rmSync(klyviaConfigDir(), { recursive: true, force: true }); } catch { /* ignore */ }
  }
  log(green('✓ KLYVIA uninstalled.') + (purge ? dim(' (configuration purged)') : dim(' (configuration kept)')));
  return true;
}

function usage() {
  log(bold('Usage: klyvia [command]\n'));
  log('  klyvia            start backend + launch the TUI');
  log('  klyvia start      start the model server (if configured)');
  log('  klyvia stop       stop services managed by klyvia');
  log('  klyvia restart    stop + start');
  log('  klyvia status     show service readiness + active backend');
  log('  klyvia logs       tail model-server logs');
  log('  klyvia doctor     run a full diagnostic');
  log('  klyvia config     show configuration (secrets hidden)');
  log('  klyvia update     update the app from GitHub (managed installs)');
  log('  klyvia uninstall  remove KLYVIA (config kept unless --purge)');
  log('  klyvia help       this message');
  log('  klyvia --version  print the version');
  log('');
  log(dim('`go` and `GO` are aliased to `klyvia`. Run from any directory.'));
  log(dim('App: ' + APP_ROOT + '  ·  Project: ' + WORK_DIR));
}

async function main() {
  const arg = process.argv[2] || '';
  // buildConfig: rootDir = the user's project (cwd); appRoot = KLYVIA's code.
  const cfg = buildConfig({ rootDir: WORK_DIR, appRoot: APP_ROOT });
  switch (arg) {
    case '': return cmdTui(cfg);
    case 'start': { const ok = await cmdStart(cfg); process.exit(ok ? 0 : 1); }
    case 'stop': { await cmdStop(cfg); process.exit(0); }
    case 'restart': { const ok = await cmdRestart(cfg); process.exit(ok ? 0 : 1); }
    case 'status': { const ok = await cmdStatus(cfg); process.exit(ok ? 0 : 1); }
    case 'logs': return cmdLogs(cfg);
    case 'doctor': { const ok = await cmdDoctor(cfg); process.exit(ok ? 0 : 1); }
    case 'config': return cmdConfig(cfg);
    case 'update': { const ok = await cmdUpdate(cfg); process.exit(ok ? 0 : 1); }
    case 'uninstall': { const ok = await cmdUninstall(cfg, process.argv.slice(3)); process.exit(ok ? 0 : 1); }
    case '-h': case '--help': case 'help': return usage();
    case '-v': case '--version': { log('klyvia v' + readVersion()); return; }
    default:
      log(red(`Unknown command: ${arg}`));
      usage();
      process.exit(2);
  }
}

if (require.main === module) {
  main().catch((err) => { log(red(`Fatal: ${err.message}`)); process.exit(1); });
}

module.exports = {
  probeEndpoint, startModelServer, stopModelServer, readPid, isProcessAlive,
  runtimeDir, pidFile, logFile, cmdDoctor, cmdStatus, cmdStart, cmdStop,
  findLlamaBin, buildLlamaStartCommand, resolveBackend, welcomeBanner,
  isManagedInstall, readVersion, cmdConfig, cmdUninstall,
};
