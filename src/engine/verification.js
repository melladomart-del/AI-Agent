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
    if (obs.startsWith('Error: unknown tool')) return { passed: false, output: obs };

    // A "failed" observation: an explicit FAILED marker, a non-zero exit line
    // (runCommand/runTests emit "[exit N] ..."), or a tool-level Error.
    const isFailed = /^Error:|\bFAILED\b|\[exit [1-9]/.test(obs);

    if (verifyCommand) {
      // For a custom command, success is an exit-0 (no failure marker). We do
      // NOT require a literal "PASSED" token — arbitrary commands (build,
      // lint, a require-check) succeed by exiting 0.
      return { passed: !isFailed, output: obs };
    }
    // For the default test runner, require an explicit PASSED marker so a
    // no-op/empty test run is not mistaken for success.
    const passed = !isFailed && /\bPASSED\b/.test(obs);
    return { passed, output: obs };
  }
}

module.exports = { Verifier };
