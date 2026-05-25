import { type Plugin, tool } from "@opencode-ai/plugin";
import { Database } from "bun:sqlite";
import {
  mkdirSync,
  existsSync,
  copyFileSync,
  readdirSync,
  rmSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

const DB_DIR = join(homedir(), ".opencode-memory");
const DB_PATH = join(DB_DIR, "memories.db");
const BACKUP_DIR = join(DB_DIR, "backups");
const MAX_BACKUPS = 5;

let db: Database | null = null;

function getDb(): Database {
  if (!db) {
    if (!existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      title TEXT,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(
    "INSERT OR IGNORE INTO sessions (id) SELECT DISTINCT session_id FROM memories WHERE session_id IS NOT NULL"
  );

  const row = database
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'")
    .get() as { name: string } | null;

  if (!row) {
    database.exec(`
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        content,
        tags,
        content=memories,
        content_rowid=id,
        tokenize='porter'
      )
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
      END
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
      END
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
        INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
      END
    `);

    database.exec(
      "INSERT INTO memories_fts(rowid, content, tags) SELECT id, content, tags FROM memories"
    );
  }
}

// --- Backup & recovery ---

function isCorruption(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("corrupt") || msg.includes("malformed") || msg.includes("disk i/o error");
}

function backupDb(): void {
  const database = db;
  if (!database) return;
  try {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true });
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(DB_PATH, join(BACKUP_DIR, `memories.db.${ts}`));
    const files = readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("memories.db."))
      .sort()
      .reverse();
    for (const f of files.slice(MAX_BACKUPS)) {
      rmSync(join(BACKUP_DIR, f), { force: true });
    }
  } catch {}
}

function getLatestBackup(): string | null {
  if (!existsSync(BACKUP_DIR)) return null;
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("memories.db."))
    .sort()
    .reverse();
  return files.length > 0 ? join(BACKUP_DIR, files[0]) : null;
}

function tryRestore(): boolean {
  const backup = getLatestBackup();
  if (!backup) return false;
  try {
    if (db) {
      db.close();
      db = null;
    }
    for (const ext of ["", "-wal", "-shm"]) {
      const p = DB_PATH + ext;
      if (existsSync(p)) rmSync(p, { force: true });
    }
    copyFileSync(backup, DB_PATH);
    getDb();
    return true;
  } catch {
    return false;
  }
}

function writeDb<T>(fn: () => T): T {
  try {
    const result = fn();
    try {
      backupDb();
    } catch {}
    return result;
  } catch (err) {
    if (isCorruption(err) && tryRestore()) {
      try {
        const result = fn();
        try {
          backupDb();
        } catch {}
        return result;
      } catch (retryErr) {
        throw retryErr;
      }
    }
    throw err;
  }
}

function readDb<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (isCorruption(err) && tryRestore()) {
      return fn();
    }
    throw err;
  }
}

// --- Helpers ---

