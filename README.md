# opencode-plugins

Plugins for the [OpenCode](https://opencode.ai) CLI agent.

## Plugins

### `session-memory.ts`

Persistent session memory plugin backed by SQLite with FTS5 full-text search. Stores and retrieves context across conversations.

- **`memory_store`** — Store a memory for the current session (or globally)
- **`memory_retrieve`** — Full-text search across memories with FTS5 (BM25 ranking, English stemming via `porter` tokenizer)
- **`memory_promote`** — Promote a single session memory to global scope
- **`memory_promote_session`** — Promote all session memories to global scope
- **`memory_list`** — Browse memories by scope and tags

**Database:** `~/.opencode-memory/memories.db` with auto-backups on every write (last 5 kept). Corruption detection with automatic restore from latest backup.

### `codebase-index.ts`

Local codebase indexing and search plugin. Scans source files, splits them into line-based chunks (50-line windows, 10-line overlap), and builds an FTS5 index for fast code search.

- **`codebase_index`** — Scan and index a codebase directory
- **`codebase_search`** — Search indexed code using FTS5 with BM25 ranking
- **`codebase_index_status`** — Check index statistics for a project

**Database:** `~/.opencode-memory/codebase.db` with same backup/recovery mechanism.

**Supported extensions:** `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.java`, `.go`, `.rs`, `.c`, `.cpp`, `.rb`, `.php`, `.css`, `.html`, `.json`, `.yaml`, `.md`, `.sql`, `.sh`, `.tf`, `.hcl` and more.

**Skipped:** `node_modules/`, `.git/`, `dist/`, `build/`, `vendor/`, and dot-directories.

## Usage

OpenCode automatically loads plugins from `~/.config/opencode/plugins/`. Copy the plugin files there:

```bash
cp plugins/*.ts ~/.config/opencode/plugins/
```

No additional configuration needed — OpenCode discovers plugins via glob in the `plugins/` directory.
