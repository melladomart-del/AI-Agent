#!/usr/bin/env node
'use strict';

const { Orchestrator } = require('./src/engine/orchestrator');
const { TUI } = require('./src/tui/tui');

async function main() {
  const orch = new Orchestrator();
  const task = process.argv.slice(2).join(' ').trim();
  if (task) {
    const result = await orch.run(task);
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
    process.exit(result.ok && (!result.verified || result.verified.passed) ? 0 : 1);
  } else {
    new TUI(orch).start();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err.message);
  process.exit(1);
});
