# Plugin Ideas

Prioritized by: highest return + easiest to implement → lowest return + hardest to implement.

## Remaining

| # | Plugin | Return | Effort | Notes |
|---|--------|--------|--------|-------|
| 8 | **Task queue** | High | Medium | SQLite, priority ordering, dependency tracking. Overlaps with opencode's TodoWrite. |
| 9 | **Scratch pad / TODO.md manager** | Medium | Low-Med | File-backed or SQLite, section CRUD. Overlaps with TodoWrite. |
| 24 | **AST parser** | Medium | High | Needs language-specific parsers. Complex without deps. |
| 17 | **Dependency tracker** | Medium | High | Multi-language manifest parsing, vuln DB integration. |
| 25 | **Dependency resolver** | Low | High | Semver resolution logic is complex. |
| 19 | **Snippet library** | Low-Med | Medium | Overlaps with memory. Marginal value over tags. |
| 20 | **Link bookmarks** | Low | Low-Med | Overlaps with memory + reference tag. |
| 21 | **Code formatter** | Low-Med | Low | Thin shell wrapper (prettier/black). |
| 22 | **Type checker** | Low-Med | Low | Thin shell wrapper (tsc/mypy). |
| 23 | **Linter** | Low-Med | Low | Thin shell wrapper (eslint/ruff). |

---

## Guiding Principle

A plugin justifies itself when it adds **persistence**, **structured state over time**, or **computation the model genuinely hallucinates**. Thin bash wrappers are not worth it.
