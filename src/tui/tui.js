'use strict';

const readline = require('readline');

/**
 * Minimal interactive terminal UI. Reads a task, runs the orchestrator, prints
 * tool calls / observations / the final result, and loops. Designed to stay
 * light (no external TUI deps) for the low-resource local target.
 */
class TUI {
  constructor(orchestrator) {
    this.orch = orchestrator;
  }

  start() {
    this._wireEvents();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const prompt = () => rl.question('> ', async (line) => {
      const task = (line || '').trim();
      if (!task) return prompt();
      if (task === '/exit' || task === '/quit') return rl.close();
      try {
        const result = await this.orch.run(task);
        // eslint-disable-next-line no-console
        console.log('\n=== Result ===');
        // eslint-disable-next-line no-console
        console.log('OK:', result.ok);
        // eslint-disable-next-line no-console
        console.log('Summary:', result.summary || '(none)');
        if (result.verified) {
          // eslint-disable-next-line no-console
          console.log('Verified:', result.verified.passed ? 'PASSED' : 'FAILED');
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Agent error:', err.message);
      }
      prompt();
    });
    // eslint-disable-next-line no-console
    console.log('AI-Agent TUI. Type a coding task, or /exit to quit.');
    prompt();
  }

  _wireEvents() {
    this.orch.on('tool:call', ({ name, args }) => {
      // eslint-disable-next-line no-console
      console.log(`\n[tool] ${name}(${JSON.stringify(args)})`);
    });
    this.orch.on('tool:result', ({ name, observation }) => {
      const preview = String(observation).split('\n').slice(0, 15).join('\n');
      // eslint-disable-next-line no-console
      console.log(`[obs] ${preview}${observation.length > 15 * 80 ? '\n... (truncated)' : ''}`);
    });
  }
}

module.exports = { TUI };
