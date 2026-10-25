# CLAUDE.md — Wasfa AI

Project contract: `docs/AGENT.md` (read the sections a task touches, not the whole file every time).

## Model orchestration (cost-first, precision-always)

The main session (the strongest model, e.g. Opus) is the **architect, supervisor and reviewer**. It thinks; cheaper models type.
Goal: spend main-session tokens only on judgment. Everything mechanical goes down the ladder.

### The ladder

| Who | Agent | Use for |
|---|---|---|
| Main session (Opus) | — | Architecture and design decisions, security/money/auth/credit logic design, ambiguous requirements, writing briefs, reviewing results, and anything a lower tier failed at twice. |
| Sonnet | `builder` | Non-trivial implementation from a brief: new modules, multi-file features, tricky refactors, writing tests for real logic, debugging with a known hypothesis. |
| Haiku | `runner` | Mechanical work with no design choices: apply exact edits, create files from given content/templates, renames, running commands (typecheck/lint/test/build/docker/git status), formatting, boilerplate that copies an existing pattern. |
| Haiku | `scout` | Read-only: find files/symbols/usages, summarize how something works, check docs, web search. Returns compact findings, never file dumps. |

### Routing rules
1. **Default down.** Before acting, ask: "Does this step need judgment?" No → `runner`/`scout`. Some, but the design is settled → `builder`. Yes → do it in the main session.
2. **Don't delegate the trivial.** A subagent starts cold. If the brief would be longer than the change (a 1–5 line edit in a file already in context), just do it directly.
3. **Explore cheap.** Broad searches and "how does X work" go to `scout`, not to main-session Read/Grep sweeps.
4. **Parallelize.** Independent briefs go out in one message (several `runner`/`scout`/`builder` calls at once).
5. **Escalate, don't retry blindly.** `runner` fails or reports ambiguity → fix the brief once or move it to `builder`. `builder` fails twice → main session does it.
6. **Never delegate the decision itself:** threat-model calls, money/credit math design, auth/permission design, schema design, public API shape. Delegate their implementation once decided.

### Brief format (mandatory for `builder`; scale down for `runner`)
The subagent must be able to build exactly what the main session would, without guessing. Every brief contains:
- **Goal** — one sentence, the outcome.
- **Context** — exact paths (with line ranges) to read; existing helpers/patterns to copy (`docs/REUSE-INDEX.md` entries); nothing it must rediscover.
- **Decisions already made** — names, signatures, types, schema, error codes, file locations, library choices. State them; don't let the subagent choose.
- **Steps** — numbered, concrete.
- **Constraints** — the `docs/AGENT.md` rules that apply (e.g. §5.2 zod at boundary, §5.4 repo-only queries + scoped, §5.5 integer minor units, §5.10 logical CSS/i18n). Only the relevant ones.
- **Do not** — files/areas out of scope, things not to "improve".
- **Verify** — exact commands to run (e.g. `pnpm --filter @wasfa/api typecheck`, a specific test file).
- **Return** — what to report back (see the agents' report format).

### Review (main session)
- Review with `git diff` / `git diff --stat` and the agent's report — don't re-read whole files the brief already specified.
- Check against the brief and the Definition of Done (`docs/AGENT.md` §8). Small fixes: fix directly. Larger: send a corrective brief to the same tier.
- Commits are made by the main session after review (or by `runner` with an exact message).
