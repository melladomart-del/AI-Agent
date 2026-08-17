'use strict';

const path = require('path');
const { minimatch } = require('../util/minimatch');

/**
 * Safety layer for tool execution. Enforces:
 *  - protected write paths (never writable by the agent)
 *  - blocked shell commands
 * It returns a rejection string (not an exception) so the agent can observe
 * and self-correct, mirroring OpenHands' "observation, not crash" pattern.
 */
class SafetyGuard {
  constructor(config) {
    this.rootDir = config.rootDir || process.cwd();
    this.protected = config.protectedPaths || [];
    this.blocked = config.blockedCommands || [];
  }

  normalize(p) {
    return path.resolve(this.rootDir, p);
  }

  /** True if the path is protected (cannot be written/deleted by the agent). */
  isProtected(target) {
    const abs = this.normalize(target);
    const rel = path.relative(this.rootDir, abs);
    if (rel.startsWith('..')) return true; // outside workspace
    const relForward = rel.split(path.sep).join('/');
    const base = path.basename(relForward);
    return this.protected.some((pat) => {
      // Match either the full relative path or just the basename, so that
      // patterns like "*.key" protect keys at any depth (keys/private.key).
      return minimatch(relForward, pat) || minimatch(base, pat);
    });
  }

  /** Returns the blocked pattern that earliest matches the command, or null. */
  blockedReason(command) {
    if (typeof command !== 'string') return null;
    const lower = command.toLowerCase();
    let best = null;
    let bestIdx = Infinity;
    for (const pat of this.blocked) {
      const idx = lower.indexOf(pat.toLowerCase());
      if (idx !== -1 && idx < bestIdx) {
        bestIdx = idx;
        best = pat;
      }
    }
    return best;
  }
}

module.exports = { SafetyGuard };
