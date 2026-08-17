'use strict';

/**
 * The autonomous agent loop. Core idea (from OpenHands): an agent is a function
 * from event history to the next event, run in a loop until finish or budget.
 *
 * Loop shape:
 *   understand -> plan -> select context -> choose tools -> execute ->
 *   observe -> (test -> verify -> success? no: correct -> test again) -> done
 *
 * This file is intentionally small: it owns the action/observation loop and the
 * message history. Everything else (context, planning, verification, memory)
 * is injected.
 */
class Agent {
  constructor({ modelRouter, registry, contextSelector, planner, verifier, corrector, memory, config, eventBus }) {
    this.modelRouter = modelRouter;
    this.registry = registry;
    this.contextSelector = contextSelector;
    this.planner = planner;
    this.verifier = verifier;
    this.corrector = corrector;
    this.memory = memory;
    this.config = config;
    this.bus = eventBus;
  }

  _systemPrompt(plan, context) {
    return `You are an autonomous AI software-engineering agent running locally.
You operate by choosing tools, observing their results, and iterating until the task is done.

Workflow:
1. Understand the task.
2. Inspect the repository structure (listFiles, searchCode) if needed.
3. Read the relevant files before modifying them.
4. Make focused edits (editFile or writeFile).
5. Run tests/commands to verify your changes (runTests or runCommand).
6. If verification fails, diagnose and correct before continuing.
7. Call \`finish\` with a short summary when the task is complete.

Rules:
- Make minimal, focused changes.
- Never claim success without verifying (run tests or the relevant command).
- Prefer editFile over rewriting whole files when possible.
- Respect protected paths and safety rejections returned by tools.

Plan:
${plan || '(no explicit plan)'}

Repository map (key symbols, ranked):
${context.repoMap || '(empty repo)'}

Relevant skills:
${context.skills || '(none)'}

${context.experiences ? 'Relevant past experiences:\n' + context.experiences : ''}
You have the following tools available: listFiles, readFile, writeFile, editFile, deleteFile, searchCode, runCommand, gitCommit, gitStatus, runTests, finish.`;
  }

  /**
   * Run the agent loop for a task.
   * @param {string} task
   * @param {object} [opts]
   * @param {boolean} [opts.resume] - if true, skip planning (already planned).
   * @param {string} [opts.verifyCommand] - custom verification command.
   */
  async run(task, opts = {}) {
    this.bus.emit('task:start', { task });

    const context = this.contextSelector.build(task);
    let plan = '';
    if (!opts.resume && this.planner) {
      try {
        const plannerInput = this.contextSelector.buildForPlanner(task);
        plan = await this.planner.plan(plannerInput);
      } catch (err) {
        plan = `(planning skipped: ${err.message})`;
      }
    }

    const messages = [
      { role: 'system', content: this._systemPrompt(plan, context) },
      { role: 'user', content: task },
    ];

    const errors = [];
    const actions = [];
    let summary = '';
    let finished = false;

    for (let step = 0; step < this.config.maxSteps; step++) {
      this.bus.emit('step:start', { step });
      let message;
      try {
        message = await this.modelRouter.complete({
          messages,
          tools: this.registry.schemas(),
        });
      } catch (err) {
        this.bus.emit('error', { step, error: err.message });
        return { ok: false, summary: `model error: ${err.message}`, steps: step, errors };
      }
      messages.push(message);

      if (!message.tool_calls || message.tool_calls.length === 0) {
        summary = message.content || '';
        finished = true;
        break;
      }

      for (const call of message.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }
        this.bus.emit('tool:call', { name: call.function.name, args });
        const observation = await this.registry.dispatch(call.function.name, args);
        this.bus.emit('tool:result', { name: call.function.name, observation });
        actions.push({ name: call.function.name, args });
        if (/^Error:/.test(observation)) errors.push({ tool: call.function.name, observation });

        if (call.function.name === 'finish' || String(observation).startsWith('__FINISH__')) {
          summary = String(observation).replace('__FINISH__', '') || args.summary || '';
          finished = true;
          messages.push({ role: 'tool', tool_call_id: call.id, content: observation });
          break;
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: observation });
      }
      if (finished) break;
    }

    // Verification + auto-correction, unless this was a resumed correction run.
    let verified = null;
    if (!opts.resume && finished) {
      verified = await this.verifier.verify({ verifyCommand: opts.verifyCommand });
      if (!verified.passed && this.corrector) {
        const correction = await this.corrector.correct({
          failureOutput: verified.output,
          task,
          verifyCommand: opts.verifyCommand,
        });
        verified = { passed: correction.fixed, output: correction.finalOutput };
      }
    }

    const result = {
      ok: finished,
      summary,
      steps: messages.filter((m) => m.role === 'tool').length,
      actions,
      errors,
      verified,
    };

    // Record an experience for future retrieval.
    if (!opts.resume) {
      try {
        const score = verified ? (verified.passed ? 1 : -1) : 0;
        this.memory.record({
          task,
          plan,
          actions: actions.map((a) => a.name),
          errors: errors.map((e) => e.observation),
          corrections: [],
          result: verified ? (verified.passed ? 'passed' : 'failed') : 'unknown',
          score,
          tags: task.toLowerCase().split(/\W+/).filter((w) => w.length >= 3).slice(0, 8),
        });
      } catch {
        // memory must never break the agent
      }
    }

    this.bus.emit('task:end', { task, result });
    return result;
  }
}

module.exports = { Agent };
