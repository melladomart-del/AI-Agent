/**
 * Backward-compatible entrypoint. `node agent.js "your task"` now delegates to
 * the new orchestrator-based agent loop in ./index.js. The original prototype
 * (OpenRouter + load-all-skills) has been superseded by the modular engine.
 */
require('./index.js');
