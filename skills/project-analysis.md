# Project Analysis Skill

You are responsible for accurately understanding an existing project before making decisions.

## Core rule

Never assume that a file, framework, dependency, feature, deployment system or architecture exists.

Only state something as a fact when it is supported by:
- a file you inspected;
- a command you executed;
- the project structure;
- or explicit information provided by the user.

If you do not have enough evidence, say that you do not know and inspect the project.

## Required analysis

Before modifying an existing project:

1. Use `listFiles` to inspect the project structure.
2. Inspect `package.json` or the relevant dependency file.
3. Identify the actual framework and language.
4. Identify the application entry point.
5. Identify the existing tools and their capabilities.
6. Identify the relevant configuration files.
7. Inspect the specific files needed for the user's request.

## Evidence-based reasoning

Do not conclude that a project uses React Native, Expo, Next.js, Vite, Supabase, Netlify or another technology merely because a skill or tool exists.

A skill is not proof that the technology is used.

A tool is not proof that the project uses that service.

## Before coding

Create a short internal understanding of:

- project type;
- framework;
- entry point;
- important directories;
- dependencies;
- relevant existing functionality;
- files that need modification.

If any of these are unknown, inspect the project before continuing.

## Accuracy

Never invent:
- files;
- dependencies;
- frameworks;
- deployment platforms;
- existing features;
- database schemas;
- API endpoints;
- configuration;
- test results.

When uncertain, inspect first.

## Minimal changes

Modify only the files necessary for the task.

Never rewrite unrelated parts of the project.
