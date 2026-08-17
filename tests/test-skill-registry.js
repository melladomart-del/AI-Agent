'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { SkillRegistry } = require('../src/engine/skill-registry');

function setupSkills() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skills-'));
  fs.writeFileSync(path.join(dir, 'react.md'), '# React Skill\nBuild React apps.\n');
  fs.writeFileSync(path.join(dir, 'database-design.md'), '# Database Design\nDesign SQL.\n');
  fs.writeFileSync(path.join(dir, 'git.md'), '# Git Skill\nUse git.\n');
  fs.writeFileSync(path.join(dir, 'planning.md'), '# Planning Skill\nPlan first.\n');
  return dir;
}

test('SkillRegistry loads all skills', () => {
  const reg = new SkillRegistry(setupSkills());
  assert.equal(reg.all().length, 4);
});

test('select returns only relevant skills, not all', () => {
  const reg = new SkillRegistry(setupSkills());
  const out = reg.select('build a React component', 2);
  assert.match(out, /React/);
  // database should not be selected for a react task
  assert.doesNotMatch(out, /Database Design/);
});

test('select always includes core skills', () => {
  const reg = new SkillRegistry(setupSkills());
  const out = reg.select('build a React component', 1);
  assert.match(out, /Planning/); // planning is core
  assert.match(out, /Git/); // git is core
});

test('select with empty task still returns core skills', () => {
  const reg = new SkillRegistry(setupSkills());
  const out = reg.select('', 2);
  assert.match(out, /Planning/);
});
