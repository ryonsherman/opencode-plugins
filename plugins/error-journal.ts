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

const DB_DIR = join(homedir(), ".opencode-plugins", "error-journal");
const DB_PATH = join(DB_DIR, "error-journal.db");
const BACKUP_DIR = join(DB_DIR, "backups");
const MAX_BACKUPS = 5;

let db: Database | null = null;
let lastBackupTime = 0;

function getDb(): Database {
  if (!db) {
    if (!existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true });
    }
    try {
      db = new Database(DB_PATH);
      db.exec("PRAGMA journal_mode=WAL");
      db.exec("PRAGMA synchronous=NORMAL");
      db.exec("PRAGMA cache_size=-8000");
      db.exec("PRAGMA temp_store=MEMORY");
      initSchema(db);
    } catch (e) {
      db = tryRestore();
      if (!db) throw e;
    }
  }
  return db;
}

function initSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      error_text TEXT NOT NULL,
      context TEXT,
      resolution TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      project TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    )
  `);

  const row = database
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='errors_fts'")
    .get() as { name: string } | null;

  if (!row) {
    database.exec(`
      CREATE VIRTUAL TABLE errors_fts USING fts5(
        error_text,
        context,
        resolution,
        tags,
        content=errors,
        content_rowid=id,
        tokenize='porter'
      )
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS errors_ai AFTER INSERT ON errors BEGIN
        INSERT INTO errors_fts(rowid, error_text, context, resolution, tags)
        VALUES (new.id, new.error_text, COALESCE(new.context, ''), COALESCE(new.resolution, ''), new.tags);
      END
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS errors_ad AFTER DELETE ON errors BEGIN
        INSERT INTO errors_fts(errors_fts, rowid, error_text, context, resolution, tags)
        VALUES ('delete', old.id, old.error_text, COALESCE(old.context, ''), COALESCE(old.resolution, ''), old.tags);
      END
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS errors_au AFTER UPDATE ON errors BEGIN
        INSERT INTO errors_fts(errors_fts, rowid, error_text, context, resolution, tags)
        VALUES ('delete', old.id, old.error_text, COALESCE(old.context, ''), COALESCE(old.resolution, ''), old.tags);
        INSERT INTO errors_fts(rowid, error_text, context, resolution, tags)
        VALUES (new.id, new.error_text, COALESCE(new.context, ''), COALESCE(new.resolution, ''), new.tags);
      END
    `);

    // Backfill any existing rows
    database.exec(`
      INSERT INTO errors_fts(rowid, error_text, context, resolution, tags)
      SELECT id, error_text, COALESCE(context, ''), COALESCE(resolution, ''), tags FROM errors
    `);
  }
}

function backup(): void {
  const now = Date.now();
  if (now - lastBackupTime < 300000) return;
  if (!existsSync(DB_PATH)) return;
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(DB_PATH, join(BACKUP_DIR, `${ts}.db`));
  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".db"))
    .sort();
  while (backups.length > MAX_BACKUPS) {
    rmSync(join(BACKUP_DIR, backups.shift()!));
  }
  lastBackupTime = now;
}

function tryRestore(): Database | null {
  if (!existsSync(BACKUP_DIR)) return null;
  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".db"))
    .sort();
  if (backups.length === 0) return null;
  const latest = backups[backups.length - 1];
  copyFileSync(join(BACKUP_DIR, latest), DB_PATH);
  const restored = new Database(DB_PATH);
  restored.exec("PRAGMA journal_mode=WAL");
  restored.exec("PRAGMA synchronous=NORMAL");
  restored.exec("PRAGMA cache_size=-8000");
  restored.exec("PRAGMA temp_store=MEMORY");
  initSchema(restored);
  return restored;
}

function isCorruption(err: unknown): boolean {
  const msg = String(err);
  return /corrupt|malformed|disk image|not a database/i.test(msg);
}

function withRetry<T>(fn: () => T, isWrite = false): T {
  try {
    const result = fn();
    if (isWrite) { try { backup(); } catch {} }
    return result;
  } catch (err) {
    if (isCorruption(err)) {
      db = null;
      db = tryRestore();
      if (db) {
        const result = fn();
        if (isWrite) { try { backup(); } catch {} }
        return result;
      }
    }
    throw err;
  }
}

interface ErrorRow {
  id: number;
  error_text: string;
  context: string | null;
  resolution: string | null;
  tags: string;
  project: string | null;
  created_at: string;
  resolved_at: string | null;
}

function formatError(row: ErrorRow): string {
  const tags = JSON.parse(row.tags) as string[];
  let out = `**#${row.id}** — ${row.created_at}`;
  if (row.resolved_at) out += ` (resolved ${row.resolved_at})`;
  out += "\n";
  if (row.project) out += `Project: ${row.project}\n`;
  if (tags.length > 0) out += `Tags: ${tags.join(", ")}\n`;
  out += `\n\`\`\`\n${row.error_text}\n\`\`\`\n`;
  if (row.context) out += `\nContext: ${row.context}\n`;
  if (row.resolution) out += `\nResolution: ${row.resolution}\n`;
  return out;
}

