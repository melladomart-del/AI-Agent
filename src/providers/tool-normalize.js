'use strict';

/**
 * Tool-call normalization for small local coding models that often emit tool
 * calls as TEXT (fenced JSON, bare JSON, or an HTTP-style tag wrapping JSON)
 * instead of in the registered OpenAI-style `tool_calls` field. The agent loop
 * only cares about the canonical shape, which is produced here.
 *
 * Canonical assistant message shape (what the engine consumes):
 *   { role: 'assistant', content: string|null, tool_calls: [{id,type,function:{name,arguments:string}}] }
 *
 * A candidate "tool call object" is any of these spellings:
 *   { "name": "readFile", "arguments": { "path": "..." } }
 *   { "tool": "readFile", "input": { ... } }
 *   { "function": "readFile", "parameters": { ... } }
 *   { "name": "readFile", "arguments": "<json string>" }   (OpenAI-echo style)
 */

// Build tag names from concatenation so the literal markup never appears in
// source (keeps editors/runtimes from misreading it).
const OPEN_TAG = '<' + 'tool_call' + '>';
const CLOSE_TAG = '</' + 'tool_call' + '>';
const TAG_RE = new RegExp(OPEN_TAG + '\\s*([\\s\\S]*?)\\s*' + CLOSE_TAG, 'gi');

const VALID_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function _isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Extract the tool name + args object from a candidate parsed object. */
function _toToolCall(obj, idBase, knownNames) {
  if (!_isObj(obj)) return null;
  const name =
    typeof obj.name === 'string' ? obj.name :
    typeof obj.tool === 'string' ? obj.tool :
    typeof obj.function === 'string' ? obj.function : null;
  if (!name || !VALID_NAME_RE.test(name)) return null;
  // If a known-names set is provided, only accept names it contains. This
  // avoids mistaking arbitrary JSON (e.g. { name: "...", ... }) for a call.
  if (knownNames && !knownNames.has(name)) return null;

  let args = obj.arguments ?? obj.input ?? obj.parameters ?? obj.args ?? {};
  // Some models echo the OpenAI shape with arguments as a JSON *string*.
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      args = { _raw: args };
    }
  }
  if (!_isObj(args)) args = {};
  return {
    id: `call_${idBase}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

/* Match fenced code blocks, capturing the inner text. Non-greedy, multiline. */
const FENCE_RE = /```(?:json|tool_code|tool|jsonc)?\s*\n?([\s\S]*?)```/gi;

function _tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Normalize a raw provider message into the canonical shape.
 * @param {object} message - raw ChatCompletionMessage (may have content/tool_calls)
 * @param {object} [opts]
 * @param {Set<string>} [opts.knownNames] - set of valid tool names (recommended)
 * @returns {object} a message with normalized `content` and `tool_calls`
 */
function normalizeMessage(message, opts = {}) {
  const msg = message || {};
  const known = opts.knownNames || null;
  const hasNative = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;

  if (hasNative) {
    // Clean native calls: ensure id, type, and stringified arguments.
    const tool_calls = msg.tool_calls.map((c, i) => {
      const fn = c.function || {};
      let args = fn.arguments;
      if (args == null) args = '{}';
      if (typeof args !== 'string') {
        try {
          args = JSON.stringify(args);
        } catch {
          args = '{}';
        }
      }
      return {
        id: c.id || `call_${i}`,
        type: 'function',
        function: { name: fn.name, arguments: args },
      };
    });
    return { role: msg.role || 'assistant', content: msg.content ?? null, tool_calls };
  }

  const content = typeof msg.content === 'string' ? msg.content : '';
  if (!content.trim()) {
    return { role: msg.role || 'assistant', content: msg.content ?? '', tool_calls: [] };
  }

  const candidates = [];
  let m;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(content)) !== null) candidates.push(m[1]);
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(content)) !== null) candidates.push(m[1]);
  // Bare JSON object/array attempt (only if the whole trimmed content is JSON)
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    candidates.push(trimmed);
  }

  const calls = [];
  let idc = 0;
  for (const blob of candidates) {
    const parsed = _tryParseJson(blob);
    if (parsed === undefined) continue;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      const call = _toToolCall(item, idc++, known);
      if (call) calls.push(call);
    }
    if (calls.length) break; // use the first representation that yielded calls
  }

  return {
    role: msg.role || 'assistant',
    content: msg.content ?? '',
    tool_calls: calls,
  };
}

module.exports = { normalizeMessage, VALID_NAME_RE };
