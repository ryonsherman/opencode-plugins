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
const DB_PATH = join(DB_DIR, "decision-log.db");
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
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      title TEXT NOT NULL,
      context TEXT,
      decision TEXT NOT NULL,
      consequences TEXT,
      status TEXT NOT NULL DEFAULT 'accepted',
      superseded_by INTEGER,
      tags TEXT NOT NULL DEFAULT '[]',
      project TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const row = database
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='decisions_fts'")
    .get() as { name: string } | null;

  if (!row) {
    database.exec(`
      CREATE VIRTUAL TABLE decisions_fts USING fts5(
        title,
        context,
        decision,
        consequences,
        tags,
        content=decisions,
        content_rowid=id,
        tokenize='porter'
      )
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
        INSERT INTO decisions_fts(rowid, title, context, decision, consequences, tags)
        VALUES (new.id, new.title, COALESCE(new.context, ''), new.decision, COALESCE(new.consequences, ''), new.tags);
      END
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS decisions_ad AFTER DELETE ON decisions BEGIN
        INSERT INTO decisions_fts(decisions_fts, rowid, title, context, decision, consequences, tags)
        VALUES ('delete', old.id, old.title, COALESCE(old.context, ''), old.decision, COALESCE(old.consequences, ''), old.tags);
      END
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS decisions_au AFTER UPDATE ON decisions BEGIN
        INSERT INTO decisions_fts(decisions_fts, rowid, title, context, decision, consequences, tags)
        VALUES ('delete', old.id, old.title, COALESCE(old.context, ''), old.decision, COALESCE(old.consequences, ''), old.tags);
        INSERT INTO decisions_fts(rowid, title, context, decision, consequences, tags)
        VALUES (new.id, new.title, COALESCE(new.context, ''), new.decision, COALESCE(new.consequences, ''), new.tags);
      END
    `);

    // Backfill existing rows
    database.exec(`
      INSERT INTO decisions_fts(rowid, title, context, decision, consequences, tags)
      SELECT id, title, COALESCE(context, ''), decision, COALESCE(consequences, ''), tags FROM decisions
    `);
  }
}

function backup(): void {
  if (!existsSync(DB_PATH)) return;
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(DB_PATH, join(BACKUP_DIR, `decision-log-${ts}.db`));
  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("decision-log-"))
    .sort();
  while (backups.length > MAX_BACKUPS) {
    rmSync(join(BACKUP_DIR, backups.shift()!));
  }
}

function tryRestore(): Database | null {
  if (!existsSync(BACKUP_DIR)) return null;
  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("decision-log-"))
    .sort();
  if (backups.length === 0) return null;
  const latest = backups[backups.length - 1];
  copyFileSync(join(BACKUP_DIR, latest), DB_PATH);
  const restored = new Database(DB_PATH);
  restored.exec("PRAGMA journal_mode=WAL");
  initSchema(restored);
  return restored;
}

interface DecisionRow {
  id: number;
  session_id: string | null;
  title: string;
  context: string | null;
  decision: string;
  consequences: string | null;
  status: string;
  superseded_by: number | null;
  tags: string;
  project: string | null;
  created_at: string;
  updated_at: string;
}

function formatDecision(row: DecisionRow): string {
  const tags = JSON.parse(row.tags) as string[];
  const lines: string[] = [];
  lines.push(`**#${row.id} — ${row.title}**`);
  lines.push(`Status: ${row.status}`);
  if (row.project) lines.push(`Project: ${row.project}`);
  if (row.context) lines.push(`Context: ${row.context}`);
  lines.push(`Decision: ${row.decision}`);
  if (row.consequences) lines.push(`Consequences: ${row.consequences}`);
  if (row.superseded_by) lines.push(`Superseded by: #${row.superseded_by}`);
  if (tags.length > 0) lines.push(`Tags: ${tags.join(", ")}`);
  lines.push(`Created: ${row.created_at} | Updated: ${row.updated_at}`);
  return lines.join("\n");
}

