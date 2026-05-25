# User Context

## Identity

- Name: Ryon Sherman
- Email: rsherman@madison-reed.com
- GitHub: rsherman-madison-reed
- Organization: Madison Reed

## Environment

- Machine: Apple Silicon (arm64)
- OS: macOS 26.2 (Tahoe)
- Shell: zsh
- Node: v18.20.8
- npm: 10.8.2

## CLI Tools

- **gh** (v2.89.0): GitHub CLI is available and authenticated. Use `gh` for GitHub operations (PRs, issues, repos, API calls) instead of the web UI or raw API calls.
- **aws** (v2.34.25): AWS CLI is available with multiple profiles. Use `aws` for AWS operations (S3, Lambda, CloudFront, etc.) instead of suggesting console actions. Preferred profile: `default` (aliased as `madisonreed-legacy`). Always use the default profile unless a different one is explicitly specified.
- **mdpdf**: Use `mdpdf` to convert Markdown files to PDF.
- **brew**: Homebrew is available. Use `brew` to install tools and packages on the machine.
- **screencapture**: Use `screencapture` to take screenshots via CLI. When a screenshot is needed, ask for confirmation first, then provide a 3-second delay (`sleep 3 && screencapture ...`) so the user can switch to the target window.


## MCP Integrations

- **Vanta**: Compliance and security platform accessible via MCP. Use Vanta tools to query tests, controls, frameworks, vendors, vulnerabilities, policies, and risk scenarios. Prefer Vanta MCP over manual lookups for any compliance-related questions. Vanta person ID: `650db230d1f6ad2881d6e447`.
- **AWS**: AWS MCP Server provides direct API access to all 300+ AWS services, documentation search, and sandboxed script execution. Use AWS MCP tools for AWS operations alongside the AWS CLI. Default region: us-east-1.
- **GitHub**: GitHub MCP Server provides access to repos, issues, PRs, and workflows. Use GitHub MCP tools for GitHub operations alongside the `gh` CLI.
- **Atlassian**: Atlassian MCP Server provides access to Jira, Confluence, and Compass at madison-reed.atlassian.net. Use Atlassian MCP tools for searching Confluence wiki, managing Jira issues, and other Atlassian operations.

## Codebase Index Plugin

Three tools for local full-text search across a codebase. Indexes source files into FTS5 chunks for fast, ranked code search.

**Use `codebase_search` transparently for all code-related questions.** Do not wait for the user to ask — when you need to find code, understand a pattern, or answer anything about the codebase, just call `codebase_search`. It auto-indexes if needed.

### Tools

- **`codebase_index(path?)`** — Scan and index a codebase. Splits files into 50-line overlapping chunks and builds an FTS5 index. Re-runs replace the existing index. Only needed for explicit re-indexing.
- **`codebase_search(query, path?, filter?, limit?)`** — Full-text search over indexed code. Returns ranked results with file path, line range, and code snippet. Supports optional path/project filtering. Auto-indexes if project isn't indexed yet.
- **`codebase_index_status(path?)`** — Check if a project is indexed (file count, chunk count, last indexed time).
- **`codebase_delete_index(path)`** — Delete a project's index and all its chunks.

### Transparent usage

When you need to understand, find, or reference anything in the codebase, just call `codebase_search` directly — no preamble, no asking permission. It's the default tool for code discovery. Fall back to grep/glob only when you need exact pattern matching or already know the target file.

**Exception:** Do NOT use `codebase_index` or `codebase_search` on anything under `/Users/ryon.sherman/Development/madisonreed/`. This is the work directory — use standard search tools (grep/glob/Task) there instead.

## Session Memory Plugin

Eleven custom tools are available for persisting and recalling context across sessions:

### Tools

- **`memory_store(content, tags?, title?, global?)`** — Save a memory. Use `title` for a short label (single word or hyphenated). Use `global: true` for cross-session recall.
- **`memory_retrieve(query, tags?, scope?, limit?, summaries?)`** — Search memories via FTS5 full-text search (English stemming). Tags use AND logic (all specified tags must match). Use `summaries: true` for broad searches to save tokens — returns first 200 chars instead of full content. Follow up with a narrower query to get full details.
- **`memory_promote(id)`** — Promote a single session memory to global.
- **`memory_promote_session()`** — Promote all current session memories to global.
- **`memory_list(scope?, tags?)`** — List memories by scope or tags. Tags use AND logic.
- **`memory_delete(id)`** — Delete a specific memory by ID.
- **`memory_update(id, content?, tags?, title?)`** — Update a memory's content, tags, and/or title. Omit fields to keep current values. Pass `title: null` to clear a title.
- **`memory_tags()`** — List all unique tags across all memories.
- **`memory_sessions()`** — List all sessions with memory counts and optional titles.
- **`session_set_title(id, title)`** — Give a session a short name (e.g. `session_set_title(id: "ses_...", title: "wifi-jammer")`).
- **`memory_copy(id)`** — Copy a memory from another session to the current session.

### Golden rule

**Use the memory plugin aggressively.** When in doubt, store it. When asked anything that references the past, retrieve it. Do NOT rely on conversation context or compaction summaries for information that should persist — the session memory plugin is the designated persistence layer. Offload everything worth remembering to `memory_store` so it survives compaction and carries across sessions.

