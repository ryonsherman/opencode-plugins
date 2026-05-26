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
const DB_PATH = join(DB_DIR, "snippet-library.db");
const BACKUP_DIR = join(DB_DIR, "backups");
const MAX_BACKUPS = 5;

let db: Database | null = null;

function getDb(): Database {
  if (!db) {
    if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
    try {
      db = new Database(DB_PATH);
      db.exec("PRAGMA journal_mode=WAL");
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
    CREATE TABLE IF NOT EXISTS snippets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      code TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      project_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS snippets_fts USING fts5(
      title, code, description, language, tags,
      content='snippets', content_rowid='id',
      tokenize='porter'
    )
  `);

  // Ensure triggers exist (rebuild FTS if missing)
  const hasTrigger = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='snippets_ai'"
  ).get();
  if (!hasTrigger) {
    database.exec("INSERT INTO snippets_fts(snippets_fts) VALUES('rebuild')");
  }

  database.exec(`
    CREATE TRIGGER IF NOT EXISTS snippets_ai AFTER INSERT ON snippets BEGIN
      INSERT INTO snippets_fts(rowid, title, code, description, language, tags) VALUES (new.id, new.title, new.code, new.description, new.language, new.tags);
    END
  `);
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS snippets_ad AFTER DELETE ON snippets BEGIN
      INSERT INTO snippets_fts(snippets_fts, rowid, title, code, description, language, tags) VALUES('delete', old.id, old.title, old.code, old.description, old.language, old.tags);
    END
  `);
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS snippets_au AFTER UPDATE ON snippets BEGIN
      INSERT INTO snippets_fts(snippets_fts, rowid, title, code, description, language, tags) VALUES('delete', old.id, old.title, old.code, old.description, old.language, old.tags);
      INSERT INTO snippets_fts(rowid, title, code, description, language, tags) VALUES (new.id, new.title, new.code, new.description, new.language, new.tags);
    END
  `);
}

function backup(): void {
  if (!existsSync(DB_PATH)) return;
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(DB_PATH, join(BACKUP_DIR, `snippet-library-${ts}.db`));
  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("snippet-library-"))
    .sort();
  while (backups.length > MAX_BACKUPS) {
    rmSync(join(BACKUP_DIR, backups.shift()!));
  }
}

function tryRestore(): Database | null {
  if (!existsSync(BACKUP_DIR)) return null;
  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("snippet-library-"))
    .sort();
  if (backups.length === 0) return null;
  const latest = backups[backups.length - 1];
  copyFileSync(join(BACKUP_DIR, latest), DB_PATH);
  const restored = new Database(DB_PATH);
  restored.exec("PRAGMA journal_mode=WAL");
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

interface SnippetRow {
  id: number;
  title: string;
  code: string;
  language: string;
  description: string;
  tags: string;
  project_path: string | null;
  created_at: string;
  updated_at: string;
}

function formatSnippet(row: SnippetRow, full: boolean = false): string {
  const tags = JSON.parse(row.tags) as string[];
  const parts: string[] = [];
  let header = `**#${row.id}** ${row.title}`;
  if (row.language) header += ` (${row.language})`;
  parts.push(header);
  if (row.description) parts.push(`  ${row.description}`);
  if (full) {
    parts.push("");
    parts.push("```" + row.language);
    parts.push(row.code);
    parts.push("```");
  } else {
    const preview = row.code.split("\n").slice(0, 3).join("\n");
    const truncated = row.code.split("\n").length > 3 ? "\n  ..." : "";
    parts.push("");
    parts.push("```" + row.language);
    parts.push(preview + truncated);
    parts.push("```");
  }
  if (tags.length > 0) parts.push(`Tags: ${tags.join(", ")}`);
  parts.push(`Created: ${row.created_at}`);
  return parts.join("\n");
}

export const SnippetLibraryPlugin: Plugin = async () => {
  return {
    tool: {
      snippet_save: tool({
        description:
          "Save a code snippet to the project snippet library. Persists across sessions.",
        args: {
          title: tool.schema.string().describe("Short descriptive title"),
          code: tool.schema.string().describe("The code snippet"),
          language: tool.schema.string().optional().describe("Programming language (e.g. python, typescript, bash)"),
          description: tool.schema.string().optional().describe("What the snippet does"),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Categorization tags"),
        },
        async execute(args, ctx) {
          return withRetry(() => {
            const database = getDb();
            const tags = JSON.stringify(args.tags || []);

            const result = database.prepare(
              "INSERT INTO snippets (title, code, language, description, tags) VALUES (?, ?, ?, ?, ?)"
            ).run(args.title, args.code, args.language || "", args.description || "", tags);

            return `Saved snippet #${result.lastInsertRowid}: "${args.title}"`;
          }, true);
        },
      }),

      snippet_search: tool({
        description:
          "Search snippets using full-text search across title, code, description, and language.",
        args: {
          query: tool.schema.string().describe("Search query"),
          language: tool.schema.string().optional().describe("Filter by language"),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Filter by tags (AND logic)"),
          limit: tool.schema.number().optional().describe("Max results (default 10)"),
        },
        async execute(args, ctx) {
          return withRetry(() => {
            const database = getDb();
            const limit = args.limit || 10;

            let sql = `SELECT s.* FROM snippets s JOIN snippets_fts f ON s.id = f.rowid WHERE snippets_fts MATCH ?`;
            const params: any[] = [args.query];

            if (args.language) {
              sql += " AND s.language = ?";
              params.push(args.language);
            }
            if (args.tags && args.tags.length > 0) {
              for (const tag of args.tags) {
                sql += " AND s.tags LIKE ?";
                params.push(`%"${tag}"%`);
              }
            }

            sql += " ORDER BY rank LIMIT ?";
            params.push(limit);

            const rows = database.prepare(sql).all(...params) as SnippetRow[];
            if (rows.length === 0) return "No snippets found matching query.";
            return rows.map((r) => formatSnippet(r, true)).join("\n\n---\n\n");
          });
        },
      }),

      snippet_list: tool({
        description:
          "List snippets, optionally filtered by language or tags.",
        args: {
          language: tool.schema.string().optional().describe("Filter by language"),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Filter by tags (AND logic)"),
          limit: tool.schema.number().optional().describe("Max results (default 20)"),
        },
        async execute(args, ctx) {
          return withRetry(() => {
            const database = getDb();
            const limit = args.limit || 20;

            let sql = "SELECT * FROM snippets WHERE 1=1";
            const params: any[] = [];

            if (args.language) {
              sql += " AND language = ?";
              params.push(args.language);
            }
            if (args.tags && args.tags.length > 0) {
              for (const tag of args.tags) {
                sql += " AND tags LIKE ?";
                params.push(`%"${tag}"%`);
              }
            }

            sql += " ORDER BY created_at DESC LIMIT ?";
            params.push(limit);

            const rows = database.prepare(sql).all(...params) as SnippetRow[];
            if (rows.length === 0) return "No snippets found.";
            return rows.map((r) => formatSnippet(r, false)).join("\n\n---\n\n");
          });
        },
      }),

      snippet_get: tool({
        description:
          "Get a snippet by ID with full code.",
        args: {
          id: tool.schema.number().describe("Snippet ID"),
        },
        async execute(args, ctx) {
          return withRetry(() => {
            const database = getDb();
            const row = database.prepare("SELECT * FROM snippets WHERE id = ?").get(args.id) as SnippetRow | null;
            if (!row) return `Snippet #${args.id} not found.`;
            return formatSnippet(row, true);
          });
        },
      }),

      snippet_delete: tool({
        description:
          "Delete a snippet by ID.",
        args: {
          id: tool.schema.number().describe("Snippet ID to delete"),
        },
        async execute(args, ctx) {
          return withRetry(() => {
            const database = getDb();
            const existing = database.prepare("SELECT * FROM snippets WHERE id = ?").get(args.id) as SnippetRow | null;
            if (!existing) return `Snippet #${args.id} not found.`;

            database.prepare("DELETE FROM snippets WHERE id = ?").run(args.id);
            return `Deleted snippet #${args.id}: "${existing.title}"`;
          }, true);
        },
      }),
    },
  };
};