export const ErrorJournalPlugin: Plugin = async () => {
  return {
    tool: {
      error_log: tool({
        description:
          "Log a new error to the journal. Record the error message/stack, what was happening, and optional tags/project for categorization.",
        args: {
          error_text: tool.schema.string().describe("The error message or stack trace"),
          context: tool.schema.string().optional().describe("What was happening when the error occurred (file, command, action)"),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Tags for categorization (e.g. ['typescript', 'build'])"),
          project: tool.schema.string().optional().describe("Project path or name"),
        },
        async execute(args) {
          return withRetry(() => {
            const database = getDb();
            const tagsJson = JSON.stringify(args.tags || []);
            const stmt = database.prepare(
              "INSERT INTO errors (error_text, context, tags, project) VALUES (?, ?, ?, ?)"
            );
            const result = stmt.run(
              args.error_text,
              args.context || null,
              tagsJson,
              args.project || null
            );
            return `Logged error #${result.lastInsertRowid}`;
          }, true);
        },
      }),

      error_resolve: tool({
        description:
          "Add a resolution to a logged error. Records how the error was fixed for future reference.",
        args: {
          id: tool.schema.number().describe("Error ID to resolve"),
          resolution: tool.schema.string().describe("How the error was fixed"),
        },
        async execute(args) {
          return withRetry(() => {
            const database = getDb();
            const row = database
              .query("SELECT id FROM errors WHERE id = ?")
              .get(args.id) as { id: number } | null;
            if (!row) return `Error #${args.id} not found`;
            database
              .prepare("UPDATE errors SET resolution = ?, resolved_at = datetime('now') WHERE id = ?")
              .run(args.resolution, args.id);
            return `Resolved error #${args.id}`;
          }, true);
        },
      }),

      error_search: tool({
        description:
          "Search the error journal using full-text search. Matches against error text, context, resolution, and tags. Use this when a similar error appears to find past resolutions.",
        args: {
          query: tool.schema.string().describe("Search query"),
          limit: tool.schema.number().optional().describe("Max results (default: 10)"),
        },
        async execute(args) {
          return withRetry(() => {
            const database = getDb();
            const limit = args.limit || 10;
            const rows = database
              .query(
                `SELECT e.* FROM errors e
                 JOIN errors_fts f ON f.rowid = e.id
                 WHERE errors_fts MATCH ?
                 ORDER BY rank
                 LIMIT ?`
              )
              .all(args.query, limit) as ErrorRow[];
            if (rows.length === 0) return "No matching errors found.";
            return rows.map(formatError).join("\n---\n\n");
          });
        },
      }),

      error_list: tool({
        description:
          "List recent errors, optionally filtered by project, tags, or resolved status.",
        args: {
          project: tool.schema.string().optional().describe("Filter by project path/name"),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Filter by tags (AND logic)"),
          resolved: tool.schema.boolean().optional().describe("Filter: true = resolved only, false = unresolved only, omit = all"),
          limit: tool.schema.number().optional().describe("Max results (default: 20)"),
        },
        async execute(args) {
          return withRetry(() => {
            const database = getDb();
            const conditions: string[] = [];
            const params: any[] = [];

            if (args.project) {
              conditions.push("project = ?");
              params.push(args.project);
            }
            if (args.resolved === true) {
              conditions.push("resolution IS NOT NULL");
            } else if (args.resolved === false) {
              conditions.push("resolution IS NULL");
            }
            if (args.tags && args.tags.length > 0) {
              for (const tag of args.tags) {
                conditions.push("tags LIKE ?");
                params.push(`%${JSON.stringify(tag).slice(1, -1)}%`);
              }
            }

            const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            const limit = args.limit || 20;

            const rows = database
              .query(`SELECT * FROM errors ${where} ORDER BY created_at DESC LIMIT ?`)
              .all(...params, limit) as ErrorRow[];

            if (rows.length === 0) return "No errors found.";
            return rows.map(formatError).join("\n---\n\n");
          });
        },
      }),

      error_delete: tool({
        description: "Delete an error entry by ID.",
        args: {
          id: tool.schema.number().describe("Error ID to delete"),
        },
        async execute(args) {
          return withRetry(() => {
            const database = getDb();
            const row = database
              .query("SELECT id FROM errors WHERE id = ?")
              .get(args.id) as { id: number } | null;
            if (!row) return `Error #${args.id} not found`;
            database.prepare("DELETE FROM errors WHERE id = ?").run(args.id);
            return `Deleted error #${args.id}`;
          }, true);
        },
      }),
    },
  };
};