function jsonTags(tags?: string[]): string {
  return JSON.stringify(tags ?? []);
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function ensureSession(sessionId: string | null): void {
  if (!sessionId) return;
  getDb().query("INSERT OR IGNORE INTO sessions (id) VALUES (?)").run(sessionId);
}

function generateTitle(text: string): string {
  const cleaned = text
    .replace(/\n.*$/, "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim();
  if (cleaned.length <= 25) {
    return cleaned.toLowerCase().replace(/\s+/g, "-");
  }
  const truncated = cleaned.slice(0, 25);
  const lastSpace = truncated.lastIndexOf(" ");
  const final = lastSpace > 10 ? truncated.slice(0, lastSpace) : truncated;
  return final.toLowerCase().replace(/\s+/g, "-");
}

// --- Tools ---

const memoryStore = tool({
  description:
    "Store a memory for the current session. Memories persist across conversations and can be retrieved later via full-text search. Use this to remember important context, decisions, preferences, or project details the user shares.",
  args: {
    content: tool.schema
      .string()
      .describe("The memory content to store — what you want to remember"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe(
        "Tags to categorize this memory, e.g. ['preference', 'project-x', 'architecture']"
      ),
    title: tool.schema
      .string()
      .optional()
      .describe(
        "Optional short title (single word or hyphenated) for quick identification in lists"
      ),
    global: tool.schema
      .boolean()
      .optional()
      .default(false)
      .describe(
        "If true, memory is visible to ALL sessions (cross-session). If false, only visible within the current session."
      ),
  },
  execute: async (args, ctx) => {
    return writeDb(() => {
      const database = getDb();
      const sessionId = args.global ? null : (ctx.sessionID ?? null);
      ensureSession(sessionId);
      const memoryTitle = args.title ?? generateTitle(args.content);
      const stmt = database.query(
        "INSERT INTO memories (session_id, title, content, tags) VALUES (?, ?, ?, ?)"
      );
      const result = stmt.run(
        sessionId,
        memoryTitle,
        args.content,
        jsonTags(args.tags)
      );
      if (sessionId) {
        database.query(
          "UPDATE sessions SET title = COALESCE(title, ?), updated_at = datetime('now') WHERE id = ?"
        ).run(memoryTitle, sessionId);
      }
      return JSON.stringify({
        stored: true,
        id: Number(result.lastInsertRowid),
        title: memoryTitle,
        auto_title: args.title === undefined,
        scope: args.global ? "global" : "session",
      });
    });
  },
});

const memoryRetrieve = tool({
  description:
    "Search stored memories using full-text search (FTS5 with English stemming). Returns memories ranked by relevance. Supports filtering by scope and tags. Use this to recall information from the current session, all sessions, or global memories.",
  args: {
    query: tool.schema
      .string()
      .describe(
        "Search query for full-text search — supports words, phrases, and FTS5 syntax"
      ),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe(
        "Filter by tags (AND logic — all specified tags must be present on a memory)"
      ),
    scope: tool.schema
      .enum(["session", "global", "all"])
      .optional()
      .default("session")
      .describe(
        "'session' = current session only, 'global' = cross-session (global memories), 'all' = everything"
      ),
    limit: tool.schema
      .number()
      .optional()
      .default(10)
      .describe("Maximum number of results (1-50)"),
    summaries: tool.schema
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, returns truncated content (first 200 chars) instead of full content. Use for broad searches to save tokens; follow up with a narrower query or full retrieve for specific IDs."
      ),
  },
  execute: async (args, ctx) => {
    return readDb(() => {
      const database = getDb();

      let scopeSql: string;
      const scopeParams: unknown[] = [];
      switch (args.scope ?? "session") {
        case "session":
          if (ctx.sessionID) {
            scopeSql = "m.session_id = ?";
            scopeParams.push(ctx.sessionID);
          } else {
            scopeSql = "m.session_id IS NULL";
          }
          break;
        case "global":
          scopeSql = "m.session_id IS NULL";
          break;
        default:
          scopeSql = "1=1";
      }

      const tagClauses: string[] = [];
      const tagParams: unknown[] = [];
      if (args.tags && args.tags.length > 0) {
        for (const tag of args.tags) {
          tagClauses.push("m.tags LIKE ?");
          tagParams.push(`%"${tag}"%`);
        }
      }

      const safeQuery = args.query.replace(/-/g, " ");
      const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
      const params = [safeQuery, ...scopeParams, ...tagParams, limit];
      const tagSql =
        tagClauses.length > 0 ? `AND (${tagClauses.join(" AND ")})` : "";

      const sql = `
        SELECT m.id, m.title, m.content, m.tags, m.session_id, m.created_at, rank
        FROM memories_fts
        JOIN memories m ON m.id = memories_fts.rowid
        WHERE memories_fts MATCH ?
          AND ${scopeSql}
          ${tagSql}
        ORDER BY rank
        LIMIT ?
      `;

      try {
        const rows = database.query(sql).all(...params);
        const useSummaries = args.summaries === true;
        const result = useSummaries
          ? rows.map((r: any) => ({
              id: r.id,
              title: r.title,
              tags: r.tags,
              session_id: r.session_id,
              created_at: r.created_at,
              rank: r.rank,
              summary: r.content.length > 200
                ? r.content.slice(0, 200) + "..."
                : r.content,
              truncated: r.content.length > 200,
            }))
          : rows;
        return stringify(result);
      } catch (err) {
        return JSON.stringify({
          error: `Search failed: ${(err as Error).message}`,
        });
      }
    });
  },
});

const memoryPromote = tool({
  description:
    "Promote a specific memory from session-scoped to global, making it visible to all sessions. The memory's session_id is set to NULL.",
  args: {
    id: tool.schema.number().describe("ID of the memory to promote"),
  },
  execute: async (args) => {
    return writeDb(() => {
      const database = getDb();
      const result = database
        .query(
          "UPDATE memories SET session_id = NULL, updated_at = datetime('now') WHERE id = ?"
        )
        .run(args.id);
      return JSON.stringify({
        promoted: result.changes > 0,
        id: args.id,
      });
    });
  },
});

const memoryPromoteSession = tool({
  description:
    "Promote ALL memories from the current session to global scope. After this, all session-scoped memories become visible to all sessions.",
  args: {},
  execute: async (_args, ctx) => {
    return writeDb(() => {
      if (!ctx.sessionID) {
        return JSON.stringify({ error: "No session ID available" });
      }
      const database = getDb();
      const result = database
        .query(
          "UPDATE memories SET session_id = NULL, updated_at = datetime('now') WHERE session_id = ?"
        )
        .run(ctx.sessionID);
      return JSON.stringify({
        promoted: result.changes,
        originSession: ctx.sessionID,
      });
    });
  },
});

const memoryList = tool({
  description:
    "List all memories filtered by scope and/or tags. Returns full details including content, tags, timestamps, and session info. Useful for browsing what's been remembered.",
  args: {
    scope: tool.schema
      .enum(["session", "global", "all"])
      .optional()
      .default("session")
      .describe(
        "'session' = current session, 'global' = all sessions, 'all' = everything"
      ),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Filter by tags (AND logic — all specified tags must match)"),
  },
  execute: async (args, ctx) => {
    return readDb(() => {
      const database = getDb();

      let scopeSql: string;
      const scopeParams: unknown[] = [];
      switch (args.scope ?? "session") {
        case "session":
          if (ctx.sessionID) {
            scopeSql = "session_id = ?";
            scopeParams.push(ctx.sessionID);
          } else {
            scopeSql = "session_id IS NULL";
          }
          break;
        case "global":
          scopeSql = "session_id IS NULL";
          break;
        default:
          scopeSql = "1=1";
      }

      const tagClauses: string[] = [];
      const tagParams: unknown[] = [];
      if (args.tags && args.tags.length > 0) {
        for (const tag of args.tags) {
          tagClauses.push("tags LIKE ?");
          tagParams.push(`%"${tag}"%`);
        }
      }

      const params = [...scopeParams, ...tagParams];
      const tagSql =
        tagClauses.length > 0 ? `AND (${tagClauses.join(" AND ")})` : "";

      const sql = `
        SELECT id, title, content, tags, session_id, created_at, updated_at
        FROM memories
        WHERE ${scopeSql}
        ${tagSql}
        ORDER BY created_at DESC
      `;

      const rows = database.query(sql).all(...params);
      return stringify(rows);
    });
  },
});

const memoryDelete = tool({
  description:
    "Delete a specific memory by its ID. Removes both the memory record and its FTS index entry.",
  args: {
    id: tool.schema.number().describe("ID of the memory to delete"),
  },
  execute: async (args) => {
    return writeDb(() => {
      const database = getDb();
      const result = database.query("DELETE FROM memories WHERE id = ?").run(args.id);
      return JSON.stringify({
        deleted: result.changes > 0,
        id: args.id,
      });
    });
  },
});

const memoryUpdate = tool({
  description:
    "Update an existing memory's content and/or tags by ID. Omit content, tags, or title to keep the current value.",
  args: {
    id: tool.schema.number().describe("ID of the memory to update"),
    content: tool.schema
      .string()
      .optional()
      .describe("New content (omit to keep unchanged)"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("New tags (omit to keep unchanged)"),
    title: tool.schema
      .string()
      .optional()
      .describe("New title (omit to keep unchanged, null to clear)"),
  },
  execute: async (args) => {
    return writeDb(() => {
      const database = getDb();
      const existing = database
        .query("SELECT title, content, tags FROM memories WHERE id = ?")
        .get(args.id) as { title: string | null; content: string; tags: string } | null;
      if (!existing) {
        return JSON.stringify({ updated: false, id: args.id, error: "not found" });
      }
      const newContent = args.content ?? existing.content;
      const newTags = args.tags !== undefined ? jsonTags(args.tags) : existing.tags;
      const newTitle = args.title !== undefined ? args.title : existing.title;
      database
        .query(
          "UPDATE memories SET title = ?, content = ?, tags = ?, updated_at = datetime('now') WHERE id = ?"
        )
        .run(newTitle, newContent, newTags, args.id);
      return JSON.stringify({ updated: true, id: args.id });
    });
  },
});

const memoryTags = tool({
  description:
    "List all unique tags across all memories. Useful for discovering what tags exist to refine searches.",
  args: {},
  execute: async () => {
    return readDb(() => {
      const database = getDb();
      const rows = database
        .query("SELECT DISTINCT tags FROM memories")
        .all() as { tags: string }[];
      const tagSet = new Set<string>();
      for (const r of rows) {
        try {
          const parsed = JSON.parse(r.tags);
          if (Array.isArray(parsed)) parsed.forEach((t: string) => tagSet.add(t));
        } catch {}
      }
      return JSON.stringify({ tags: [...tagSet].sort() });
    });
  },
});

const memorySessions = tool({
  description:
    "List all sessions that contain memories. Each session shows its ID, optional title, memory count, and last activity time. Use session_set_title to give a session a short name.",
  args: {},
  execute: async () => {
    return readDb(() => {
      const database = getDb();
      const rows = database
        .query(`
          SELECT s.id, s.title, COUNT(m.id) as memory_count,
                 MAX(m.created_at) as last_memory_at
          FROM sessions s
          LEFT JOIN memories m ON m.session_id = s.id
          GROUP BY s.id
          ORDER BY last_memory_at DESC
        `)
        .all();
      return stringify(rows);
    });
  },
});

const sessionSetTitle = tool({
  description:
    "Give a session a human-readable short title (single word or hyphenated). Use memory_sessions first to find the session ID.",
  args: {
    id: tool.schema.string().describe("Session ID from memory_sessions"),
    title: tool.schema
      .string()
      .describe("Short title (single word or hyphenated)"),
  },
  execute: async (args) => {
    return writeDb(() => {
      const database = getDb();
      const result = database
        .query("UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?")
        .run(args.title, args.id);
      return JSON.stringify({
        set: result.changes > 0,
        id: args.id,
        title: args.title,
      });
    });
  },
});

const memoryCopy = tool({
  description:
    "Copy a memory from another session to the current session. The memory's content, tags, and title are preserved but it gets a new ID and is assigned to the current session.",
  args: {
    id: tool.schema.number().describe("ID of the memory to copy"),
  },
  execute: async (args, ctx) => {
    return writeDb(() => {
      const database = getDb();
      const source = database
        .query("SELECT title, content, tags FROM memories WHERE id = ?")
        .get(args.id) as { title: string | null; content: string; tags: string } | null;
      if (!source) {
        return JSON.stringify({ copied: false, error: "memory not found", id: args.id });
      }
      const sessionId = ctx.sessionID ?? null;
      ensureSession(sessionId);
      const result = database
        .query("INSERT INTO memories (session_id, title, content, tags) VALUES (?, ?, ?, ?)")
        .run(sessionId, source.title, source.content, source.tags);
      return JSON.stringify({
        copied: true,
        new_id: Number(result.lastInsertRowid),
        source_id: args.id,
      });
    });
  },
});

export const SessionMemoryPlugin: Plugin = async () => {
  return {
    tool: {
      memory_store: memoryStore,
      memory_retrieve: memoryRetrieve,
      memory_promote: memoryPromote,
      memory_promote_session: memoryPromoteSession,
      memory_list: memoryList,
      memory_delete: memoryDelete,
      memory_update: memoryUpdate,
      memory_tags: memoryTags,
      memory_sessions: memorySessions,
      session_set_title: sessionSetTitle,
      memory_copy: memoryCopy,
    },
  };
};
