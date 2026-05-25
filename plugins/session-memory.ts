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
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

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
      const sessionId = ctx.sessionID ?? null;
      const stmt = database.query(
        "INSERT INTO memories (session_id, content, tags) VALUES (?, ?, ?)"
      );
      const result = stmt.run(
        args.global ? null : sessionId,
        args.content,
        jsonTags(args.tags)
      );
      return JSON.stringify({
        stored: true,
        id: Number(result.lastInsertRowid),
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

      const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
      const params = [args.query, ...scopeParams, ...tagParams, limit];
      const tagSql =
        tagClauses.length > 0 ? `AND (${tagClauses.join(" OR ")})` : "";

      const sql = `
        SELECT m.id, m.content, m.tags, m.session_id, m.created_at, rank
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
        return stringify(rows);
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
        tagClauses.length > 0 ? `AND (${tagClauses.join(" OR ")})` : "";

      const sql = `
        SELECT id, content, tags, session_id, created_at, updated_at
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

export const SessionMemoryPlugin: Plugin = async () => {
  return {
    tool: {
      memory_store: memoryStore,
      memory_retrieve: memoryRetrieve,
      memory_promote: memoryPromote,
      memory_promote_session: memoryPromoteSession,
      memory_list: memoryList,
    },
  };
};
