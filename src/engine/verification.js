'use strict';

/**
 * Verification layer. After the agent thinks it is done, we run an objective
 * check. By default that means running the test suite; if the task specified a
 * verification command, use that. Returns { passed, output }.
 *
 * Verification is separated from the agent loop so the result is an objective
 * observation the corrector can act on, not the agent's own claim of success.
 */
class Verifier {
  constructor({ registry, config }) {
    this.registry = registry;
    this.config = config;
  }

  async verify({ verifyCommand } = {}) {
    let obs;
    if (verifyCommand) {
      obs = await this.registry.dispatch('runCommand', { command: verifyCommand });
    } else {
      obs = await this.registry.dispatch('runTests', {});
    }
    const passed = !/\bFAILED\b|\[exit [1-9]/.test(obs) && /\bPASSED\b/.test(obs);
    // If runTests wasn't available or returned an error, treat as failed.
    if (obs.startsWith('Error: unknown tool')) return { passed: false, output: obs };
    return { passed, output: obs };
  }
}

module.exports = { Verifier };
