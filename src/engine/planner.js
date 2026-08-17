'use strict';

/**
 * Produces a lightweight plan from the task, repo map, retrieved experiences,
 * and selected skills. The plan is a short ordered list of steps used to
 * orient the agent before the action loop begins.
 *
 * This is the "architect" side of the Aider architect/editor split: reasoning
 * about what to do, expressed compactly, before any tool calls.
 */
class Planner {
  constructor({ modelRouter, config }) {
    this.modelRouter = modelRouter;
    this.config = config;
  }

  async plan({ task, repoMap, experiences, skills }) {
    const expText = experiences && experiences.length ? `\nPast similar experiences:\n${experiences}` : '';
    const prompt = `You are the planning phase of an autonomous coding agent.
Produce a concise, ordered plan (max 8 bullet points) to accomplish the task.
Do not write code; only plan the steps and which files/tools are likely relevant.

Task:
${task}

Repository map (symbols ranked by importance):
${repoMap || '(empty repo)'}
${expText}
Relevant skills loaded:
${skills ? skills.split('\n\n---\n\n').map((s) => s.split('\n')[0]).join(', ') : '(none)'}

Respond with a numbered list only.`;

    const msg = await this.modelRouter.complete({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 512,
    });
    return msg.content || '';
  }
}

module.exports = { Planner };
