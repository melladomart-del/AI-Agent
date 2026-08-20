'use strict';

const path = require('path');
const { RepoAnalyzer } = require('./repo-analyzer');
const { SkillRegistry } = require('./skill-registry');
const { Memory } = require('./memory');

/**
 * Assembles the prompt context for a task without dumping the entire repo into
 * the model. Combines: a token-budgeted repo map, top-K relevant skills, and
 * retrieved past experiences. This is the heart of "intelligent context".
 */
class ContextSelector {
  constructor(config, memory) {
    this.config = config;
    this.repoAnalyzer = new RepoAnalyzer(config.rootDir);
    // Skills are KLYVIA's bundled capabilities — they live with the app code
    // (appRoot), not in the user's project. Memory and the repo map, however,
    // are per-project (rootDir) so each project keeps its own experiences.
    const skillsDir = config.appRoot ? path.join(config.appRoot, 'skills') : path.join(config.rootDir, 'skills');
    this.skills = new SkillRegistry(skillsDir);
    // Share the orchestrator's Memory instance when provided so that experiences
    // recorded during a run are immediately visible to retrieval. Falling back to
    // a new instance keeps the selector usable standalone.
    this.memory = memory || new Memory(path.join(config.rootDir, config.memoryDir));
  }

  build(task) {
    const { map: repoMap } = this.repoAnalyzer.analyze(this.config.repoMapMaxTokens);
    const skills = this.skills.select(task, this.config.skillTopK);
    const experiences = this.memory.retrieve(task, 3);
    return { repoMap, skills, experiences };
  }

  buildForPlanner(task) {
    const { repoMap, skills, experiences } = this.build(task);
    return {
      task,
      repoMap,
      experiences: experiences.length ? this.memory.summarize(experiences) : '',
      skills,
    };
  }
}

module.exports = { ContextSelector };
