'use strict';

/**
 * A stateful, observation-driven mock of an OpenAI-compatible chat-completions
 * server, used by the integration tests to exercise the REAL agent loop
 * (provider request -> tool-call normalization -> tool dispatch -> observation
 * -> verification -> memory) WITHOUT a GPU or a downloaded model.
 *
 * It is NOT a fake of the agent: it never touches the filesystem or runs
 * tests. It only decides, from the conversation history it receives, what a
 * small coding model would plausibly answer next -- as fenced JSON inside
 * `content` (the common small-model spelling), so the normalization layer is
 * exercised for real. All file edits, command execution, and test results are
 * produced by the real tools; the mock merely routes between them based on the
 * genuine observations it sees.
 *
 * Exposed as startMockServer() (returns an http.Server on an ephemeral port)
 * so tests can start/stop it deterministically. No external deps.
 */

const http = require('http');

function json(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
}

function fencedToolCall(thinking, name, args) {
  return {
    content: `${thinking}\n\`\`\`json\n${JSON.stringify({ name, arguments: args })}\n\`\`\``,
  };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Decide the next "model" response from the conversation so far.
 * `lastToolContent` is the content of the most recent role:'tool' message
 * (the observation the agent just received), or '' on the first turn.
 *
 * `fixes` is an ordered list of {fixPath, buggyPattern, fixedPattern}. The mock
 * applies them in order: it edits the first bug present in the file content;
 * once none of the buggy patterns remain, it runs the tests. This lets a
 * multi-bug project exercise the failure -> diagnose -> correct branch: the
 * first edit only repairs some tests, the remaining failure drives a second edit.
 */
function decideResponse({ messages, lastToolContent, finishSummary, fixes, prematureFinishAfterEdit }) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const fix0 = fixes[0];
  const fixPath = fix0.fixPath;

  // Planning call (planner sends a single user message with the planning
  // prompt). Reply with a short plan and NO tool call.
  if (lastUser && /planning phase of an autonomous coding agent|Produce a concise, ordered plan/i.test(String(lastUser.content))) {
    return { content: '1. List files to understand the project.\n2. Read the broken source file.\n3. Fix the bug.\n4. Run the tests.\n5. Finish.' };
  }

  // If the agent appended a "stop repeating / make the fix" nudge, push it
  // toward editing the first still-present bug.
  if (lastUser && /Stop repeating|Respond by calling a tool|make the fix with editFile/i.test(String(lastUser.content))) {
    const f = fixes.find((fx) => fx.buggyPattern) || fix0;
    return fencedToolCall('Applying the fix now.', 'editFile', {
      path: f.fixPath,
      oldStr: f.buggyPattern,
      newStr: f.fixedPattern,
    });
  }

  // Turn 1: no tool observation yet -> list files.
  if (!lastToolContent) {
    return fencedToolCall('I will inspect the repository first.', 'listFiles', { dir: '.' });
  }

  const obs = String(lastToolContent);

  // After listFiles: read the broken source file (recognise the file listing).
  if (new RegExp(escapeRe(fixPath) + '$', 'm').test(obs) && !/function |module\.exports/.test(obs)) {
    return fencedToolCall('Reading the source file to find the bug.', 'readFile', { path: fixPath });
  }

  // After readFile: if any known buggy pattern is present, edit it; otherwise
  // (all fixed) run the tests.
  if (/function |module\.exports/.test(obs)) {
    const f = fixes.find((fx) => fx.buggyPattern && new RegExp(escapeRe(fx.buggyPattern)).test(obs));
    if (f) {
      return fencedToolCall('Found a bug. Fixing it.', 'editFile', {
        path: f.fixPath,
        oldStr: f.buggyPattern,
        newStr: f.fixedPattern,
      });
    }
    return fencedToolCall('The file looks correct. Running the tests to verify.', 'runTests', {});
  }

  // After editFile success ("Edited ..."): run the tests to verify.
  if (/^Edited |^Wrote /.test(obs)) {
    return fencedToolCall('Running the test suite to verify the fix.', 'runTests', {});
  }

  // After runTests: branch on the REAL test output we were shown.
  if (/tests PASSED/.test(obs)) {
    return {
      content: finishSummary || 'The tests pass. Done.',
      tool_calls: [{ id: 'c-finish', type: 'function', function: { name: 'finish', arguments: JSON.stringify({ summary: 'Fixed the bug; tests pass.' }) } }],
    };
  }
  if (/tests FAILED|\[exit [1-9]/.test(obs)) {
    // Tests still fail -- re-read the file to diagnose, which routes back
    // through the readFile branch (fix the next still-present bug, or re-verify).
    return fencedToolCall('Tests still fail -- re-reading the file to diagnose.', 'readFile', { path: fixPath });
  }

  // Fallback: finish rather than loop forever.
  return { content: '', tool_calls: [{ id: 'c-finish', type: 'function', function: { name: 'finish', arguments: JSON.stringify({ summary: 'done' }) } }] };
}

/**
 * Build an http request handler that turns the decided response into an OpenAI
 * chat completion shape, emitting EITHER a native tool_calls object OR a
 * fenced-JSON content string depending on `mode` ('fenced' | 'native').
 * 'fenced' is the default because it is the harder, small-model path.
 *
 * `fixes` is an array of {fixPath, buggyPattern, fixedPattern}.
 */
function buildHandler(opts) {
  const { fixes, finishSummary, mode, prematureFinishAfterEdit } = opts;
  // Track how many edits the mock has emitted, so the premature-finish mode
  // only triggers once (after the first edit), then lets the loop proceed
  // normally on the corrector's resume run.
  let editsEmitted = 0;
  return (req, res) => {
    if (req.url === '/v1/models' && req.method === 'GET') {
      return json(res, { object: 'list', data: [{ id: 'mock-coder', object: 'model' }] });
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { /* ignore */ }
        const messages = parsed.messages || [];
        const lastTool = [...messages].reverse().find((m) => m.role === 'tool');
        const lastToolContent = lastTool ? String(lastTool.content) : '';

        // Premature-finish hook: right after the first edit succeeds, claim
        // completion instead of running tests. This leaves verification
        // failing, so the orchestrator's Corrector is exercised.
        if (prematureFinishAfterEdit && editsEmitted >= 1 && /^Edited |^Wrote /.test(lastToolContent)) {
          editsEmitted++;
          return json(res, {
            id: 'chatcmpl-mock', object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: 'I think the fix is done.', tool_calls: [{ id: 'c-finish', type: 'function', function: { name: 'finish', arguments: JSON.stringify({ summary: 'fixed' }) } }] }, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          });
        }

        let decided = decideResponse({ messages, lastToolContent, finishSummary, fixes });
        if (decided.content && /```json/.test(decided.content)) {
          const m = decided.content.match(/```json\s*([\s\S]*?)```/);
          if (m) {
            try {
              const call = JSON.parse(m[1]);
              if (call.name === 'editFile') editsEmitted++;
            } catch { /* ignore */ }
          }
        }
        if (mode === 'native' && decided.content && /```json/.test(decided.content)) {
          const m = decided.content.match(/```json\s*([\s\S]*?)```/);
          if (m) {
            try {
              const call = JSON.parse(m[1]);
              decided = { content: null, tool_calls: [{ id: 'c-' + call.name, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] };
            } catch { /* fall through to fenced */ }
          }
        }

        const msg = { role: 'assistant', content: decided.content ?? null, tool_calls: decided.tool_calls || undefined };
        return json(res, {
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          choices: [{ index: 0, message: msg, finish_reason: decided.tool_calls ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  };
}

/**
 * Start the mock server on an ephemeral port.
 * @param {object} opts
 *   fixes: [{fixPath, buggyPattern, fixedPattern}, ...]
 *   finishSummary?: string
 *   mode?: 'fenced' | 'native' (default 'fenced')
 * @returns {Promise<{server:http.Server,url:string}>}
 *   url is the base, e.g. http://127.0.0.1:<port>/v1
 */
function startMockServer(opts) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(buildHandler(opts));
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/v1` });
    });
  });
}

module.exports = { startMockServer, decideResponse, buildHandler };