**Exception:** Do NOT use the session memory plugin to store work-related context from `/Users/ryon.sherman/Development/madisonreed/`. That directory has its own tooling (Indexify, Resmem). The memory plugin is for personal projects only.

### Trigger phrases — store

Any of these patterns mean the user wants a memory stored:

| User says... | Action |
|---|---|
| "remember X" / "remember that X" / "keep in mind that X" | `memory_store(content: X, ...)` |
| "store X" / "store this: X" / "save this: X" | `memory_store(content: X, ...)` |
| "note that X" / "make a note: X" | `memory_store(content: X, tags: ["notes"])` |
| "remind me that X" / "remind me: I prefer X" | `memory_store(content: X, global: true, tags: ["reminder"])` |
| "remember this for next time" / "save this cross-session" | `memory_store(content: X, global: true)` |
| Implicit: user mentions a personal preference, decision, convention, or project requirement | `memory_store(content: X, tags: ["preference"]` / `["decision"]` / `["convention"]`) |

When the user doesn't specify a scope, prefer `global: false` (session-only) unless the information is clearly reusable across sessions.

### Proactive storage (do NOT wait to be asked)

Store memories automatically without waiting for an explicit "remember" command:

- After the user states a preference, opinion, or habit → `memory_store` with `tags: ["preference"]`
- After agreeing on an architecture decision, library choice, or design pattern → `memory_store` with `tags: ["decision"]`
- After learning a project-specific convention, path, or config detail → `memory_store` with `tags: ["convention"]`
- After the user shares personal context (job role, tools they use, constraints) → `memory_store` with `global: true`
- After fixing a tricky bug or establishing a workaround → `memory_store` with `tags: ["bug", "workaround"]`
- At the end of a significant subtask, summarize what was accomplished → `memory_store` with `tags: ["progress"]`

If unsure whether to store, **store**. Cost is negligible and recall is free.

### Trigger phrases — retrieve

**Always search memory before answering from context.** When the user asks anything that references past work, preferences, or decisions, call `memory_retrieve` — do not rely on what you remember from the conversation history or compaction summary. The plugin is the source of truth for persistent information.

Any of these patterns mean the user wants memories recalled:

| User says... | Action |
|---|---|
| "recall X" / "recall memories about X" | `memory_retrieve(query: X, scope: "global")` |
| "do you remember X" / "remember X?" / "do you recall X" | `memory_retrieve(query: X, scope: "all")` |
| "what did we do on/with X" / "what have we done with X" | `memory_retrieve(query: X, scope: "global")` |
| "what do you know about X" / "what do we know about X" | `memory_retrieve(query: X, scope: "all")` |
| "what was that thing about X" / "that thing we did with X" | `memory_retrieve(query: X, scope: "all")` |
| "bring up X" / "pull up X" / "find X in memories" | `memory_retrieve(query: X, scope: "global")` |
| "check if we've discussed X" / "have we talked about X" | `memory_retrieve(query: X, scope: "all")` |
| Vague: "remember that thing from before" / "what were we working on" | `memory_retrieve(query: <best guess>, scope: "all")` |
| Proactive: before making a decision that might contradict stated preferences | `memory_retrieve(tags: ["preference"], scope: "global")` |

### Scopes

- **`"session"`** (default): only memories stored in the current session
- **`"global"`**: only memories promoted or stored with `global: true` (visible across all sessions)
- **`"all"`**: union of session + global

### Display format

**Always display memories and sessions as markdown tables** unless the user explicitly requests a different format (e.g. "show me the raw JSON" or "just list the titles"). This applies to `memory_list`, `memory_retrieve`, `memory_sessions`, and any other tool that returns memory/session data.

**Sessions columns:** ID, Title, Memories, Last Activity, Tags

**Memories columns:** ID, Title, Session (title or "global"), Summary (1-15 word description), Tags

Tags always go in the last column. Timestamps display as `YYYY-MM-DD HH:MM:SS`.

`scope: "all"` sorts session memories first, then globals, both by ID ascending. `scope: "session"` sorts by most recent first.

### Tips

- Be generous with tags — they enable precise filtering later.
- The FTS5 porter stemmer handles English morphology (e.g. "running" matches "run").
- If the user asks to "remember this for next time", store with `global: true`.
- Maintain a `session-context` memory that holds the full, current session context. Update it (via `memory_update`) whenever significant new context is established — this is the canonical record that survives compaction. Before compaction, ensure it's current. After compaction, retrieve it to restore the session.
- At the end of a session, if the session held important context, suggest `memory_promote_session()`.

### Compaction resilience

Compaction summarises but does not consolidate important context — always use the memory plugin instead.

- **Before compaction**: ensure the `session-context` memory is up to date via `memory_update(id: ..., tags: ["session-context"])`
- **After compaction**: `memory_retrieve(tags: ["session-context"], scope: "session")` to restore the full session context, then `memory_retrieve(tags: ["preference"], scope: "global")` for cross-session context
- **Never** treat the compaction summary as a faithful record — the session-context memory is the source of truth

## Preferences

- Communication style: balanced — explain when helpful, skip when obvious
- Don't over-explain straightforward changes
- Provide context for non-trivial decisions
