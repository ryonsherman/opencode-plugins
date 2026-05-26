import { type Plugin, tool } from "@opencode-ai/plugin";
import { Database } from "bun:sqlite";
import {
  mkdirSync,
  existsSync,
  copyFileSync,
  readdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

const DB_DIR = join(homedir(), ".opencode-plugins", "notepad");
const DB_PATH = join(DB_DIR, "notepad.db");
const BACKUP_DIR = join(DB_DIR, "backups");
const MAX_BACKUPS = 5;

let db: Database | null = null;
let lastBackupTime = 0;

function getDb(): Database {
  if (!db) {
    if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
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
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      project_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title, content, tags,
      content='notes', content_rowid='id',
      tokenize='porter'
    )
  `);

  // Ensure triggers exist (rebuild FTS if missing)
  const hasTrigger = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='notes_ai'"
  ).get();
  if (!hasTrigger) {
    database.exec("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')");
  }

  database.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, title, content, tags) VALUES (new.id, new.title, new.content, new.tags);
    END
  `);
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content, tags) VALUES('delete', old.id, old.title, old.content, old.tags);
    END
  `);
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content, tags) VALUES('delete', old.id, old.title, old.content, old.tags);
      INSERT INTO notes_fts(rowid, title, content, tags) VALUES (new.id, new.title, new.content, new.tags);
    END
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
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

function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

const gitignoreChecked = new Set<string>();

function ensureGitignore(projectPath: string, entry: string): void {
  const key = `${projectPath}:${entry}`;
  if (gitignoreChecked.has(key)) return;
  const gitignorePath = join(projectPath, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (content.split("\n").some((l) => l.trim() === entry)) {
      gitignoreChecked.add(key);
      return;
    }
    writeFileSync(gitignorePath, content.trimEnd() + "\n" + entry + "\n");
  } else {
    writeFileSync(gitignorePath, entry + "\n");
  }
  gitignoreChecked.add(key);
}

interface NoteRow {
  id: number;
  title: string;
  content: string;
  tags: string;
  project_path: string | null;
  created_at: string;
  updated_at: string;
}

function formatNote(row: NoteRow): string {
  const tags = JSON.parse(row.tags) as string[];
  const parts: string[] = [];
  parts.push(`**#${row.id}** ${row.title}`);
  if (row.content) parts.push(`  ${row.content.length > 200 ? row.content.slice(0, 200) + "..." : row.content}`);
  if (tags.length > 0) parts.push(`  Tags: ${tags.join(", ")}`);
  parts.push(`  Created: ${row.created_at}`);
  if (row.updated_at !== row.created_at) parts.push(`  Updated: ${row.updated_at}`);
  return parts.join("\n");
}

