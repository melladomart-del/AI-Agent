'use strict';

const readline = require('readline');
const path = require('path');
const R = require('./render');

/**
 * Interactive terminal UI for the autonomous coding agent.
 *
 * Design rule: the TUI is a pure OBSERVER of the orchestrator's EventBus. It
 * owns no engine state — it only accumulates display counters from events and
 * prints compact, streaming blocks as the agent works. There is no second
 * planning/orchestration/verification layer here. Output is a scrolling
 * transcript (no full-screen repaint), which stays cheap on an old machine
 * and robust under terminal resize.
 */
class TUI {
  constructor(orchestrator, { out = process.stdout, input = process.stdin } = {}) {
    this.orch = orchestrator;
    this.out = out;
    this.input = input;
    this.rl = null;
    this.history = [];
    this.running = false;

    // Display counters, derived only from emitted events.
    this.state = this._freshState();
    this._unsub = [];
  }

  _freshState() {
    return {
      task: '', phase: 'IDLE', iteration: 0, maxIterations: 0,
      tools: 0, files: 0, testsPassed: null, errors: 0, correctionRounds: 0,
    };
  }

  async start() {
    this._wireEvents();
    this._print(R.header(this.orch.config));
    this._print('');

    // Show model availability up front so the user gets an actionable message
    // instead of submitting a task that will hang on a connection error.
    const probe = await this._probeModel();
    if (!probe.reachable) {
      this._print(R.modelUnavailable(probe));
      this._print('');
    }

    this._print('Type a coding task and press Enter. Type /help for commands, /exit to quit.');
    this._print('');

    this.rl = readline.createInterface({ input: this.input, output: this.out, terminal: this.out.isTTY });
    this.rl.setPrompt(`${R.bold('>') } `);
    // Lightweight command history (in-memory only; no disk file for low resource).
    this.rl.on('history', (h) => { this.history = h; });
    this.rl.on('SIGINT', () => this._handleInterrupt());
    this.rl.prompt();
    this.rl.on('line', (line) => this._onLine(line));
    this.rl.on('close', () => this._cleanup());
  }

  async _probeModel() {
    try {
      return await this.orch.modelRouter.isReachable();
    } catch (err) {
      return { reachable: false, error: err.message };
    }
  }

  async _onLine(line) {
    const text = (line || '').trim();
    if (!text) { this.rl.prompt(); return; }
    // If a task is running, queue further input (e.g. a piped /exit) until it
    // finishes. With interactive TTY input this is a no-op; with piped input it
    // prevents a trailing /exit from tearing down subscriptions mid-run.
    if (this.running) { this._queue = this._queue || []; this._queue.push(text); return; }
    await this._dispatch(text);
    this.rl.prompt();
  }

  async _dispatch(text) {
    if (text.startsWith('/')) {
      const keep = await this._handleCommand(text);
      if (!keep) { this.rl.close(); return; }
      return;
    }
    await this._runTask(text);
    // Drain any input that arrived while we were running.
    if (this._queue && this._queue.length) {
      const pending = this._queue.splice(0);
      for (const next of pending) {
        if (next === '/exit' || next === '/quit') { this.rl.close(); return; }
        await this._dispatch(next);
      }
    }
  }

  async _runTask(task) {
    this.running = true;
    this.state = this._freshState();
    this.state.task = task;
    try {
      const result = await this.orch.run(task);
      this._print('');
      this._print(R.completionLine(result));
      if (result.summary) this._print(R.dim(result.summary));
      if (result.verified) {
        this._print(R.dim(`Verified: ${result.verified.passed ? 'PASSED' : 'FAILED'}`));
      }
    } catch (err) {
      this._print(R.paint('red', `✗ Agent error: ${err.message}`));
    } finally {
      this.running = false;
      // If readline hit EOF/close mid-run, tear down now that we're done.
      if (this._closed) {
        this._teardown();
        if (this.input === process.stdin) process.stdin.destroy();
      }
    }
  }

  async _handleCommand(cmd) {
    const [name, ...rest] = cmd.slice(1).split(/\s+/);
    const arg = rest.join(' ').trim();
    switch (name) {
      case 'help': this._print(this._helpText()); return true;
      case 'status': this._print(R.statusLine(this.state)); return true;
      case 'model': await this._showModel(); return true;
      case 'tools': this._print(this._toolsText()); return true;
      case 'memory': this._print(this._memoryText()); return true;
      case 'skills': this._print(this._skillsText(arg)); return true;
      case 'clear': this._clear(); return true;
      case 'exit': case 'quit': return false;
      default:
        this._print(R.dim(`Unknown command: ${cmd}. Try /help.`));
        return true;
    }
  }

  _helpText() {
    const rows = [
      ['/help', 'show this help'],
      ['/status', 'current task phase + counters'],
      ['/model', 'active model, backend and reachability'],
      ['/tools', 'available agent tools'],
      ['/memory', 'recent recorded experiences'],
      ['/skills [task]', 'skills that would be selected for a task'],
      ['/clear', 'clear the screen'],
      ['/exit', 'quit the agent'],
    ];
    const w = Math.max(...rows.map((r) => r[0].length));
    return [R.bold('Commands'), ...rows.map((r) => `  ${r[0].padEnd(w)}  ${R.dim(r[1])}`)].join('\n');
  }

  _toolsText() {
    const tools = this.orch.registry.list();
    if (!tools.length) return R.dim('(no tools registered)');
    return [R.bold(`Tools (${tools.length})`), ...tools.map((t) => `  ${R.bold(t.name)} — ${R.dim(t.description || '')}`)].join('\n');
  }

