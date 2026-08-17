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
  constructor(config) {
    this.config = config;
    this.repoAnalyzer = new RepoAnalyzer(config.rootDir);
    this.skills = new SkillRegistry(path.join(config.rootDir, 'skills'));
    this.memory = new Memory(path.join(config.rootDir, config.memoryDir));
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
