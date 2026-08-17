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
    return `You are an autonomous AI software-engineering agent running on a local model.
You act ONLY by calling tools, observing results, and iterating until the task is done. Do not just describe what to do — DO it with tools.

Step-by-step workflow (follow it strictly):
1. listFiles and/or searchCode to find relevant files.
2. readFile the file(s) you will change, so you can copy exact text.
3. Make the fix with editFile (preferred) or writeFile.
4. IMMEDIATELY run runTests (or runCommand with the verify command) to check your change.
5. If the output shows a failure, read it, diagnose, and fix with another edit. Do not repeat a failed edit unchanged.
6. When tests pass, call finish with a short summary. Do NOT keep editing after tests pass.

Rules:
- Make minimal, focused changes.
- editFile: oldStr must be copied EXACTLY from the file (including indentation). It must match exactly once.
- Never claim success without running the tests first.
- Do not re-edit a file that already passes its tests.
- Respect safety rejections returned by tools.

Plan:
${plan || '(no explicit plan)'}

Repository map (key symbols, ranked):
${context.repoMap || '(empty repo)'}

Relevant skills:
${context.skills || '(none)'}

${context.experiences ? 'Relevant past experiences:\n' + context.experiences + '\n' : ''}Available tools: listFiles, readFile, writeFile, editFile, deleteFile, searchCode, runCommand, gitCommit, gitStatus, runTests, finish.`;
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
    const knownToolNames = this.registry.list().map((t) => t.name);
    const obsMax = (this.config.observationMaxChars && this.config.observationMaxChars > 0) ? this.config.observationMaxChars : Infinity;

    const truncate = (s) => (s.length <= obsMax ? s : s.slice(0, obsMax) + `\n... (truncated, ${s.length - obsMax} more chars)`);

    for (let step = 0; step < this.config.maxSteps; step++) {
      this.bus.emit('step:start', { step });
      let message;
      try {
        message = await this.modelRouter.complete({
          messages,
          tools: this.registry.schemas(),
          knownToolNames,
        });
      } catch (err) {
        this.bus.emit('error', { step, error: err.message });
        return { ok: false, summary: `model error: ${err.message}`, steps: step, errors };
      }
      messages.push(message);

      if (!message.tool_calls || message.tool_calls.length === 0) {
        // Some small models answer in prose instead of making a tool call. Only
        // treat prose as a final summary once the agent has actually performed
        // work; otherwise nudge toward tool use so the run does not end empty.
        if (actions.length === 0) {
          messages.push({
            role: 'user',
            content: 'Respond by calling a tool (use the provided function-call format). Start by inspecting the repository with listFiles or searchCode, then read and fix the relevant file. Do not just describe what to do.',
          });
          continue;
        }
        summary = message.content || '';
        finished = true;
        break;
      }

      for (const call of message.tool_calls) {
        let args = {};
        let parseError = null;
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch (e) {
          parseError = e.message;
          args = {};
        }
        const name = call.function.name;
        this.bus.emit('tool:call', { name, args });
        let observation;
        if (parseError) {
          observation = `Error: malformed JSON arguments for "${name}": ${parseError}. Arguments were: ${String(call.function.arguments).slice(0, 200)}. Re-issue the tool call with valid JSON arguments.`;
        } else {
          observation = await this.registry.dispatch(name, args);
        }
        this.bus.emit('tool:result', { name, observation });
        actions.push({ name, args });
        // Record actionable failure signals: tool errors, non-zero exits, and
        // explicit FAILED markers. These feed the corrector and memory.
        if (/^Error:|\[exit [1-9]|\bFAILED\b/.test(observation)) errors.push({ tool: name, observation });

        if (name === 'finish' || String(observation).startsWith('__FINISH__')) {
          summary = String(observation).replace('__FINISH__', '') || args.summary || '';
          finished = true;
          messages.push({ role: 'tool', tool_call_id: call.id, content: truncate(String(observation)) });
          break;
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: truncate(String(observation)) });
      }
      // Repetition guard for small models that loop on the same read-only call:
      // if the last two actions are identical, push a nudge to make progress.
      const n = actions.length;
      if (n >= 2) {
        const last = actions[n - 1];
        const prev = actions[n - 2];
        const same = last.name === prev.name && JSON.stringify(last.args) === JSON.stringify(prev.args);
        if (same && last.name !== 'finish') {
          messages.push({
            role: 'user',
            content: `You just called "${last.name}" with the same arguments again. Stop repeating. ${/read|search|list/i.test(last.name) ? 'You have enough context — now make the fix with editFile or writeFile, then runTests.' : 'Try a different approach or call finish if the task is already complete.'}`,
          });
        }
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
