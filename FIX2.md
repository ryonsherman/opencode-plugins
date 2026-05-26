# Code Review Follow-up — opencode-plugins

## Status of Original Issues

| # | Issue | Status |
|---|-------|--------|
| 1 | SQL query missing JOIN | **FIXED** |
| 2 | Git branch literal quotes | **FIXED** (in 28fe3d6) |
| 3 | new Function() sandbox bypass | **PARTIALLY FIXED** (`constructor` blocked, but approach still fragile) |
| 4 | Infinite recursion in DB recovery | **FIXED** |
| 5 | FTS5 phrase-only search | **FIXED** |
| 6 | Null safety on last_insert_rowid() | **FIXED** |
| 7 | Misleading total count in filtered lists | **NOT FIXED** |
| 8 | Variable shadowing | **NOT FIXED** |

---

## Unfixed Original Issues

### 3. `new Function()` sandbox — `math-calc.ts:92`
The `constructor` keyword is now blocked in the forbidden regex, but `new Function()` remains the execution mechanism. Creative bypasses may still be possible (e.g., via `Object.getPrototypeOf`, `Reflect`, or other unblocked globals). The approach is inherently fragile.

### 7. Misleading total count — `decision-log.ts:283`, `command-history.ts:220`
The count now reflects filtered results, but the label still says "total decisions" / "total commands" which could confuse users into thinking it's the unfiltered total.

### 8. Variable shadowing — `project-profile.ts:377, 405, 429, 447, 467`
`const db = getDb()` still shadows the module-level `let db` in every tool handler. Not a runtime bug but a maintainability concern.

---

## New Issues Found

### 1. Shell quoting is platform-dependent — `git-context.ts:62`
The `--format='...'` uses shell single quotes that work on Unix but not on Windows cmd.exe. Cross-platform usage would fail. (Note: may also be resolved in 28fe3d6 — verify locally.)

### 2. Regex replacement fragile for complex SQL — `decision-log.ts:283`
`.replace("SELECT *", "SELECT COUNT(*) as count").replace(/ ORDER BY.*/, "")` will break if a WHERE clause ever contains a subquery with `ORDER BY`.

### 3. `db!` assertion after failed restore — `session-memory.ts:30-33`
If `tryRestore()` returns `true` but the recursive `getDb()` call inside it also fails (reentrancy guard now prevents infinite loop but returns `false`), `db` remains null and `db!` is a lie. Low probability but possible crash.

### 4. FTS table/trigger desync risk — `notepad.ts:50-56`
Uses `CREATE VIRTUAL TABLE IF NOT EXISTS` for FTS without checking triggers via `sqlite_master`. If the FTS table exists but triggers were dropped externally, content sync silently breaks.

### 5. Same FTS table/trigger desync — `snippet-library.ts:50-56`
Same pattern issue as notepad.ts.

### 6. Empty string path edge case — `codebase-index.ts:388`
If `ctx.directory` is undefined, `targetPath` becomes `""`. The `AND p.root_path = ?` clause would match against an empty string if `args.path` was provided but empty. Unlikely in practice.

### 7. Allowed character regex permits underscore — `math-calc.ts:82`
The `allowed` regex permits `_`, enabling property access like `Math.__proto__` — though this specific case is blocked by the forbidden list. Overly permissive but not currently exploitable.

### 8. Module-level `db` can be stale after restore — `project-profile.ts`
The local `const db = getDb()` pattern means if `getDb()` is called, restores a backup, and reassigns the module-level `db`, any previously-captured local reference is stale. Not currently an issue since each handler gets a fresh reference, but worth noting.
