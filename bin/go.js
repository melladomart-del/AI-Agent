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
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { buildConfig } = require(path.join(ROOT, 'src', 'config'));

// ANSI helpers (disabled when not a TTY or NO_COLOR set).
const C = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (C ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => c('32', s);
const red = (s) => c('31', s);
const yellow = (s) => c('33', s);
const dim = (s) => c('2', s);
const bold = (s) => c('1', s);

function log(msg) { process.stdout.write(msg + '\n'); }

// Resolve the runtime dir under the project root (gitignored).
function runtimeDir(cfg) {
  const dir = path.resolve(cfg.rootDir, cfg.runtimeDir || '.agent-runtime');
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
 * Start the model server (only if MODEL_START_CMD is set and the endpoint is
 * not already reachable). Resolves to { started, ready, alive, error? }.
 */
async function startModelServer(cfg) {
  const probe = await probeEndpoint(cfg.local.baseUrl);
  if (probe.ok) return { started: false, ready: true, alive: true };

  const existing = readPid(cfg);
  if (existing && isProcessAlive(existing)) {
    return { started: false, ready: false, alive: true, error: 'model process running but endpoint not responding (still warming up?)' };
  }

  if (!cfg.modelStartCmd) {
    return {
      started: false, ready: false, alive: false,
      error: `endpoint ${cfg.local.baseUrl} is not reachable and no MODEL_START_CMD is configured.\n` +
        `Start your local model server (e.g. llama-server, LM Studio) pointing at ${cfg.local.baseUrl}, or set MODEL_START_CMD in .env so 'go' can start it for you.`,
    };
  }

  const bin = cfg.modelStartCmd;
  const args = cmdArgs(cfg.modelStartArgs);
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

// Subcommand implementations -------------------------------------------------

async function cmdStart(cfg) {
  log(bold('Starting services…'));
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
  const probe = await probeEndpoint(cfg.local.baseUrl);
  const pid = readPid(cfg);
  const managedAlive = pid && isProcessAlive(pid);
  const llmState = probe.ok ? green('READY') : (managedAlive ? yellow('STARTING') : red('STOPPED'));
  const agentState = green('READY');
  log(bold('Service status'));
  log(`  Agent    ${agentState}`);
  log(`  LLM      ${llmState}`);
  log(`  TUI      ${dim('via `go`')}`);
  log('');
  log(`  Endpoint ${cfg.local.baseUrl}`);
  log(`  Model    ${cfg.local.model}`);
  log(`  PID      ${pid ? (managedAlive ? String(pid) + dim(' (alive)') : String(pid) + red(' (dead)')) : dim('— (not managed by go)')}`);
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
  check('package.json', fs.existsSync(path.join(cfg.rootDir, 'package.json')), cfg.rootDir);
  const nm = fs.existsSync(path.join(cfg.rootDir, 'node_modules'));
  check('dependencies installed', nm, nm ? '' : 'run `npm install`');
  const envFile = fs.existsSync(path.join(cfg.rootDir, '.env'));
  check('configuration (.env)', envFile, envFile ? '' : 'using defaults; copy .env.example to .env');
  const port = parsePort(cfg.local.baseUrl);
  check('endpoint URL valid', port !== '?', cfg.local.baseUrl);
  const probe = await probeEndpoint(cfg.local.baseUrl);
  check('model endpoint reachable', probe.ok, probe.ok ? '' : (probe.error || 'no response'));
  check('model name set', !!cfg.local.model, cfg.local.model || '(empty)');
  if (cfg.modelStartCmd) check('MODEL_START_CMD set', true, cfg.modelStartCmd);
  else check('MODEL_START_CMD (optional)', true, dim('not set — start your model server manually'));
  check('safety guard configured', cfg.protectedPaths.length > 0, `${cfg.protectedPaths.length} protected patterns`);
  if (String(port) === '11434') log(yellow('•') + dim(' note: port 11434 is Ollama; fine only if intended'));

  log('');
  log(ok ? green('All critical checks passed.') : red('Some checks failed — see above.'));
  return ok;
}

async function cmdTui(cfg) {
  const started = await cmdStart(cfg);
  if (!started) {
    log(red('\nRefusing to launch the TUI: the model endpoint is not ready.'));
    log(dim('Fix the above and run `go` again, or run `go doctor`.'));
    process.exit(1);
  }
  log(bold('\nLaunching TUI…') + dim(' (CTRL+C to exit)\n'));
  const tui = path.join(ROOT, 'index.js');
  const child = spawn(process.execPath, [tui], { stdio: 'inherit', cwd: cfg.rootDir });
  const stop = () => { try { stopModelServer(cfg); } catch { /* ignore */ } };
  process.on('SIGINT', () => { child.kill('SIGINT'); });
  process.on('SIGTERM', () => { child.kill('SIGTERM'); });
  child.on('exit', (code) => { stop(); process.exit(code ?? 0); });
}

function usage() {
  log(bold('Usage: go [command]\n'));
  log('  go            start services + launch the TUI');
  log('  go start      start the model server (if configured)');
  log('  go stop       stop services managed by go');
  log('  go restart    stop + start');
  log('  go status     show service readiness');
  log('  go logs       tail model-server logs');
  log('  go doctor     run a diagnostic');
  log('');
  log(dim('Run from any directory. Project root: ' + ROOT));
}

async function main() {
  const arg = process.argv[2] || '';
  const cfg = buildConfig({ rootDir: ROOT });
  switch (arg) {
    case '': return cmdTui(cfg);
    case 'start': { const ok = await cmdStart(cfg); process.exit(ok ? 0 : 1); }
    case 'stop': { await cmdStop(cfg); process.exit(0); }
    case 'restart': { const ok = await cmdRestart(cfg); process.exit(ok ? 0 : 1); }
    case 'status': { const ok = await cmdStatus(cfg); process.exit(ok ? 0 : 1); }
    case 'logs': return cmdLogs(cfg);
    case 'doctor': { const ok = await cmdDoctor(cfg); process.exit(ok ? 0 : 1); }
    case '-h': case '--help': case 'help': return usage();
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
};