  _memoryText() {
    let all;
    try { all = this.orch.memory.load(); } catch { all = []; }
    if (!all.length) return R.dim('(no experiences recorded yet)');
    const recent = all.slice(-5).reverse();
    return [R.bold(`Memory (${all.length} experiences, last 5)`),
      ...recent.map((e) => `  ${R.dim('#' + (e.score ?? '?'))} ${String(e.task).slice(0, 60)} → ${e.result || 'unknown'}`),
    ].join('\n');
  }

  _skillsText(task) {
    const reg = this.orch.contextSelector.skills;
    const all = reg.all ? reg.all() : reg.skills;
    if (!all || !all.length) return R.dim('(no skills available)');
    const selectedNames = new Set();
    const t = task || this.state.task || '';
    // Mark relevance by the registry's own scorer when available.
    for (const s of all) {
      const score = reg._score ? reg._score(t, s) : 0;
      if (score > 0 || ['planning', 'debugging', 'error-recovery', 'git', 'testing'].includes(s.name)) selectedNames.add(s.name);
    }
    return [R.bold(`Skills (${all.length}${task ? ` for "${t}"` : ''})`),
      ...all.map((s) => `  ${selectedNames.has(s.name) ? R.paint('green', '●') : R.dim('○')} ${R.bold(s.name)} — ${R.dim(String(s.title || '').split('\n')[0])}`),
    ].join('\n');
  }

  async _showModel() {
    const probe = await this._probeModel();
    const lines = [
      `${R.dim('Provider')} ${this.orch.config.provider}`,
      `${R.dim('Model')}    ${probe.model || '—'}`,
      `${R.dim('Backend')}  ${R.backendLabel(this.orch.config)}`,
      `${R.dim('Endpoint')} ${probe.baseUrl || '—'}`,
      `${R.dim('Status')}   ${probe.reachable ? R.paint('green', 'reachable') : R.paint('red', 'unreachable')}`,
    ];
    this._print(R.box(lines, 'Model'));
  }

  _clear() {
    if (this.out.isTTY && this.out.write('\x1b[2J\x1b[H')) return;
    this._print('');
  }

  _handleInterrupt() {
    if (this.running) {
      // SIGINT during a run: signal abort rather than killing the process.
      this._print(R.paint('yellow', '\n● Interrupt requested; finishing current step…'));
      this.orch.bus.emit('abort', { reason: 'user-interrupt' });
      return;
    }
    this._print('');
    this.rl.close();
  }

  _cleanup() {
    // Do NOT unsubscribe while a task is still running: piped input reaches EOF
    // and fires readline 'close' before the async run completes, which would
    // strip all event handlers mid-task. Defer teardown until the run ends.
    if (this.running) { this._closed = true; return; }
    this._teardown();
    if (this.input === process.stdin) process.stdin.destroy();
  }

  _teardown() {
    for (const off of this._unsub) try { off(); } catch { /* noop */ }
    this._unsub = [];
    if (!this._exited) {
      this._exited = true;
      this.out.write('\n');
    }
  }

  // --- EventBus subscription: the whole UI is driven by these. ---

  _wireEvents() {
    const on = (ev, fn) => this._unsub.push(this.orch.bus.on(ev, fn));

    on('phase', ({ phase, iteration, maxIterations }) => {
      this.state.phase = phase;
      if (iteration) this.state.iteration = iteration;
      if (maxIterations) this.state.maxIterations = maxIterations;
      if (phase === 'EXECUTING') this._print(R.phaseLine(phase, this._counters()));
    });

    on('memory:retrieve', ({ experiences }) => {
      if (experiences && experiences.length) this._print(R.memoryRetrieveBlock(experiences));
    });

    on('tool:call', ({ name, args }) => {
      this.state.tools++;
      if (/File$/i.test(name) && name !== 'listFiles') this.state.files++;
      if (name === 'runTests' || name === 'runCommand') this.state.phase = name === 'runTests' ? 'RUNNING TESTS' : 'EXECUTING TOOL';
      this._print(R.toolCallHeader(name, args));
    });

    on('tool:result', ({ name, observation }) => {
      const obs = String(observation);
      const tests = R.parseTestSummary(obs);
      if (tests) { this.state.testsPassed = Number(obs.match(/(\d+)\s+pass|# pass\s+(\d+)/)?.[1] || 0); }
      if (/^Error:|\[exit [1-9]|\bFAILED\b/.test(obs)) this.state.errors++;
      this._print(R.toolResultBlock(name, observation));
    });

    on('correct:start', () => this._print(R.paint('yellow', '⚠ TEST FAILURE — agent is diagnosing and correcting…')));
    on('correct:round', ({ attempt, maxRetries }) => {
      this.state.correctionRounds = attempt;
      this.state.phase = 'CORRECTING';
      this._print(R.correctionBlock(attempt, maxRetries));
    });
    on('correct:result', ({ fixed }) => this._print(fixed ? R.paint('green', '✓ Correction successful') : R.paint('red', '✗ Correction failed')));

    on('verify:result', ({ passed }) => {
      this.state.phase = 'VERIFYING';
      if (passed && this.state.testsPassed == null) this.state.testsPassed = 'passed';
    });

    on('memory:record', ({ result }) => this._print(R.memoryRecordBlock(result)));

    on('error', ({ error }) => this._print(R.paint('red', `✗ Error: ${error}`)));
  }

  _counters() {
    return {
      iteration: this.state.iteration, maxIterations: this.state.maxIterations,
      tools: this.state.tools, files: this.state.files, errors: this.state.errors,
    };
  }

  _print(s) {
    this.out.write(s + '\n');
  }
}

module.exports = { TUI };
