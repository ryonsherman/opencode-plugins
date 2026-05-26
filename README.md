# opencode-plugins

Plugins for the [OpenCode](https://opencode.ai) CLI agent. Loaded from `~/.config/opencode/plugins/`.

| Plugin | Description |
|--------|-------------|
| [codebase-index](#codebase-indexts) | Local codebase indexing and full-text search over source files |
| [command-history](#command-historyts) | Log and search notable commands with output, exit codes, and directories |
| [decision-log](#decision-logts) | Record and search architectural/design decisions with lifecycle tracking |
| [diff-engine](#diff-enginets) | Compare text using Myers diff algorithm (line-level and character-level) |
| [error-journal](#error-journalts) | Persistent error log with FTS search, resolution tracking, and pattern matching |
| [git-context](#git-contextts) | Git repo state: branch, commits, dirty files, remote status, stashes |
| [hash-encode](#hash-encodets) | Cryptographic hashing (md5/sha1/sha256/sha512), HMAC, and encode/decode (base64/url/hex) |
| [json-toolkit](#json-toolkitts) | Validate, format, minify, and query JSON strings |
| [math-calc](#math-calcts) | Evaluate math expressions and convert between units (bytes, distance, weight, volume, etc.) |
| [notepad](#notepadts) | Freeform project notes with FTS search and auto-generated NOTES.md |
| [project-profile](#project-profilets) | Auto-detect project metadata (languages, framework, scripts) with manual conventions |
| [regex-tester](#regex-testerts) | Test, replace, and explain regular expressions using native RegExp |
| [session-memory](#session-memoryts) | Persistent session memory with FTS5 search, tags, scopes, and cross-session recall |
| [snippet-library](#snippet-libraryts) | Store and recall code snippets by language, description, and tags |
| [task-manager](#task-managerts) | Persistent TODO with SQLite backend and auto-generated TODO.md |
| [time-calc](#time-calcts) | Calendar-aware date math, time diffs, timezone conversion, and duration unit conversion |

## Setup

```bash
git clone git@github.com:ryonsherman/opencode-plugins.git
cd opencode-plugins
```

Install all plugins:

```bash
make install
```

Install or uninstall a specific plugin:

```bash
make install-<name>
make uninstall-<name>
```

Uninstall all plugins:

```bash
make uninstall
```

Show how to configure plugin instructions for OpenCode:

```bash
make instructions
```

Other useful commands:

```bash
make list        # List available plugins
make installed   # Show which plugins are currently installed
```

Restart OpenCode after installing or updating plugins.

See `instructions.md` for detailed usage guidance and the session-context pattern.

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

### `command-history.ts`

Persistent log of notable commands with full-text search. Log builds, migrations, deploys, and debugging commands with their output for later recall.

**Tools:**

| Tool | Description |
|------|-------------|
| `command_log` | Log a command with output, exit code, and working directory |
| `command_search` | FTS search across command history (command text, output, directory) |
| `command_list` | List recent commands, filterable by directory or session |

**Features:**
- SQLite + FTS5 with porter stemming
- Session-aware (tracks which session ran each command)
- Directory prefix filtering
- Output truncation in display (500 chars) to keep results readable
- Same backup/recovery mechanism as session-memory

### `decision-log.ts`

Record and search architectural and design decisions (ADRs). Tracks decision lifecycle (proposed → accepted → deprecated → superseded) with structured fields. Session-scoped by default.

**Tools:**

| Tool | Description |
|------|-------------|
| `decision_log` | Record a new decision with context, rationale, and consequences |
| `decision_get` | Get a specific decision by ID |
| `decision_search` | FTS search across all decision fields (session-scoped by default) |
| `decision_list` | List decisions, filterable by status, tags, or project |
| `decision_update` | Update status, edit fields, or mark as superseded |

**Features:**
- SQLite + FTS5 with porter stemming
- Session-scoped by default (use `all_sessions: true` to search across sessions)
- Decision lifecycle: proposed, accepted, deprecated, superseded
- Supersession chain tracking
- Tag and project filtering
- Auto-logs when user answers preference/architectural questions
- Same backup/recovery mechanism as session-memory

### `diff-engine.ts`

Compare two texts using the Myers diff algorithm — the same algorithm git uses internally. Provides both line-level and character-level comparison.

**Tools:**

| Tool | Description |
|------|-------------|
| `diff_lines` | Compare two strings line-by-line, returns unified diff with context |
| `diff_chars` | Compare two strings character-by-character, best for short strings |

**Features:**
- Pure JS Myers diff — minimal edit distance, no dependencies
- Line-level diff with configurable context lines (default: 3)
- Character-level diff with inline markup (`[-removed-]` / `{+added+}`)
- Stats summary (additions, deletions, unchanged)
- No state, no database

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

### `math-calc.ts`

Evaluate math expressions and convert between units. Uses `Function()` constructor with Math.* exposed, plus a built-in unit conversion table.

**Tools:**

| Tool | Description |
|------|-------------|
| `math_eval` | Evaluate arithmetic, bitwise, and Math.* expressions |
| `unit_convert` | Convert between 12 unit categories (see table below) |

**Features:**
- Expression evaluator supports all Math functions (sqrt, pow, log, sin, cos, PI, E, etc.)
- Input validation rejects non-math code (no assignment, no strings, no imports)
- No state, no dependencies

**Unit conversion reference:**

| Category | Units |
|----------|-------|
| Bytes | b, kb, mb, gb, tb, pb |
| Distance | nm, um, mm, cm, m, km, in, ft, yd, mi, nmi |
| Weight | mg, g, kg, oz, lb, ton, tonne |
| Volume | ml, l, gal, qt, pt, cup, floz, tbsp, tsp |
| Speed | m/s, km/h, mi/h, mph, kn, ft/s |
| Data rate | bps, kbps, mbps, gbps, b/s, kb/s, mb/s, gb/s |
| Area | sqmm, sqcm, sqm, sqkm, sqft, sqyd, sqmi, acre, ha |
| Pressure | pa, kpa, mpa, bar, atm, psi, mmhg, torr |
| Energy | j, kj, cal, kcal, wh, kwh, btu, ev |
| Frequency | hz, khz, mhz, ghz, rpm |
| Angle | deg, rad, grad, turn, arcmin, arcsec |
| Temperature | c, f, k |

Notes: Bytes use binary (1024-based). Data rate distinguishes bits (bps/kbps/mbps/gbps) from bytes (b/s, kb/s, mb/s, gb/s). Ton = US short ton, tonne = metric. For time/duration conversions, use the `time-calc` plugin.

### `notepad.ts`

Freeform project notes backed by SQLite with FTS5 search and auto-generated NOTES.md. Distinct from memory (recall/persistence) and todo (actionable tasks) — for casual jottings, references, and scratch content.

**Tools:**

| Tool | Description |
|------|-------------|
| `note_add` | Add a freeform note with title, content, and tags |
| `note_update` | Update an existing note's title, content, or tags |
| `note_list` | List notes for the current project, filterable by tags |
| `note_search` | FTS search across note titles, content, and tags |
| `note_delete` | Delete a note by ID |

**Features:**
- SQLite + FTS5 with porter stemming
- Auto-generated NOTES.md in project root (only in git repos)
- Backup `.NOTES.md` written before each render
- Project-scoped (uses working directory)
- Markdown content supported in note bodies
- Same backup/recovery mechanism as session-memory

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

### `snippet-library.ts`

Store and recall reusable code snippets by language, description, and tags. Backed by SQLite + FTS5 — no generated files.

**Tools:**

| Tool | Description |
|------|-------------|
| `snippet_save` | Save a code snippet with title, language, description, and tags |
| `snippet_search` | FTS search across snippet titles, code, descriptions, and language |
| `snippet_list` | List snippets, filterable by language and tags |
| `snippet_get` | Get a snippet by ID with full code |
| `snippet_delete` | Delete a snippet by ID |

**Features:**
- SQLite + FTS5 with porter stemming
- Global scope (snippets available across all projects)
- Code preview (3 lines) in list view, full code in get/search
- Language and tag filtering
- Same backup/recovery mechanism as session-memory
- Database: `~/.opencode-memory/snippet-library.db`

### `task-manager.ts`

Persistent project TODO backed by SQLite with auto-generated TODO.md. Tasks persist across sessions and the markdown file is regenerated after every change. Supports syncing manual edits back from the file.

**Tools:**

| Tool | Description |
|------|-------------|
| `todo_add` | Add a task with priority, tags, and optional blocking dependency |
| `todo_update` | Update status, priority, title, or other fields |
| `todo_list` | List tasks filtered by status, priority, tags, or project |
| `todo_sync` | Parse a manually edited TODO.md back into the database |

**Features:**
- SQLite backend with auto-generated TODO.md in project root (only in git repos)
- Backup `.TODO.md` written before each render
- Priority ordering (high, medium, low) and dependency tracking (blocked_by)
- Checkbox format: `- [x] Task title (#id) [tags]` — parseable for sync
- Detects manual file edits via content hash comparison
- New tasks added to TODO.md without an ID are imported on sync
- Project-scoped (uses working directory)
- Same backup/recovery mechanism as session-memory

### `time-calc.ts`

Calendar-aware date/time calculations, timezone conversion, and duration unit conversion. Handles months and leap years correctly.

**Tools:**

| Tool | Description |
|------|-------------|
| `time_calc` | Add/subtract durations from a date (calendar-aware) |
| `time_diff` | Difference between two dates in years/months/days/hours/minutes/seconds |
| `time_now` | Current date/time, optionally in a specific timezone |
| `time_convert` | Convert timestamps between timezones, or convert time duration units |

**Features:**
- Calendar-aware: adding 1 month to Jan 31 = Feb 28 (not blindly +30 days)
- Leap year aware
- Duration parsing: `3y 2mo 5d 4h 30m 10s`
- Timezone support via IANA identifiers (America/New_York, UTC, Asia/Tokyo, etc.)
- Duration unit conversion: ns, us, ms, s, min, hr, day, week
- No state, no dependencies

## Databases

| Database | Path |
|----------|------|
| Memory | `~/.opencode-memory/memories.db` |
| Codebase | `~/.opencode-memory/codebase.db` |
| Command History | `~/.opencode-memory/command-history.db` |
| Decision Log | `~/.opencode-memory/decision-log.db` |
| Error Journal | `~/.opencode-memory/error-journal.db` |
| Notepad | `~/.opencode-memory/notepad.db` |
| Project Profile | `~/.opencode-memory/project-profile.db` |
| Snippet Library | `~/.opencode-memory/snippet-library.db` |
| Task Manager | `~/.opencode-memory/task-manager.db` |
| Backups | `~/.opencode-memory/backups/` (last 5 each) |

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

### Command History — log and recall

```
User: Run the migration

Model: *runs `npx prisma migrate deploy`*
  Migration applied successfully.
  I've logged that command to history.

---

User: What migration commands have I run?

Model: Here are your recent migration commands:

  | # | Command | Exit | Directory | When |
  |---|---------|------|-----------|------|
  | 1 | npx prisma migrate deploy | 0 | ~/project | 2 min ago |
  | 2 | npx prisma migrate dev --name add-users | 0 | ~/project | yesterday |
```

### Decision Log — record choices

```
User: Let's use PostgreSQL instead of MySQL for the new service

Model: Logged that decision.

  **Decision #3**: use-postgresql-over-mysql
  Status: accepted
  Context: Choosing a database for the new service
  Decision: Use PostgreSQL instead of MySQL
  Tags: database, architecture

---

User: What architectural decisions have we made?

Model: You have 3 decisions this session:

  | # | Title | Status | Tags |
  |---|-------|--------|------|
  | 1 | rest-over-graphql | accepted | api |
  | 2 | monorepo-structure | accepted | architecture |
  | 3 | use-postgresql-over-mysql | accepted | database, architecture |
```

### Diff Engine — compare text

```
User: What's different between these two configs?

Model: *runs diff_lines*

  ```diff
  @@ -3,4 +3,5 @@
   {
     "port": 3000,
  -  "host": "localhost",
  +  "host": "0.0.0.0",
  +  "cors": true,
     "debug": false
   }
  ```

  2 additions, 1 deletion.
```

### Error Journal — track and resolve

```
User: I keep getting "ECONNREFUSED 127.0.0.1:5432"

Model: I've logged that error. Let me also check if we've seen it before...

  Found 1 past occurrence:
  **Error #7** (resolved 3 days ago)
  Resolution: PostgreSQL service wasn't running. Fixed with `brew services start postgresql@16`.

  Looks like the same issue — try `brew services start postgresql@16`.
```

### Git Context — repo state

```
User: What's the state of this repo?

Model: *runs git_context*

  **Branch:** feature/auth (2 commits ahead of origin)
  **Dirty files:**
  - M src/auth/login.ts
  - ?? src/auth/oauth.ts

  **Recent commits:**
  - `a3f1b2c` Add OAuth provider config
  - `9e2d4a1` Implement login endpoint

  **Stashes:** (none)
```

### Hash/Encode — compute hashes

```
User: What's the SHA-256 of "hello world"?

Model: b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9

---

User: Base64 encode my API key: sk_live_abc123

Model: c2tfbGl2ZV9hYmMxMjM=
```

### JSON Toolkit — validate and query

```
User: Is this valid JSON? {"name": "test", "items": [1, 2, }

Model: Invalid JSON — unexpected `}` at position 37.
  Expected a value after `[1, 2, `.

---

User: Query users[0].email from {"users": [{"email": "alice@co.com"}]}

Model: alice@co.com
```

### Math/Units — expressions and conversion

```
User: What's 2^16 * 3?

Model: 2**16 * 3 = 196608

---

User: Convert 2.5 GB to MB

Model: 2.5 gb = 2560 mb
```

### Notepad — project notes

```
User: Note down that the staging API endpoint is https://api.staging.example.com

Model: Added note #1: "staging-api-endpoint"

---

User: What notes do we have?

Model:
  | # | Title | Tags | Updated |
  |---|-------|------|---------|
  | 1 | staging-api-endpoint | api, staging | just now |
  | 2 | database-credentials-location | ops | yesterday |
```

### Project Profile — metadata and conventions

```
User: What's this project's setup?

Model: *runs project_profile*

  **Languages:** TypeScript, CSS
  **Framework:** Next.js 14
  **Package manager:** pnpm
  **Scripts:** dev, build, lint, test
  **Entry points:** src/app/layout.tsx
  **Conventions:**
  1. Use server components by default, client only when needed
  2. Colocate tests next to source files (*.test.ts)

---

User: Add a convention: always use named exports

Model: Added convention #3: "always use named exports"
```

### Regex Tester — test patterns

```
User: Test the pattern (\d{4})-(\d{2})-(\d{2}) against "Born on 1990-05-15"

Model:
  Match: "1990-05-15" (index 8-18)
  Group 1: "1990"
  Group 2: "05"
  Group 3: "15"
```

### Snippet Library — save and recall

```
User: Save this as a snippet for retry logic

Model: Saved snippet #5: "exponential-retry-with-jitter" [typescript, async, error-handling]

---

User: Show me that retry snippet

Model:
  **#5 — exponential-retry-with-jitter** (typescript)
  Tags: async, error-handling

  ```typescript
  async function retry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    for (let i = 0; i < maxAttempts; i++) {
      try { return await fn(); }
      catch (e) {
        if (i === maxAttempts - 1) throw e;
        await new Promise(r => setTimeout(r, 2 ** i * 1000 + Math.random() * 500));
      }
    }
    throw new Error("unreachable");
  }
  ```
```

### Task Manager — plan and track

```
User: Add a task to fix the login timeout bug, high priority

Model: Added task #12: "Fix the login timeout bug" [high]

---

User: Show me what's on the todo list

Model:
  ## High
  - [ ] Fix the login timeout bug (#12)

  ## Medium
  - [x] Add input validation to signup form (#9)
  - [ ] Write tests for payment flow (#10)

---

User: Mark #12 done

Model: Done. Task #12 marked completed.
```

### Time Calc — date math and timezones

```
User: What's 90 days from today?

Model: 2026-05-25 + 90d = 2026-08-23 (Sunday)

---

User: What time is it in Tokyo?

Model: 2026-05-26T04:32:15+09:00 (Asia/Tokyo)

---

User: How long between 2026-01-15 and 2026-05-25?

Model: 4 months, 10 days (130 days total, 3120 hours)
```