function renderNotesMd(database: Database, projectPath: string): string {
  const rows = database
    .prepare("SELECT * FROM notes WHERE project_path = ? ORDER BY created_at DESC")
    .all(projectPath) as NoteRow[];

  const lines: string[] = [];
  lines.push("<!--");
  lines.push("  Auto-generated by notepad plugin.");
  lines.push("  This file CAN be edited by hand — changes will be picked up on the next");
  lines.push("  tool call via `note_sync`. A backup is kept at .NOTES.md in case this file");
  lines.push("  is corrupted; the full state can always be recreated from the database.");
  lines.push("-->");
  lines.push("");
  lines.push("# Notes");
  lines.push("");

  if (rows.length === 0) {
    lines.push("_No notes yet._");
    lines.push("");
  } else {
    for (const note of rows) {
      const tags = JSON.parse(note.tags) as string[];
      let header = `## ${note.title} (#${note.id})`;
      if (tags.length > 0) header += ` [${tags.join(", ")}]`;
      lines.push(header);
      lines.push("");
      if (note.content) {
        lines.push(note.content);
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

function writeNotesFile(database: Database, projectPath: string): void {
  if (!isGitRepo(projectPath)) return;

  const content = renderNotesMd(database, projectPath);
  const filePath = join(projectPath, "NOTES.md");
  const backupPath = join(projectPath, ".NOTES.md");

  if (existsSync(filePath)) {
    copyFileSync(filePath, backupPath);
  }

  writeFileSync(filePath, content);
  ensureGitignore(projectPath, ".NOTES.md");

  const hash = new Bun.CryptoHasher("sha256").update(content).digest("hex");
  database.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(`last_render:${projectPath}`, hash);
}

export const NotepadPlugin: Plugin = async () => {
  return {
    tool: {
      note_add: tool({
        description:
          "Add a freeform note to the project notepad. Persists across sessions and regenerates NOTES.md.",
        args: {
          title: tool.schema.string().describe("Short note title or summary"),
          content: tool.schema.string().optional().describe("Full note content (markdown supported)"),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Categorization tags"),
        },
        async execute(args, ctx) {
          return withRetry(() => {
            const database = getDb();
            const projectPath = ctx.directory || process.cwd();
            const tags = JSON.stringify(args.tags || []);

            const result = database.prepare(
              "INSERT INTO notes (title, content, tags, project_path) VALUES (?, ?, ?, ?)"
            ).run(args.title, args.content || "", tags, projectPath);

            writeNotesFile(database, projectPath);

            return `Added note #${result.lastInsertRowid}: "${args.title}"`;
          }, true);
        },
      }),

      note_update: tool({
        description:
          "Update an existing note's title, content, or tags. Regenerates NOTES.md.",
        args: {
          id: tool.schema.number().describe("Note ID to update"),
          title: tool.schema.string().optional().describe("New title"),
          content: tool.schema.string().optional().describe("New content"),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Replace tags"),
        },
        async execute(args, ctx) {
          return withRetry(() => {
            const database = getDb();
            const existing = database.prepare("SELECT * FROM notes WHERE id = ?").get(args.id) as NoteRow | null;
            if (!existing) return `Note #${args.id} not found.`;

            const updates: string[] = [];
            const params: any[] = [];

            if (args.title !== undefined) { updates.push("title = ?"); params.push(args.title); }
            if (args.content !== undefined) { updates.push("content = ?"); params.push(args.content); }
            if (args.tags !== undefined) { updates.push("tags = ?"); params.push(JSON.stringify(args.tags)); }

            if (updates.length === 0) return "No fields to update.";

            updates.push("updated_at = datetime('now')");
            params.push(args.id);

            database.prepare(`UPDATE notes SET ${updates.join(", ")} WHERE id = ?`).run(...params);

            const projectPath = existing.project_path || ctx.directory || process.cwd();
            writeNotesFile(database, projectPath);

            const updated = database.prepare("SELECT * FROM notes WHERE id = ?").get(args.id) as NoteRow;
            return `Updated note #${args.id}:\n${formatNote(updated)}`;
          }, true);
        },
      }),

      note_list: tool({
        description:
          "List notes for the current project, optionally filtered by tags.",
        args: {
          tags: tool.schema.array(tool.schema.string()).optional().describe("Filter by tags (AND logic)"),
          all_projects: tool.schema.boolean().optional().describe("Show notes from all projects"),
        },
        async execute(args, ctx) {
          return withRetry(() => {
            const database = getDb();
            const projectPath = ctx.directory || process.cwd();
            let sql = "SELECT * FROM notes WHERE 1=1";
            const params: any[] = [];

            if (!args.all_projects) {
              sql += " AND project_path = ?";
              params.push(projectPath);
            }
            if (args.tags && args.tags.length > 0) {
              for (const tag of args.tags) {
                sql += " AND tags LIKE ?";
                params.push(`%"${tag}"%`);
              }
            }

            sql += " ORDER BY created_at DESC";

            const rows = database.prepare(sql).all(...params) as NoteRow[];
            if (rows.length === 0) return "No notes found.";
            return rows.map(formatNote).join("\n\n---\n\n");
          });
        },
      }),

      note_search: tool({
        description:
          "Search notes using full-text search across title, content, and tags.",
        args: {
          query: tool.schema.string().describe("Search query"),
          all_projects: tool.schema.boolean().optional().describe("Search across all projects"),
        },
        async execute(args, ctx) {
          return withRetry(() => {
            const database = getDb();
            const projectPath = ctx.directory || process.cwd();

            let sql: string;
            const params: any[] = [args.query];

            if (args.all_projects) {
              sql = `SELECT n.* FROM notes n JOIN notes_fts f ON n.id = f.rowid WHERE notes_fts MATCH ? ORDER BY rank LIMIT 25`;
            } else {
              sql = `SELECT n.* FROM notes n JOIN notes_fts f ON n.id = f.rowid WHERE notes_fts MATCH ? AND n.project_path = ? ORDER BY rank LIMIT 25`;
              params.push(projectPath);
            }

            const rows = database.prepare(sql).all(...params) as NoteRow[];
            if (rows.length === 0) return "No notes found matching query.";
            return rows.map(formatNote).join("\n\n---\n\n");
          });
        },
      }),

      note_delete: tool({
        description:
          "Delete a note by ID. Regenerates NOTES.md.",
        args: {
          id: tool.schema.number().describe("Note ID to delete"),
        },
        async execute(args, ctx) {
          return withRetry(() => {
            const database = getDb();
            const existing = database.prepare("SELECT * FROM notes WHERE id = ?").get(args.id) as NoteRow | null;
            if (!existing) return `Note #${args.id} not found.`;

            database.prepare("DELETE FROM notes WHERE id = ?").run(args.id);

            const projectPath = existing.project_path || ctx.directory || process.cwd();
            writeNotesFile(database, projectPath);

            return `Deleted note #${args.id}: "${existing.title}"`;
          }, true);
        },
      }),
    },
  };
};
