const { classify } = require('./rules');

function understand(input) {
  const result = classify(input);
  const text = input.trim().toLowerCase();

  const requiresAI =
    result.intent === 'agent_task' ||
    result.intent === 'debug' ||
    result.intent === 'modify_code' ||
    (
      result.intent === 'read_file' &&
      /\b(explique|expliquer|analyse|analyser|résume|resume|comprends|comprendre)\b/.test(text)
    );

  return {
    ...result,
    input: input.trim(),
    requiresAI
  };
}

module.exports = {
  understand
};
