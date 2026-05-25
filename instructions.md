# OpenCode Plugins — Usage Instructions

Supplement your own `~/.config/opencode/instructions.md` with the relevant sections below. These plugins add persistent memory, codebase search, and utility tools to OpenCode. Each section applies only if the corresponding plugin is installed — only use the described tools if they are available in the current session.

---

## Session Memory Plugin

*If `session-memory.ts` is installed.*

Eleven tools for persisting and recalling context across sessions. Backed by SQLite + FTS5 at `~/.opencode-memory/memories.db`.

### Tools

- **`memory_store(content, tags?, title?, global?)`** — Save a memory. `title` auto-generates from content if omitted. `global: true` for cross-session recall.
- **`memory_retrieve(query, tags?, scope?, limit?, summaries?)`** — FTS5 search with English stemming. Tags use AND logic. `summaries: true` returns 200-char previews to save tokens.
- **`memory_promote(id)`** — Promote a session memory to global.
- **`memory_promote_session()`** — Promote all current session memories to global.
- **`memory_list(scope?, tags?)`** — Browse memories by scope or tags.
- **`memory_delete(id)`** — Delete a memory by ID.
- **`memory_update(id, content?, tags?, title?)`** — Edit a memory. Omit fields to keep current values.
- **`memory_tags()`** — List all unique tags.
- **`memory_sessions()`** — List sessions with memory counts. Sessions auto-title from first memory.
- **`session_set_title(id, title)`** — Rename a session (e.g. `"wifi-jammer"`).
- **`memory_copy(id)`** — Copy a memory from another session to the current one.

### Golden rule

**Use the memory plugin aggressively.** When in doubt, store it. When asked anything that references the past, retrieve it. Do NOT rely on conversation context or compaction summaries for information that should persist — the session memory plugin is the designated persistence layer.

### Trigger phrases — store

| User says... | Action |
|---|---|
| "remember X" / "remember that X" / "keep in mind that X" | `memory_store(content: X, ...)` |
| "store X" / "store this: X" / "save this: X" | `memory_store(content: X, ...)` |
| "note that X" / "make a note: X" | `memory_store(content: X, tags: ["notes"])` |
| "remind me that X" / "remind me: I prefer X" | `memory_store(content: X, global: true, tags: ["reminder"])` |
| "remember this for next time" | `memory_store(content: X, global: true)` |
| Implicit: preference, decision, convention, or project requirement | `memory_store(content: X, tags: ["preference"]` / `["decision"]` / `["convention"]`) |

Default scope is session (`global: false`) unless the information is clearly reusable.

### Proactive storage (do NOT wait to be asked)

- Preference, opinion, habit → `tags: ["preference"]`
- Architecture decision, library choice, design pattern → `tags: ["decision"]`
- Project-specific convention, path, config → `tags: ["convention"]`
- Personal context (role, tools, constraints) → `global: true`
- Tricky bug or workaround → `tags: ["bug", "workaround"]`
- End of significant subtask → `tags: ["progress"]`

If unsure whether to store, **store**.

### Trigger phrases — retrieve

**Always search memory before answering from context.** The plugin is the source of truth.

| User says... | Action |
|---|---|
| "recall X" / "do you remember X" / "do you recall X" | `memory_retrieve(query: X, scope: "all")` |
| "what did we do with X" / "what have we done with X" | `memory_retrieve(query: X, scope: "global")` |
| "what do you know about X" / "what do we know about X" | `memory_retrieve(query: X, scope: "all")` |
| "check if we've discussed X" / "have we talked about X" | `memory_retrieve(query: X, scope: "all")` |
| Vague reference | `memory_retrieve(query: <best guess>, scope: "all")` |
| Before contradicting stated preferences | `memory_retrieve(tags: ["preference"], scope: "global")` |

### Display format

**Always display memories and sessions as markdown tables** unless the user explicitly requests a different format (e.g. "show me the raw JSON" or "just list the titles"). This applies to `memory_list`, `memory_retrieve`, `memory_sessions`, and any other tool that returns memory/session data.

**Sessions columns:** ID, Title, Memories, Last Activity, Tags

**Memories columns:** ID, Title, Session (title or "global"), Summary (1-15 word description), Tags

Tags always go in the last column. Timestamps display as `YYYY-MM-DD HH:MM:SS`.

