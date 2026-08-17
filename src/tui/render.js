'use strict';

/**
 * Pure formatting helpers for the TUI. Every function returns a string and
 * performs no I/O, so the rendering layer is unit-testable without a TTY.
 *
 * Design: the TUI is a streaming transcript, not a full-screen dashboard.
 * Blocks are printed as events arrive (no cursor juggling, no full repaints),
 * which stays robust on resize and cheap on an old machine. Colors use ANSI
 * escapes but are disabled for non-TTY output or when NO_COLOR is set, so the
 * same code paths produce readable plain text in CI/logs.
 */

const COLORS = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

function colorEnabled() {
  if (process.env.NO_COLOR) return false;
  return process.stdout.isTTY !== false;
}

// Evaluated per-call (cheap env+TTY check) so tests and late env changes are
// respected, and so the same render module works in a TTY and piped to a file.
function paint(color, s) { return colorEnabled() ? `${COLORS[color] || ''}${s}${COLORS.reset}` : s; }
function dim(s) { return paint('dim', s); }
function bold(s) { return paint('bold', s); }

function box(lines, label) {
  const tl = '╭', tr = '╮', bl = '╰', br = '╯';
  const inner = Math.max(label ? label.length + 4 : 0, ...lines.map((l) => stripAnsi(l).length)) + 2;
  // When a label is given, render it as a title on the top border: ╭─ Label ─╮
  const top = label
    ? `${tl}${'─'} ${label} ${'─'.repeat(Math.max(1, inner - label.length - 3))}${tr}`
    : `${tl}${'─'.repeat(inner)}${tr}`;
  const mid = lines.map((l) => `│ ${l}${' '.repeat(Math.max(0, inner - stripAnsi(l).length - 1))}│`);
  const bot = `${bl}${'─'.repeat(inner)}${br}`;
  return [top, ...mid, bot].join('\n');
}

function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }

/**
 * Detect the backend family from a base URL / provider, for the header line.
 * Never an authoritative source — just a friendly label.
 */
function backendLabel(config) {
  const url = (config.provider === 'cloud' ? config.cloud.baseUrl : config.local.baseUrl) || '';
  if (/lmstudio/i.test(url)) return 'LM Studio';
  if (/ollama/i.test(url) || /:11434/.test(url)) return 'Ollama';
  if (/vllm/i.test(url)) return 'vLLM';
  if (config.provider === 'cloud') return 'cloud';
  return 'llama.cpp';
}

function header(config, probe) {
  const model = config.provider === 'cloud' ? config.cloud.model : config.local.model;
  const endpoint = config.provider === 'cloud' ? config.cloud.baseUrl : config.local.baseUrl;
  const reachable = probe ? !!probe.reachable : null;
  const status = reachable === null
    ? paint('yellow', '○ UNKNOWN')
    : reachable ? paint('green', '● CONNECTED') : paint('red', '● DISCONNECTED');
  const lines = [
    `${bold(paint('cyan', 'KLYVIA'))} ${dim('· local coding agent')}`,
    `${dim('Model')}    ${model}`,
    `${dim('Backend')}  ${backendLabel(config)}`,
    `${dim('Endpoint')} ${endpoint}`,
    `${dim('Status')}   ${status}`,
  ];
  return box(lines, null);
}

function modelUnavailable(info) {
  const url = info.baseUrl || 'unknown';
  const lines = [
    `${paint('red', bold('LOCAL MODEL UNAVAILABLE'))}`,
    '',
    `Cannot connect to:`,
    `${dim(url)}`,
    '',
    'Start an OpenAI-compatible local model server and try again.',
  ];
  return box(lines, null);
}

/**
 * Summarize a tool observation compactly: tests counts, exit status, file
 * edits, or a short preview. Keeps the terminal from drowning in output.
 */
function summarizeObservation(name, observation) {
  const obs = String(observation);
  const lines = obs.split('\n');
  const tests = parseTestSummary(obs);
  if (tests) return tests;

  if (/^Error:/.test(obs)) return { ok: false, text: firstLines(obs, 3) };
  const m = obs.match(/\[exit (\d+)\]/);
  if (m) {
    const body = firstLines(obs.replace(/\[exit \d+\]\s*/, ''), 3);
    return { ok: m[1] === '0', text: `${dim('exit ' + m[1])}\n${body}` };
  }
  if (/^(Wrote|Created|Deleted|Updated|Saved)/.test(obs) || /bytes\)$/.test(obs)) {
    return { ok: true, text: firstLines(obs, 2) };
  }
  // search/read: show hit count + a couple of context lines
  if (name === 'searchCode') {
    const hits = (obs.match(/^.*:\d+:/gm) || []).length;
    return { ok: true, text: `${dim(`${hits} match${hits === 1 ? '' : 'es'}`)}\n${firstLines(obs, 3)}` };
  }
  return { ok: true, text: firstLines(obs, 3) };
}

