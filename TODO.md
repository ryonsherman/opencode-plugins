# Plugin Ideas

Prioritized by: highest return + easiest to implement → lowest return + hardest to implement.

## Tier 1 — High Return, Easy to Build

| # | Plugin | Return | Effort | Notes |
|---|--------|--------|--------|-------|
| 1 | ~~**Git context**~~ | High | Low | Done. Shells out to git commands, formats output. No DB needed. |
| 2 | ~~**Regex tester**~~ | High | Low | Done. Native RegExp — test, replace, explain. No deps, no state. |
| 3 | ~~**Hash/encode/decode**~~ | Medium | Low | Done. Native crypto/Buffer APIs — hash, HMAC, base64/url/hex encode/decode. |
| 4 | **Date/time calculator** | Medium | Low | Native Date APIs. No deps, no state. |
| 5 | ~~**Project profile**~~ | High | Low-Med | Done. Auto-detect languages, framework, scripts, config. Manual conventions. SQLite-backed. |
| 6 | ~~**JSON toolkit**~~ | High | Low | Done. Validate, format, minify, query. Native JSON APIs, no state. |

## Tier 2 — High Return, Moderate Effort

| # | Plugin | Return | Effort | Notes |
|---|--------|--------|--------|-------|
| 7 | **Error journal** | High | Medium | SQLite + FTS, proactive matching logic, structured schema. |
| 8 | **Task queue** | High | Medium | SQLite, priority ordering, dependency tracking. |
| 9 | **Scratch pad / TODO.md manager** | Medium | Low-Med | File-backed or SQLite, section CRUD. Could manage a project TODO.md directly. |
| 10 | **Math/unit calculator** | Medium | Low-Med | Expression parsing is the tricky part. Could use Bun eval. |
| 11 | **Port/process checker** | Medium | Low | Shell out to lsof/ps. But thin wrapper territory. |

## Tier 3 — Medium Return, Moderate Effort

| # | Plugin | Return | Effort | Notes |
|---|--------|--------|--------|-------|
| 12 | **Command history** | Medium | Medium | SQLite + FTS, needs to hook into bash execution somehow. |
| 13 | **Diff reviewer** | Medium | Medium | Git diff parsing, rule engine for flags, commit message gen. |
| 14 | **Diff engine** | Medium | Low-Med | String diff algorithm in pure JS. Useful but niche. |
| 15 | **Environment snapshot** | Medium | Medium | Many shell commands, JSON storage, diff logic. |
| 16 | **CSV/table processor** | Medium | Medium | CSV parsing + query engine. Non-trivial without deps. |

## Tier 4 — Lower Return or High Effort

| # | Plugin | Return | Effort | Notes |
|---|--------|--------|--------|-------|
| 17 | **Dependency tracker** | Medium | High | Multi-language manifest parsing, vuln DB integration. |
| 18 | **Decision log (ADR)** | Low-Med | Medium | Overlaps heavily with memory + decision tag. |
| 19 | **Snippet library** | Low-Med | Medium | Overlaps with memory. Marginal value over tags. |
| 20 | **Link bookmarks** | Low | Low-Med | Overlaps with memory + reference tag. |
| 21 | **Code formatter** | Low-Med | Low | Just shells out to prettier/black. Very thin wrapper. |
| 22 | **Type checker** | Low-Med | Low | Just shells out to tsc/mypy. Very thin wrapper. |
| 23 | **Linter** | Low-Med | Low | Just shells out to eslint/ruff. Very thin wrapper. |
| 24 | **AST parser** | Medium | High | Needs language-specific parsers. Complex without deps. |
| 25 | **Dependency resolver** | Low | High | Semver resolution logic is complex. |

## Tier 5 — Probably Won't Implement

| # | Plugin | Return | Effort | Notes |
|---|--------|--------|--------|-------|
| 26 | **Session timer** | Low | Low | Easy but weak value. |
| 27 | **Clipboard bridge** | Low | Low | Overlaps with memory. |

---

## Guiding Principle

A plugin justifies itself when it adds **persistence**, **structured state over time**, or **computation the model genuinely hallucinates**. Thin bash wrappers are not worth it.
