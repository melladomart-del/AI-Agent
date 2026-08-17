'use strict';

const path = require('path');
const { SafetyGuard } = require('../engine/safety');

/**
 * Holds tools, exposes OpenAI-style schemas, and dispatches calls with safety
 * enforcement. Adding a new tool = register({ ... }) — no agent changes needed.
 *
 * Inspired by OpenHands' tool/executor split (schema + executor + security)
 * but kept dependency-free.
 */
class ToolRegistry {
  constructor(config) {
    this.config = config;
    this.guard = new SafetyGuard(config);
    this.tools = new Map();
  }

  register(tool) {
    this.tools.set(tool.name, tool);
    return this;
  }

  list() {
    return Array.from(this.tools.values());
  }

  schemas() {
    return this.list().map((t) => t.getSchema());
  }

  get(name) {
    return this.tools.get(name);
  }

  /**
   * Execute a tool by name with raw args. Returns a string observation.
   * Safety rejections are returned as observations (not thrown) so the agent
   * can observe and self-correct.
   */
  async dispatch(name, args, ctx = {}) {
    const tool = this.get(name);
    if (!tool) return `Error: unknown tool "${name}".`;
    args = args || {};
    // Provide a working directory to handlers so file/shell tools resolve
    // paths and commands relative to the workspace root WITHOUT mutating the
    // process cwd (which would be unsafe under concurrent execution). Handlers
    // that understand `ctx.cwd` use it; legacy handlers fall back to cwd.
    ctx = { cwd: this.config.rootDir || process.cwd(), ...ctx };

    if ((tool.permissions || {}).write && args.path) {
      if (!this._insideRoot(args.path)) {
        return `Error: path "${args.path}" is outside the workspace.`;
      }
      if (this.guard.isProtected(args.path)) {
        return `Error: path "${args.path}" is protected and cannot be modified.`;
      }
    }

    if ((tool.permissions || {}).shell) {
      const blocked = this.guard.blockedReason(args.command);
      if (blocked) return `Error: command blocked by safety policy (matched "${blocked}").`;
    }

    try {
      const result = await tool.handler(args, ctx);
      return result == null ? '' : String(result);
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }

  _insideRoot(p) {
    const root = path.resolve(this.config.rootDir || process.cwd());
    const abs = path.resolve(root, p);
    const rel = path.relative(root, abs);
    return !rel.startsWith('..');
  }
}

module.exports = { ToolRegistry };
