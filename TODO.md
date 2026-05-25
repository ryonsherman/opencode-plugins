# Plugin Ideas

Prioritized by: highest return + easiest to implement → lowest return + hardest to implement.

## Tier 2 — High Return, Moderate Effort

| # | Plugin | Return | Effort | Notes |
|---|--------|--------|--------|-------|
| 7 | ~~**Error journal**~~ | High | Medium | Done. SQLite + FTS5, log errors, record resolutions, search past fixes. |
| 8 | **Task queue** | High | Medium | SQLite, priority ordering, dependency tracking. |
| 9 | **Scratch pad / TODO.md manager** | Medium | Low-Med | File-backed or SQLite, section CRUD. Could manage a project TODO.md directly. |
| 10 | ~~**Math/unit calculator**~~ | Medium | Low-Med | Done. Eval-based expression evaluator + unit conversion table. |

## Tier 4 — Lower Return or High Effort

| # | Plugin | Return | Effort | Notes |
|---|--------|--------|--------|-------|
| 17 | **Dependency tracker** | Medium | High | Multi-language manifest parsing, vuln DB integration. |
| 18 | ~~**Decision log (ADR)**~~ | Low-Med | Medium | Done — `decision-log.ts` (log, search, list, update, get; session-scoped) |
| 19 | **Snippet library** | Low-Med | Medium | Overlaps with memory. Marginal value over tags. |
| 20 | **Link bookmarks** | Low | Low-Med | Overlaps with memory + reference tag. |
| 21 | **Code formatter** | Low-Med | Low | Just shells out to prettier/black. Very thin wrapper. |
| 22 | **Type checker** | Low-Med | Low | Just shells out to tsc/mypy. Very thin wrapper. |
| 23 | **Linter** | Low-Med | Low | Just shells out to eslint/ruff. Very thin wrapper. |
| 24 | **AST parser** | Medium | High | Needs language-specific parsers. Complex without deps. |
| 25 | **Dependency resolver** | Low | High | Semver resolution logic is complex. |

---

## Guiding Principle

A plugin justifies itself when it adds **persistence**, **structured state over time**, or **computation the model genuinely hallucinates**. Thin bash wrappers are not worth it.
