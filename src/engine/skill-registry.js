'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Loads skills from a directory and selects the most relevant ones for a task
 * instead of stuffing all skills into every prompt (the original agent.js
 * loaded all 46 skills on every request).
 *
 * Ranking is a cheap lexical overlap between the task and the skill
 * filename + first lines. No ML, no embeddings — intentional for the
 * low-resource local target.
 */
class SkillRegistry {
  constructor(skillsDir) {
    this.skillsDir = skillsDir;
    this.skills = [];
    this._loaded = false;
  }

  load() {
    if (this._loaded) return this.skills;
    this._loaded = true;
    if (!fs.existsSync(this.skillsDir)) return this.skills;
    for (const f of fs.readdirSync(this.skillsDir)) {
      if (!f.endsWith('.md')) continue;
      const full = path.join(this.skillsDir, f);
      const content = fs.readFileSync(full, 'utf-8');
      this.skills.push({
        name: f.replace(/\.md$/, ''),
        title: (content.split('\n')[0] || f).replace(/^#+\s*/, ''),
        content,
      });
    }
    return this.skills;
  }

  _score(task, skill) {
    const text = (skill.name + ' ' + skill.title).toLowerCase();
    let score = 0;
    for (const word of task.toLowerCase().split(/\W+/)) {
      if (word.length < 3) continue;
      if (text.includes(word)) score += 1;
    }
    return score;
  }

  /**
   * Return the topK skills most relevant to the task, concatenated.
   * Always includes a small core set of always-useful skills.
   */
  select(task, topK = 4) {
    this.load();
    const core = new Set(['planning', 'debugging', 'error-recovery', 'git', 'testing']);
    const scored = this.skills.map((s) => ({ skill: s, score: this._score(task, s) }));
    scored.sort((a, b) => b.score - a.score);
    const chosen = new Map();
    for (const s of scored) {
      if (chosen.size >= topK) break;
      if (s.score > 0) chosen.set(s.skill.name, s.skill.content);
    }
    for (const s of this.skills) {
      if (core.has(s.name)) {
        if (!chosen.has(s.name)) chosen.set(s.name, s.content);
      }
    }
    return Array.from(chosen.values()).join('\n\n---\n\n');
  }

  all() {
    this.load();
    return this.skills;
  }
}

module.exports = { SkillRegistry };
