'use strict';

/**
 * Auto-correction loop. Given a failing verification, feeds the failure output
 * back to the agent for up to maxRetries rounds so it can diagnose and fix its
 * own changes. Mirrors the "test -> fail -> diagnose -> correct -> test again"
 * branch of the required agent loop.
 */
class Corrector {
  constructor({ agent, verifier, config }) {
    this.agent = agent;
    this.verifier = verifier;
    this.maxRetries = config.maxRetries ?? 3;
  }

  async correct({ failureOutput, task, verifyCommand }) {
    const attempts = [];
    for (let i = 0; i < this.maxRetries; i++) {
      const instruction = `Your previous changes failed verification with:\n\n${failureOutput}\n\nDiagnose the failure and fix it. Then call finish when done.`;
      const result = await this.agent.run(`${task}\n\n${instruction}`, { resume: true });
      attempts.push(result);
      const v = await this.verifier.verify({ verifyCommand });
      if (v.passed) return { fixed: true, attempts, finalOutput: v.output };
      failureOutput = v.output;
    }
    return { fixed: false, attempts, finalOutput: failureOutput };
  }
}

module.exports = { Corrector };
