# Code Review — Final Pass

## Previously-Reported Issues: Status

| # | Issue | Status |
|---|-------|--------|
| 1 | SQL query missing JOIN | **FIXED** |
| 2 | Git branch literal quotes | **FIXED** (works on target platform macOS) |
| 3 | new Function() sandbox | **Partially mitigated** (denylist approach, architecturally still fragile) |
| 4 | Infinite recursion in DB recovery | **FIXED** |
| 5 | FTS5 phrase-only search | **FIXED** |
| 6 | Null safety on last_insert_rowid() | **FIXED** |
| 7 | Misleading total count | **Working** (fragile regex-based SQL transform) |
| 8 | Variable shadowing | **FIXED** |
| 9 | Shell quoting platform-dependent | **FIXED** (works on macOS, not cross-platform) |
| 10 | Regex SQL replacement fragile | **Same as #7** |
| 11 | db! assertion after failed restore | **FIXED** |
| 12 | FTS table/trigger desync | **FIXED** |
| 13 | Empty string path edge case | **FIXED** |
| 14 | Underscore in allowed regex | **Acceptable** (compensated by denylist) |

---

## Remaining Issues

### 1. `new Function()` denylist approach — `math-calc.ts:92`
**Severity: Medium (Security)**
The denylist is extensive (blocks `constructor`, `__proto__`, `prototype`, `Object`, `Reflect`, `Proxy`, `this`, brackets, backticks, quotes) but a denylist can never be fully secure. Practical exploitability is low given current restrictions, but it's architecturally the wrong approach for sandboxing.

### 2. Missing UPDATE trigger for FTS — `command-history.ts:64-82`
**Severity: Medium (Latent)**
Only INSERT and DELETE triggers exist for `commands_ai` and `commands_ad`. No UPDATE trigger (`commands_au`). If a command row is ever updated, the FTS index becomes stale. No code currently updates rows, but this is a gap waiting to bite.

### 3. No corruption detection in read paths — `decision-log.ts`, `command-history.ts`
**Severity: Low**
Unlike `codebase-index.ts` and `session-memory.ts` which wrap operations with corruption detection, these plugins only attempt restore during initial `getDb()`. If corruption occurs after the DB is opened, queries throw unhandled.

### 4. Fragile regex-based COUNT query — `decision-log.ts:284`, `command-history.ts:221`
**Severity: Low**
```
sql.replace(/^SELECT \*/, "SELECT COUNT(*) as count").replace(/ ORDER BY[^)]*$/, "")
```
Works for current simple queries but would break if SQL patterns change (e.g., subqueries, ORDER BY with parenthesized expressions).

---

## Verdict

No critical bugs remain. The codebase is functional and well-structured. The remaining items are architectural concerns (#1), defensive coding gaps (#2, #3), and minor fragility (#4) — none are likely to cause runtime failures under normal usage.
