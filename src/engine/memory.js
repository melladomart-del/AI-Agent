'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Persistent operational memory + experience retrieval.
 *
 * Each completed task is stored as an experience record:
 *   { task, plan, actions, errors, corrections, result, score, timestamp }
 * When a new similar task appears, the most relevant past experiences are
 * retrieved (cheap lexical similarity) and injected into the planner prompt.
 *
 * This is NOT model training. It is durable JSON storage + retrieval.
 * Inspired by the OpenHands conversation-persistence + our own prior design.
 */
class Memory {
  constructor(dir) {
    this.dir = dir || '.agent-memory';
    this.experiencesPath = path.join(this.dir, 'experiences.json');
    this._experiences = null;
  }

  _ensure() {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.experiencesPath)) {
      fs.writeFileSync(this.experiencesPath, '[]', 'utf-8');
    }
  }

  load() {
    if (this._experiences !== null) return this._experiences;
    this._ensure();
    try {
      this._experiences = JSON.parse(fs.readFileSync(this.experiencesPath, 'utf-8'));
    } catch {
      this._experiences = [];
    }
    return this._experiences;
  }

  save(experiences) {
    this._ensure();
    fs.writeFileSync(this.experiencesPath, JSON.stringify(experiences, null, 2), 'utf-8');
    this._experiences = experiences;
  }

  record(experience) {
    const all = this.load();
    all.push({ ...experience, timestamp: Date.now() });
    this.save(all);
    return experience;
  }

  /**
   * Retrieve the topK experiences most similar to the task by lexical overlap.
   * Higher-score (successful) experiences are preferred.
   */
  retrieve(task, topK = 3) {
    const all = this.load();
    if (all.length === 0) return [];
    const words = new Set(task.toLowerCase().split(/\W+/).filter((w) => w.length >= 3));
    const scored = all.map((e) => {
      let overlap = 0;
      const eWords = (e.task + ' ' + (e.tags || []).join(' ')).toLowerCase().split(/\W+/);
      for (const w of eWords) {
        if (words.has(w)) overlap += 1;
      }
      const success = e.score && e.score > 0 ? 1 : 0.1;
      return { e, score: overlap * success };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score > 0).slice(0, topK).map((s) => s.e);
  }

  summarize(experiences) {
    return experiences
      .map((e) => `- Task: ${e.task}\n  Result: ${e.result || 'unknown'} (score: ${e.score ?? '?'})\n  ${e.errors?.length ? 'Errors: ' + e.errors.join(' | ') : ''}`)
      .join('\n');
  }
}

module.exports = { Memory };