function parseTestSummary(obs) {
  const passed = (obs.match(/\b(\d+)\s+pass/i) || obs.match(/# pass\s+(\d+)/) || [])[1];
  const failed = (obs.match(/\b(\d+)\s+fail/i) || obs.match(/# fail\s+(\d+)/) || [])[1];
  if (passed === undefined && failed === undefined) return null;
  const p = Number(passed || 0);
  const f = Number(failed || 0);
  const text = `${p} passed, ${f} failure${f === 1 ? '' : 's'}`;
  return { ok: f === 0, text };
}

function firstLines(s, n) {
  const out = s.split('\n').filter((l) => l.trim()).slice(0, n).join('\n');
  return out || dim('(no output)');
}

function toolCallHeader(name, args) {
  const arg = describeArgs(name, args);
  return `${bold(paint('blue', '▶ ' + name))}${arg ? '  ' + dim(arg) : ''}`;
}

function describeArgs(name, args) {
  if (!args || typeof args !== 'object') return '';
  switch (name) {
    case 'readFile': case 'editFile': case 'writeFile': case 'deleteFile':
      return args.path || '';
    case 'searchCode':
      return args.pattern ? `"${args.pattern}"` : '';
    case 'runCommand': case 'runTests':
      return args.command || '';
    case 'gitCommit':
      return args.message ? `"${String(args.message).slice(0, 40)}"` : '';
    case 'finish':
      return args.summary ? `"${String(args.summary).slice(0, 60)}"` : '';
    default:
      return Object.keys(args).length ? JSON.stringify(args).slice(0, 60) : '';
  }
}

function toolResultBlock(name, observation) {
  const sum = summarizeObservation(name, observation);
  const mark = sum.ok ? paint('green', '✓') : paint('red', '✗');
  return `${mark} ${sum.text}`;
}

function verificationBlock(passed, output) {
  const sum = parseTestSummary(String(output || '')) || { ok: passed, text: firstLines(String(output || ''), 2) };
  const lines = [
    `${sum.ok ? paint('green', '✓ Verification passed') : paint('red', '✗ Verification failed')}`,
    sum.text,
  ];
  return box(lines, 'Verification');
}

function correctionBlock(round, maxRetries, fixed) {
  const lines = [
    `${paint('yellow', '⚠ TEST FAILURE — auto-correcting')}`,
    `${dim(`Correction round ${round} / ${maxRetries}`)}`,
  ];
  return box(lines, 'Correction');
}

function memoryRetrieveBlock(experiences) {
  const head = experiences[0];
  const lines = [
    `${dim('Retrieved previous experience:')}`,
    `"${String(head.task || '').slice(0, 60)}"`,
    `${dim('Result:')} ${head.result || 'unknown'}  ${dim('Score:')} ${head.score ?? '?'}`,
  ];
  return box(lines, 'MEMORY');
}

function memoryRecordBlock(result) {
  const lines = [
    `${dim('Task result saved for future coding tasks.')}`,
    `${dim('Result:')} ${result || 'unknown'}`,
  ];
  return box(lines, 'EXPERIENCE RECORDED');
}

function phaseLine(phase, counters) {
  const c = counters || {};
  const tag = bold(paint('cyan', '● ' + phase));
  const meta = [];
  if (c.iteration && c.maxIterations) meta.push(`iter ${c.iteration}/${c.maxIterations}`);
  if (c.tools) meta.push(`tools ${c.tools}`);
  if (c.files) meta.push(`files ${c.files}`);
  if (c.errors) meta.push(`${paint('red', 'errors ' + c.errors)}`);
  return `${tag}${meta.length ? '  ' + dim(meta.join('  ')) : ''}`;
}

function statusLine(state) {
  const s = state || {};
  const tests = s.testsPassed != null ? `${s.testsPassed} passed` : '—';
  const lines = [
    `${dim('Task')}     ${s.task || '—'}`,
    `${dim('Phase')}    ${s.phase || 'IDLE'}`,
    `${dim('Iteration')} ${s.iteration || 0} / ${s.maxIterations || 0}`,
    `${dim('Tools')}    ${s.tools || 0}`,
    `${dim('Files')}    ${s.files || 0}`,
    `${dim('Tests')}    ${tests}`,
    `${dim('Errors')}   ${s.errors || 0}`,
  ];
  return box(lines, 'Status');
}

function completionLine(result) {
  if (result && result.verified && result.verified.passed) {
    return paint('green', bold('✓ Task completed successfully'));
  }
  if (result && result.ok === false) {
    return paint('red', bold('✗ Task failed'));
  }
  return paint('yellow', bold('● Task ended without verification'));
}

module.exports = {
  COLORS, colorEnabled, stripAnsi, paint, dim, bold,
  header, modelUnavailable, backendLabel,
  summarizeObservation, parseTestSummary,
  toolCallHeader, toolResultBlock, describeArgs,
  verificationBlock, correctionBlock,
  memoryRetrieveBlock, memoryRecordBlock,
  phaseLine, statusLine, completionLine, box,
};