`scope: "all"` sorts session memories first, then globals, both by ID ascending. `scope: "session"` sorts by most recent first.

### Scopes

- **`"session"`** (default): current session only
- **`"global"`**: cross-session (promoted or `global: true`)
- **`"all"`**: union of session + global

### Session context

Maintain a `session-context` memory that holds the full, current session context. Update it (via `memory_update`) whenever significant new context is established — this is the canonical record that survives compaction. Before compaction, ensure it's current. After compaction, retrieve it to restore the session.

### Compaction resilience

- **Before compaction**: ensure the `session-context` memory is up to date via `memory_update(id: ..., tags: ["session-context"])`
- **After compaction**: `memory_retrieve(tags: ["session-context"], scope: "session")` to restore the full session context, then `memory_retrieve(tags: ["preference"], scope: "global")` for cross-session context
- **Never** treat the compaction summary as a faithful record — the session-context memory is the source of truth

---

## Codebase Index Plugin

*If `codebase-index.ts` is installed.*

Four tools for local full-text code search. Backed by SQLite + FTS5 at `~/.opencode-memory/codebase.db`. Files split into 50-line chunks with 10-line overlap.

**Use `codebase_search` transparently for all code-related questions.** Do not wait for the user to ask — when you need to find code, understand a pattern, or answer anything about the codebase, just call `codebase_search`. It auto-indexes if needed.

### Tools

- **`codebase_index(path?)`** — Index a project (auto-detects from working directory). Replaces existing index for that project. Only needed for explicit re-indexing.
- **`codebase_search(query, path?, filter?, limit?)`** — FTS5 search with BM25 ranking. Returns file path, line range, and code snippet. Auto-indexes if project not yet indexed.
- **`codebase_index_status(path?)`** — Check if indexed (file count, chunk count, last indexed time).
- **`codebase_delete_index(path)`** — Remove a stale project index.

### Transparent usage

When you need to understand, find, or reference anything in the codebase, just call `codebase_search` directly — no preamble, no asking permission. It's the default tool for code discovery. Fall back to grep/glob only for exact pattern matching or known target files.

---

## Error Journal Plugin

*If `error-journal.ts` is installed.*

Five tools for logging errors, recording resolutions, and searching past fixes. Backed by SQLite at `~/.opencode-memory/error-journal.db`.

### Tools

- **`error_log(error_text, context?, tags?, project?)`** — Log a new error with the message/stack and what was happening.
- **`error_resolve(id, resolution)`** — Record how an error was fixed.
- **`error_search(query, limit?)`** — FTS search across errors, context, and resolutions. Use when a similar error appears.
- **`error_list(project?, tags?, resolved?, limit?)`** — List recent errors with optional filters.
- **`error_delete(id)`** — Remove an error entry.

### Usage

Log errors as they occur during sessions. When you find the fix, record it with `error_resolve`. When a similar error appears in the future, use `error_search` to check for past resolutions before investigating from scratch.

---

## Git Context Plugin

*If `git-context.ts` is installed.*

Four tools for git repository state. Shells out to git commands with a 5-second timeout.

### Tools

- **`git_context(path?, limit?)`** — Full snapshot: branch, remote status, dirty files, recent commits, stashes.
- **`git_recent(path?, limit?)`** — Last N commits with short hashes and messages.
- **`git_dirty(path?)`** — Working tree status: staged, unstaged, and untracked files.
- **`git_branches(path?)`** — List branches with current highlighted and last commit date.

### Usage

Use `git_context` at session start or whenever you need to understand the current state of a repo. Defaults to the current working directory.

---

## Hash/Encode Plugin

*If `hash-encode.ts` is installed.*

Three tools for cryptographic hashing, HMAC signing, and string encoding/decoding.

### Tools

- **`hash(input, algorithm?, encoding?)`** — Compute a hash digest. Algorithms: md5, sha1, sha256 (default), sha512. Output: hex (default), base64.
- **`hmac(input, key, algorithm?, encoding?)`** — Compute an HMAC signature with a secret key.
- **`encode(input, format?, decode?)`** — Encode or decode a string. Formats: base64 (default), url, hex. Set `decode: true` to reverse.

### Usage

Use these tools whenever the user asks to hash, encode, or decode something. The model cannot compute hashes correctly — always use the tool.

---

## JSON Toolkit Plugin

*If `json-toolkit.ts` is installed.*

