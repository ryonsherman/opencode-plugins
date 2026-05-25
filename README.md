# opencode-plugins

Plugins for the [OpenCode](https://opencode.ai) CLI agent. Loaded from `~/.config/opencode/plugins/`.

## Plugins

### `codebase-index.ts`

Local codebase indexing and search. Scans source files, splits them into line-based chunks (50-line windows, 10-line overlap), and builds an FTS5 index.

**Tools:**

| Tool | Description |
|------|-------------|
| `codebase_index` | Scan and index a codebase directory |
| `codebase_search` | Search indexed code using FTS5 with BM25 ranking, returns markdown results |
| `codebase_index_status` | Check index statistics for a project or list all indexed projects |
| `codebase_delete_index` | Delete a project's index from the database |

**Features:**
- Auto-indexes on first search if project isn't indexed yet
- Path filter narrowing (e.g. `src/api` or `.ts`)
- Supports multiple projects independently
- Same backup/recovery mechanism as session-memory

### `error-journal.ts`

Persistent error log with full-text search and resolution tracking. Log errors as they occur, record how they were fixed, and search for past resolutions when similar errors appear.

**Tools:**

| Tool | Description |
|------|-------------|
| `error_log` | Log a new error with context, tags, and optional project |
| `error_resolve` | Add a resolution to a logged error |
| `error_search` | FTS search across error text, context, resolutions, and tags |
| `error_list` | List recent errors with optional filters (project, tags, resolved status) |
| `error_delete` | Delete an error entry by ID |

**Features:**
- FTS5 index across error text, context, resolution, and tags
- Filter by project, tags (AND logic), or resolved/unresolved status
- Same backup/recovery mechanism as session-memory
- Database: `~/.opencode-memory/error-journal.db`

### `git-context.ts`

Git repository state at a glance. Shells out to git commands and returns structured markdown output. No database needed.

**Tools:**

| Tool | Description |
|------|-------------|
| `git_context` | Full snapshot: branch, remote status, dirty files, recent commits, stashes |
| `git_recent` | Last N commits with short hashes and messages |
| `git_dirty` | Working tree status: staged, unstaged, and untracked files |
| `git_branches` | List branches with current highlighted and last commit date |

**Features:**
- No persistent state — pure read-only git queries
- Defaults to current working directory, accepts optional path override
- Structured markdown output for easy model consumption

### `hash-encode.ts`

Cryptographic hashing, HMAC signing, and string encoding/decoding. Pure computation using native crypto and Buffer APIs.

**Tools:**

| Tool | Description |
|------|-------------|
| `hash` | Compute a hash digest (md5, sha1, sha256, sha512) with hex or base64 output |
| `hmac` | Compute an HMAC signature with a secret key |
| `encode` | Encode or decode a string (base64, url, hex) |

**Features:**
- No state, no dependencies — native Node crypto APIs
- Hex and base64 output encodings for hashes
- Bidirectional encode/decode with `decode` flag

### `json-toolkit.ts`

Validate, format, minify, and query JSON strings. Pure computation using native `JSON.parse`/`JSON.stringify`.

**Tools:**

| Tool | Description |
|------|-------------|
| `json_validate` | Check if a string is valid JSON, report error with position |
| `json_format` | Pretty-print with configurable indentation |
| `json_minify` | Compact single-line output |
| `json_query` | Access nested values by dot/bracket path |

**Features:**
- No state, no dependencies — native JSON APIs
- Query supports dot notation and bracket indices (e.g. `users[0].email`)
- Returns clear error messages with parse failure details

### `project-profile.ts`

Auto-detect and persist project metadata so the model has instant context without re-exploring the codebase each session. Supports manual conventions to guide code generation.

**Tools:**

| Tool | Description |
|------|-------------|
| `project_profile` | Show cached profile (auto-scans on first access) |
| `project_scan` | Force re-scan and update (preserves conventions) |
| `project_delete` | Remove a stored profile |
| `project_convention_add` | Add a convention (e.g. style, architecture, naming) |
| `project_convention_remove` | Remove a convention by number |

**Features:**
- Detects: languages, framework, package manager, scripts, entry points, config files, monorepo structure
- Conventions persist across re-scans — manually added rules that guide code generation
- One profile per project path, stored in SQLite
- Auto-backup after every write

### `regex-tester.ts`

Test, replace, and explain regular expressions using native RegExp. Pure computation — no database, no state, no dependencies.

**Tools:**

| Tool | Description |
|------|-------------|
| `regex_test` | Test a pattern against a string — returns all matches with groups and indices |
| `regex_replace` | Test a substitution — shows before/after with group references ($1, $<name>, etc.) |
| `regex_explain` | Break down a pattern into human-readable token descriptions |

**Features:**
- Named groups, lookaheads/lookbehinds, lazy quantifiers all supported
- Defaults to global flag; accepts any standard flags (g, i, m, s, u, v, d)
- Zero-length match protection (no infinite loops)
- Pattern validation with clear error messages

### `session-memory.ts`

Persistent session memory backed by SQLite with FTS5 full-text search (BM25 ranking, English stemming via `porter` tokenizer). Includes a `sessions` table for tracking session titles and activity.

**Tools:**

| Tool | Description |
|------|-------------|
| `memory_store` | Store a memory for the current session, optionally global |
| `memory_retrieve` | Full-text search across memories with tag filtering and scope (session/global/all) |
| `memory_promote` | Promote a single session memory to global scope |
| `memory_promote_session` | Promote all session memories to global scope |
| `memory_list` | Browse memories by scope and tags, returns markdown table |
| `memory_delete` | Delete a specific memory by ID |
| `memory_update` | Update an existing memory's content, tags, and/or title by ID |
| `memory_tags` | List all unique tags across all memories |
| `memory_sessions` | List all sessions that contain memories |
| `session_set_title` | Give a session a human-readable short title (single word or hyphenated) |
| `memory_copy` | Copy a memory from another session to the current session |

**Features:**
- Three scopes: `session`, `global` (visible to all sessions), `all` (union, sorted session-first)
- Tags stored as JSON text array, FTS-indexed, filtered with **AND** logic
- Memory titles auto-generated (25-char max, hyphenated, lowercase) with deduplication within a session
- Session titles are unique; session IDs auto-tracked
- Session-context pattern: a single `session-context` memory holds the full session record
- Auto-backup after every write (keeps last 5), corruption detection with automatic restore

## Databases

| Database | Path |
|----------|------|
| Memory | `~/.opencode-memory/memories.db` |
| Codebase | `~/.opencode-memory/codebase.db` |
| Project Profile | `~/.opencode-memory/project-profile.db` |
| Backups | `~/.opencode-memory/backups/` (last 5 each) |

## Setup

Install all plugins:

```bash
make install
```

Uninstall all plugins:

```bash
make uninstall
```

Install or uninstall a specific plugin:

```bash
make install-<name>
make uninstall-<name>
```

Show how to configure plugin instructions for OpenCode:

```bash
make instructions
```

These plugins only load in **plain (non-OMO) mode**. A toggle script is available at `opencode.sh` in the repo.

See `instructions.md` for detailed usage guidance and the session-context pattern.

## Examples

### Memory — store and retrieve

```
User: Remember that the payment service uses Stripe API v3

Model: Got it, I've stored that.

---

User: What do you remember about Stripe?

  | ID | Title | Session | Summary | Tags |
  |----|-------|---------|---------|------|
  | 42 | payment-service-uses-stripe-api-v3 | current | The payment service uses Stripe API v3 | stripe, payment, api |

Model: I remember that the payment service uses Stripe API v3.
```

### Memory — sessions

```
User: What sessions have we had?

  | ID | Title | Memories | Last Activity |
  |----|-------|----------|---------------|
  | 1 | payment-api-investigation | 5 | 2026-05-25T13:00:00Z |
  | 2 | deploy-fix | 2 | 2026-05-24T09:00:00Z |

Model: You have 2 sessions. Most recent was an investigation into the payment API (5 memories).
```

### Codebase — index and search

```
User: Index my project at /Users/me/my-project

Model: Indexed. 42 files, 320 chunks.

---

User: Show me the payment webhook handler

  Found 3 results:

  ## `src/api/webhook.ts` (my-project)
  **Chunk** (lines 45-60, score: 0.82)
  async function handlePaymentWebhook(req: Request, res: Response) {
    const signature = req.headers['stripe-signature']
    const event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret)
    // ...
  }

  ## `src/api/payment.ts` (my-project)
  **Chunk** (lines 120-130, score: 0.45)
  export async function createPaymentIntent(amount: number, currency: string) {
    const intent = await stripe.paymentIntents.create({ amount, currency })
    return intent
  }

Model: Found 3 results across 2 files — the webhook handler in `src/api/webhook.ts` 
       and the payment intent creation in `src/api/payment.ts`.
```

### Codebase — check index

```
User: Is my project indexed?

Model: Yes, 42 files, 320 chunks. Last indexed 2026-05-25.
```
