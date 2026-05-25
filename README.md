# opencode-plugins

Plugins for the [OpenCode](https://opencode.ai) CLI agent. Loaded from `~/.config/opencode/plugins/`.

## Plugins

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

## Databases

| Database | Path |
|----------|------|
| Memory | `~/.opencode-memory/memories.db` |
| Codebase | `~/.opencode-memory/codebase.db` |
| Backups | `~/.opencode-memory/backups/` (last 5 each) |

## Setup

Copy plugins to the OpenCode config directory:

```bash
cp plugins/*.ts ~/.config/opencode/plugins/
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
  | abc-123 | payment-api-investigation | 5 | 2026-05-25T13:00:00Z |
  | def-456 | deploy-fix | 2 | 2026-05-24T09:00:00Z |

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

Model: Found 3 results across 2 files — the webhook handler in `src/api/webhook.ts` and the payment intent creation in `src/api/payment.ts`.
```

### Codebase — check index

```
User: Is my project indexed?

Model: Yes, 42 files, 320 chunks. Last indexed 2026-05-25.
```