Four tools for validating, formatting, minifying, and querying JSON strings.

### Tools

- **`json_validate(input)`** — Check if a string is valid JSON. Returns success or error with position.
- **`json_format(input, indent?)`** — Pretty-print JSON with configurable indentation (default: 2 spaces).
- **`json_minify(input)`** — Compact JSON to a single line with no whitespace.
- **`json_query(input, path)`** — Access a nested value using dot/bracket notation (e.g. `users[0].email`).

### Usage

Use these tools when working with JSON data — validating API responses, formatting config files, or extracting values from large JSON blobs. The query tool avoids the need to parse and navigate JSON mentally.

---

## Math/Calc Plugin

*If `math-calc.ts` is installed.*

Two tools for evaluating math expressions and converting units.

### Tools

- **`math_eval(expression)`** — Evaluate arithmetic, bitwise, and Math.* expressions (e.g. `sqrt(144) + 2**10`, `1024 * 1024 * 3.5`).
- **`unit_convert(value, from, to)`** — Convert between units: bytes (b–pb), time (ns–year), distance (nm–nmi), weight (mg–tonne), volume (ml–tsp), speed (m/s–kn), data rate (bps–gb/s), area (sqmm–ha), pressure (pa–torr), energy (j–ev), frequency (hz–rpm), angle (deg–arcsec), temperature (c, f, k).

### Usage

Use `math_eval` for any non-trivial arithmetic — the model hallucinates on large numbers, floating point, and multi-step calculations. Use `unit_convert` for byte sizes, time durations, distances, etc.

---

## Project Profile Plugin

*If `project-profile.ts` is installed.*

Five tools for auto-detecting project metadata and managing conventions. Backed by SQLite at `~/.opencode-memory/project-profile.db`.

### Tools

- **`project_profile(path?)`** — Show the stored profile. Auto-scans on first access if no profile exists.
- **`project_scan(path?)`** — Force re-scan and update (preserves conventions).
- **`project_delete(path?)`** — Remove a stored profile.
- **`project_convention_add(convention, path?)`** — Add a convention to guide code generation (e.g. "Use single quotes and 2-space indent").
- **`project_convention_remove(index, path?)`** — Remove a convention by its number (1-based).

### Usage

Use `project_profile` at session start to get instant context about the project. Conventions are manually added rules that guide how code should be written — follow them when generating code for that project. If the project structure has changed significantly (new framework, language, or major restructure), use `project_scan` to refresh the profile.

---

## Regex Tester Plugin

*If `regex-tester.ts` is installed.*

Three tools for testing, replacing, and explaining regular expressions.

### Tools

- **`regex_test(pattern, input, flags?)`** — Test a pattern against a string. Returns all matches with groups and indices. Defaults to global flag.
- **`regex_replace(pattern, input, replacement, flags?)`** — Test a substitution. Shows before/after with group references ($1, $<name>, etc.).
- **`regex_explain(pattern, flags?)`** — Break down a pattern into human-readable token descriptions.

### Usage

Use `regex_test` to verify patterns before using them in code. Use `regex_explain` when the user asks what a regex does or when you need to reason about a complex pattern.

---

## Time Calc Plugin

*If `time-calc.ts` is installed.*

Four tools for calendar-aware date math, time differences, timezone conversion, and duration unit conversion.

### Tools

- **`time_calc(date?, duration, subtract?)`** — Add or subtract a duration from a date. Duration format: `3y 2mo 5d 4h 30m 10s`. Calendar-aware (handles months/leap years correctly).
- **`time_diff(from, to)`** — Difference between two dates in years, months, days, hours, minutes, seconds, plus totals.
- **`time_now(timezone?)`** — Current date/time, optionally in a specific IANA timezone.
- **`time_convert(value, from, to)`** — Convert a timestamp between timezones, or convert duration units (ns, us, ms, s, min, hr, day, week).

### Usage

Use these tools for any date/time calculation. The model hallucinates on calendar math (especially month boundaries and leap years). Use `time_diff` for age/deadline calculations. Use `time_convert` for timezone questions or simple duration unit conversions.

---

## Installation

1. Run `make install` (or `make install-<name>`) from the repo to copy plugins to `~/.config/opencode/plugins/`
2. Add the relevant sections from this file to your own `~/.config/opencode/instructions.md`
3. Restart OpenCode to load the plugins
