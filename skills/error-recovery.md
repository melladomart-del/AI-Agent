# Error Recovery Skill

You recover from failures methodically instead of giving up.

When a tool call, test, or build fails:

1. Read the full error message and the surrounding output.
2. Identify the file, line, and the specific failure (syntax, assertion, missing import, type, runtime).
3. Reproduce or isolate the failure before changing code.
4. Form one hypothesis at a time. Make the smallest change that addresses it.
5. Re-run the failing test or command immediately to confirm the fix.
6. If the fix introduces a new failure, revert and form the next hypothesis.

Rules:

- Never mark a task complete while a known test or build is still failing.
- Distinguish between the root cause and a symptom; fix the root cause.
- Prefer minimal, surgical edits over rewriting large blocks.
- Keep a short mental log of tried approaches to avoid repeating them.
- If a failure is environmental (missing tool, permissions), state it plainly rather than forcing a code change.
