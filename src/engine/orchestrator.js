'use strict';

const { ModelRouter } = require('../providers/model-router');
const { ToolRegistry } = require('../tools/registry');
const tools = require('../tools/files');
const { ContextSelector } = require('./context-selector');
const { Planner } = require('./planner');
const { Verifier } = require('./verification');
const { Corrector } = require('./corrector');
const { Memory } = require('./memory');
const { Agent } = require('./agent');
const { EventBus } = require('./event-bus');
const { buildConfig } = require('../config');

/**
 * Wires all subsystems together. The single place that knows how the pieces
 * compose; everything else depends on injected collaborators. This is the
 * "kernel" inspired by OpenHands' composable SDK, kept dependency-free.
 */
class Orchestrator {
  constructor(config) {
    this.config = config || buildConfig();
    this.bus = new EventBus();
    this.modelRouter = new ModelRouter(this.config);
    this.registry = new ToolRegistry(this.config);
    this._registerTools();
    this.memory = new Memory(require('path').join(this.config.rootDir, this.config.memoryDir));
    this.contextSelector = new ContextSelector(this.config, this.memory);
    this.planner = new Planner({ modelRouter: this.modelRouter, config: this.config });
    this.verifier = new Verifier({ registry: this.registry, config: this.config });
    this.corrector = new Corrector({
      agent: null, // set below
      verifier: this.verifier,
      config: this.config,
    });
    this.agent = new Agent({
      modelRouter: this.modelRouter,
      registry: this.registry,
      contextSelector: this.contextSelector,
      planner: this.planner,
      verifier: this.verifier,
      corrector: this.corrector,
      memory: this.memory,
      config: this.config,
      eventBus: this.bus,
    });
    this.corrector.agent = this.agent;
  }

  _registerTools() {
    const all = [
      tools.listFiles,
      tools.readFile,
      tools.writeFile,
      tools.editFile,
      tools.deleteFile,
      tools.searchCode,
      tools.runCommand,
      tools.gitCommit,
      tools.gitStatus,
      tools.runTests,
      tools.finish,
    ];
    for (const t of all) this.registry.register(t);
  }

  on(event, handler) {
    return this.bus.on(event, handler);
  }

  async run(task, opts) {
    return this.agent.run(task, opts);
  }
}

module.exports = { Orchestrator };
