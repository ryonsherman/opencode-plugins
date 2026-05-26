# Code Review Findings — opencode-plugins

## Project Overview
16 standalone TypeScript plugin files in `plugins/`, loaded by the OpenCode runtime. No build system — a `Makefile` handles installation.

---

## High Severity

### 1. SQL query fails when no path is provided — `codebase-index.ts:420`
When `args.path` is NOT provided, the SELECT clause references `p.root_path` and `p.name` but the JOIN to the `projects` table is empty. This will throw a SQL error: "no such column: p.root_path".

### 2. Git branch format includes literal quotes — `git-context.ts:62`
The git format string uses single quotes (`'%(refname:short)|...'`) passed through `execSync`. The output will include literal `'` characters, causing branch names to appear as `'main` and dates as `3 days ago'`.

### 3. `new Function()` sandbox bypass — `math-calc.ts:92`
The regex sanitization can be bypassed. For example, `constructor.constructor("return process")()` passes the allowed-character check but can access Node/Bun internals. The `constructor` keyword isn't in the forbidden list.

---

## Medium Severity

### 4. Infinite recursion in DB recovery — `session-memory.ts:30`, `codebase-index.ts:171`
`tryRestore()` calls `getDb()` recursively. If both the primary DB and the restored backup are corrupt, this causes a stack overflow.

### 5. FTS5 phrase-only search — `codebase-index.ts:399`
The entire query is wrapped in quotes forcing phrase matching. Multi-word queries like "useState hook" only match if those words appear adjacent, not separately.

---

## Low Severity

### 6. Null safety on `last_insert_rowid()` — `codebase-index.ts:291`
`.get()` can return `null`; accessing `.id` on it would throw.

### 7. Misleading total count in filtered lists — `decision-log.ts:283`, `command-history.ts:220`
"Showing N of M total" always shows the unfiltered total, which is confusing when filters are active.

### 8. Variable shadowing — `project-profile.ts:377`
Local `const db = getDb()` shadows the module-level `let db` in multiple tool functions. Not a bug but hurts readability.

---

## Info

- Inconsistent FTS table creation patterns across plugins (some check `sqlite_master`, others use `IF NOT EXISTS`)
- Uses `Bun.CryptoHasher` as a global without import — works in Bun but not portable to Node
