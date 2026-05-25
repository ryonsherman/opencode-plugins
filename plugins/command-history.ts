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
const DB_PATH = join(DB_DIR, "command-history.db");
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
    CREATE TABLE IF NOT EXISTS commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      command TEXT NOT NULL,
      output TEXT,
      exit_code INTEGER,
      directory TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const row = database
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='commands_fts'")
    .get() as { name: string } | null;

  if (!row) {
    database.exec(`
      CREATE VIRTUAL TABLE commands_fts USING fts5(
        command,
        output,
        directory,
        content=commands,
        content_rowid=id,
        tokenize='porter'
      )
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS commands_ai AFTER INSERT ON commands BEGIN
        INSERT INTO commands_fts(rowid, command, output, directory)
        VALUES (new.id, new.command, COALESCE(new.output, ''), COALESCE(new.directory, ''));
      END
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS commands_ad AFTER DELETE ON commands BEGIN
        INSERT INTO commands_fts(commands_fts, rowid, command, output, directory)
        VALUES ('delete', old.id, old.command, COALESCE(old.output, ''), COALESCE(old.directory, ''));
      END
    `);

    // Backfill existing rows
    database.exec(`
      INSERT INTO commands_fts(rowid, command, output, directory)
      SELECT id, command, COALESCE(output, ''), COALESCE(directory, '') FROM commands
    `);
  }
}

function backup(): void {
  if (!existsSync(DB_PATH)) return;
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(DB_PATH, join(BACKUP_DIR, `command-history-${ts}.db`));
  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("command-history-"))
    .sort();
  while (backups.length > MAX_BACKUPS) {
    rmSync(join(BACKUP_DIR, backups.shift()!));
  }
}

function tryRestore(): Database | null {
  if (!existsSync(BACKUP_DIR)) return null;
  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("command-history-"))
    .sort();
  if (backups.length === 0) return null;
  const latest = backups[backups.length - 1];
  copyFileSync(join(BACKUP_DIR, latest), DB_PATH);
  const restored = new Database(DB_PATH);
  restored.exec("PRAGMA journal_mode=WAL");
  initSchema(restored);
  return restored;
}

interface CommandRow {
  id: number;
  session_id: string | null;
  command: string;
  output: string | null;
  exit_code: number | null;
  directory: string | null;
  created_at: string;
}

function formatCommand(row: CommandRow): string {
  const lines: string[] = [];
  lines.push(`**#${row.id}** \`${row.command}\``);
  if (row.directory) lines.push(`  Directory: ${row.directory}`);
  if (row.exit_code !== null) lines.push(`  Exit code: ${row.exit_code}`);
  lines.push(`  Time: ${row.created_at}`);
  if (row.output) {
    const truncated = row.output.length > 500 ? row.output.slice(0, 500) + "\n...(truncated)" : row.output;
    lines.push(`  Output:\n\`\`\`\n${truncated}\n\`\`\``);
  }
  return lines.join("\n");
}

export const CommandHistoryPlugin: Plugin = async () => {
  return {
    tool: {
      command_log: tool({
        description:
          "Log a notable command with its output, exit code, and working directory. Use this after running significant commands (builds, migrations, deploys, debugging) — not for trivial commands like ls or cd.",
        args: {
          command: tool.schema.string().describe("The command that was executed"),
          output: tool.schema.string().optional().describe("Command output (stdout/stderr)"),
          exit_code: tool.schema.number().optional().describe("Exit code (0 = success)"),
          directory: tool.schema.string().optional().describe("Working directory where the command was run"),
        },
        async execute(args, ctx) {
          const database = getDb();
          const stmt = database.prepare(
            "INSERT INTO commands (session_id, command, output, exit_code, directory) VALUES (?, ?, ?, ?, ?)"
          );
          const result = stmt.run(
            ctx.sessionID || null,
            args.command,
            args.output || null,
            args.exit_code ?? null,
            args.directory || null
          );
          backup();
          return `Logged command #${result.lastInsertRowid}: \`${args.command}\``;
        },
      }),

      command_search: tool({
        description:
          "Search command history using full-text search. Matches against command text, output, and directory.",
        args: {
          query: tool.schema.string().describe("Search query (supports FTS5 syntax)"),
          limit: tool.schema.number().optional().describe("Max results (default: 10)"),
        },
        async execute(args, ctx) {
          const database = getDb();
          const limit = args.limit ?? 10;
          const rows = database
            .prepare(
              `SELECT c.* FROM commands c
               JOIN commands_fts f ON c.id = f.rowid
               WHERE commands_fts MATCH ?
               ORDER BY rank
               LIMIT ?`
            )
            .all(args.query, limit) as CommandRow[];

          if (rows.length === 0) return "No commands found.";
          return rows.map(formatCommand).join("\n\n---\n\n");
        },
      }),

      command_list: tool({
        description:
          "List recent commands from history, optionally filtered by directory or current session.",
        args: {
          limit: tool.schema.number().optional().describe("Max results (default: 20)"),
          directory: tool.schema.string().optional().describe("Filter by working directory (prefix match)"),
          session_only: tool.schema.boolean().optional().describe("Only show commands from current session (default: false)"),
        },
        async execute(args, ctx) {
          const database = getDb();
          const limit = args.limit ?? 20;
          let sql = "SELECT * FROM commands WHERE 1=1";
          const params: any[] = [];

          if (args.directory) {
            sql += " AND directory LIKE ?";
            params.push(args.directory + "%");
          }
          if (args.session_only && ctx.sessionID) {
            sql += " AND session_id = ?";
            params.push(ctx.sessionID);
          }

          sql += " ORDER BY created_at DESC LIMIT ?";
          params.push(limit);

          const rows = database.prepare(sql).all(...params) as CommandRow[];

          if (rows.length === 0) return "No commands in history.";

          const total = (database.prepare("SELECT COUNT(*) as count FROM commands").get() as { count: number }).count;
          const header = `Showing ${rows.length} of ${total} total commands:\n\n`;
          return header + rows.map(formatCommand).join("\n\n---\n\n");
        },
      }),
    },
  };
};
