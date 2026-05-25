# OpenCode Plugins — Usage Instructions

Supplement your own `~/.config/opencode/instructions.md` with the relevant sections below. These plugins add persistent memory and codebase search tools to OpenCode.

---

## Session Memory Plugin

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

Tags always go in the last column.

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

## Installation

1. Copy `.ts` plugin files from `plugins/` to `~/.config/opencode/plugins/`
2. Ensure these plugins are loaded by OpenCode (they auto-load from the `plugins/` directory)
3. Add the relevant sections from this file to your own `~/.config/opencode/instructions.md`
