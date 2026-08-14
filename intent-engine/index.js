const { classify } = require('./rules');

function understand(input) {
  const result = classify(input);

  return {
    ...result,
    input: input.trim(),
    requiresAI: result.intent === 'agent_task' ||
      result.intent === 'debug' ||
      result.intent === 'modify_code'
  };
}

module.exports = {
  understand
};