export const DecisionLogPlugin: Plugin = async () => {
  return {
    tool: {
      decision_log: tool({
        description:
          "Record a new architectural or design decision. Use this when the user makes a choice, answers a question with a preference, or when a significant technical decision is made during the session.",
        args: {
          title: tool.schema.string().describe("Short title summarizing the decision"),
          decision: tool.schema.string().describe("What was decided"),
          context: tool.schema.string().optional().describe("Why this question came up — the situation or problem"),
          consequences: tool.schema.string().optional().describe("Expected effects, tradeoffs, or implications"),
          status: tool.schema.string().optional().describe("Decision status: proposed, accepted (default), deprecated, superseded"),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Categorization tags"),
          project: tool.schema.string().optional().describe("Project this decision applies to"),
        },
        async execute(args, ctx) {
          const database = getDb();
          const status = args.status || "accepted";
          const tags = JSON.stringify(args.tags || []);
          const stmt = database.prepare(
            "INSERT INTO decisions (session_id, title, context, decision, consequences, status, tags, project) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          );
          const result = stmt.run(
            ctx.sessionID || null,
            args.title,
            args.context || null,
            args.decision,
            args.consequences || null,
            status,
            tags,
            args.project || null
          );
          backup();
          return `Logged decision #${result.lastInsertRowid}: "${args.title}" [${status}]`;
        },
      }),

      decision_get: tool({
        description: "Get a specific decision by its ID.",
        args: {
          id: tool.schema.number().describe("Decision ID"),
        },
        async execute(args, ctx) {
          const database = getDb();
          const row = database.prepare("SELECT * FROM decisions WHERE id = ?").get(args.id) as DecisionRow | null;
          if (!row) return `Decision #${args.id} not found.`;
          return formatDecision(row);
        },
      }),

      decision_search: tool({
        description:
          "Search decisions using full-text search. Scoped to current session by default. Matches against title, context, decision, consequences, and tags.",
        args: {
          query: tool.schema.string().describe("Search query (supports FTS5 syntax)"),
          all_sessions: tool.schema.boolean().optional().describe("Search across all sessions (default: false, current session only)"),
          limit: tool.schema.number().optional().describe("Max results (default: 10)"),
        },
        async execute(args, ctx) {
          const database = getDb();
          const limit = args.limit ?? 10;
          let sql = `SELECT d.* FROM decisions d
               JOIN decisions_fts f ON d.id = f.rowid
               WHERE decisions_fts MATCH ?`;
          const params: any[] = [args.query];

          if (!args.all_sessions && ctx.sessionID) {
            sql += " AND d.session_id = ?";
            params.push(ctx.sessionID);
          }

          sql += " ORDER BY rank LIMIT ?";
          params.push(limit);

          const rows = database.prepare(sql).all(...params) as DecisionRow[];

          if (rows.length === 0) return "No decisions found.";
          return rows.map(formatDecision).join("\n\n---\n\n");
        },
      }),

      decision_list: tool({
        description:
          "List decisions from the current session, optionally filtered by status, tags, or project. Use all_sessions to see decisions from other sessions.",
        args: {
          status: tool.schema.string().optional().describe("Filter by status: proposed, accepted, deprecated, superseded"),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Filter by tags (AND logic)"),
          project: tool.schema.string().optional().describe("Filter by project name"),
          all_sessions: tool.schema.boolean().optional().describe("Show decisions from all sessions (default: false)"),
          limit: tool.schema.number().optional().describe("Max results (default: 20)"),
        },
        async execute(args, ctx) {
          const database = getDb();
          const limit = args.limit ?? 20;
          let sql = "SELECT * FROM decisions WHERE 1=1";
          const params: any[] = [];

          if (!args.all_sessions && ctx.sessionID) {
            sql += " AND session_id = ?";
            params.push(ctx.sessionID);
          }

          if (args.status) {
            sql += " AND status = ?";
            params.push(args.status);
          }
          if (args.project) {
            sql += " AND project = ?";
            params.push(args.project);
          }
          if (args.tags && args.tags.length > 0) {
            for (const tag of args.tags) {
              sql += " AND tags LIKE ?";
              params.push(`%"${tag}"%`);
            }
          }

          sql += " ORDER BY created_at DESC LIMIT ?";
          params.push(limit);

          const rows = database.prepare(sql).all(...params) as DecisionRow[];

          if (rows.length === 0) return "No decisions found.";

          const total = (database.prepare("SELECT COUNT(*) as count FROM decisions").get() as { count: number }).count;
          const header = `Showing ${rows.length} of ${total} total decisions:\n\n`;
          return header + rows.map(formatDecision).join("\n\n---\n\n");
        },
      }),

      decision_update: tool({
        description:
          "Update an existing decision. Change status (e.g., deprecate or supersede), edit fields, or add consequences learned later.",
        args: {
          id: tool.schema.number().describe("Decision ID to update"),
          title: tool.schema.string().optional().describe("New title"),
          context: tool.schema.string().optional().describe("Updated context"),
          decision: tool.schema.string().optional().describe("Updated decision text"),
          consequences: tool.schema.string().optional().describe("Updated consequences"),
          status: tool.schema.string().optional().describe("New status: proposed, accepted, deprecated, superseded"),
          superseded_by: tool.schema.number().optional().describe("ID of the decision that supersedes this one"),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Replace tags"),
          project: tool.schema.string().optional().describe("Update project"),
        },
        async execute(args, ctx) {
          const database = getDb();
          const existing = database.prepare("SELECT * FROM decisions WHERE id = ?").get(args.id) as DecisionRow | null;
          if (!existing) return `Decision #${args.id} not found.`;

          const updates: string[] = [];
          const params: any[] = [];

          if (args.title !== undefined) { updates.push("title = ?"); params.push(args.title); }
          if (args.context !== undefined) { updates.push("context = ?"); params.push(args.context); }
          if (args.decision !== undefined) { updates.push("decision = ?"); params.push(args.decision); }
          if (args.consequences !== undefined) { updates.push("consequences = ?"); params.push(args.consequences); }
          if (args.status !== undefined) { updates.push("status = ?"); params.push(args.status); }
          if (args.superseded_by !== undefined) { updates.push("superseded_by = ?"); params.push(args.superseded_by); }
          if (args.tags !== undefined) { updates.push("tags = ?"); params.push(JSON.stringify(args.tags)); }
          if (args.project !== undefined) { updates.push("project = ?"); params.push(args.project); }

          if (updates.length === 0) return "No fields to update.";

          updates.push("updated_at = datetime('now')");
          params.push(args.id);

          database.prepare(`UPDATE decisions SET ${updates.join(", ")} WHERE id = ?`).run(...params);
          backup();

          const updated = database.prepare("SELECT * FROM decisions WHERE id = ?").get(args.id) as DecisionRow;
          return `Updated decision #${args.id}:\n\n${formatDecision(updated)}`;
        },
      }),
    },
  };
};
