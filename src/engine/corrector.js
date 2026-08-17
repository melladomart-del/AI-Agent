'use strict';

/**
 * Auto-correction loop. Given a failing verification, feeds the failure output
 * back to the agent for up to maxRetries rounds so it can diagnose and fix its
 * own changes. Mirrors the "test -> fail -> diagnose -> correct -> test again"
 * branch of the required agent loop.
 */
class Corrector {
  constructor({ agent, verifier, config, eventBus }) {
    this.agent = agent;
    this.verifier = verifier;
    this.maxRetries = config.maxRetries ?? 3;
    this.bus = eventBus;
  }

  async correct({ failureOutput, task, verifyCommand }) {
    this.bus?.emit('correct:start', { task });
    const attempts = [];
    for (let i = 0; i < this.maxRetries; i++) {
      this.bus?.emit('correct:round', { attempt: i + 1, maxRetries: this.maxRetries });
      const instruction = `Your previous changes failed verification with:\n\n${failureOutput}\n\nDiagnose the failure and fix it. Then call finish when done.`;
      const result = await this.agent.run(`${task}\n\n${instruction}`, { resume: true });
      attempts.push(result);
      const v = await this.verifier.verify({ verifyCommand });
      this.bus?.emit('verify:result', { passed: v.passed, phase: 'correction' });
      if (v.passed) {
        this.bus?.emit('correct:result', { fixed: true, attempts: i + 1 });
        return { fixed: true, attempts, finalOutput: v.output };
      }
      failureOutput = v.output;
    }
    this.bus?.emit('correct:result', { fixed: false, attempts: this.maxRetries });
    return { fixed: false, attempts, finalOutput: failureOutput };
  }
}

module.exports = { Corrector };
