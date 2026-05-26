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

const DB_DIR = join(homedir(), ".opencode-plugins", "task-manager");
const DB_PATH = join(DB_DIR, "task-manager.db");
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
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      tags TEXT NOT NULL DEFAULT '[]',
      blocked_by INTEGER,
      project_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
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

interface TaskRow {
  id: number;
  title: string;
  status: string;
  priority: string;
  tags: string;
  blocked_by: number | null;
  project_path: string | null;
  created_at: string;
  updated_at: string;
}

function formatTask(row: TaskRow): string {
  const tags = JSON.parse(row.tags) as string[];
  const parts: string[] = [];
  parts.push(`**#${row.id}** [${row.status}] ${row.title}`);
  parts.push(`  Priority: ${row.priority}`);
  if (row.blocked_by) parts.push(`  Blocked by: #${row.blocked_by}`);
  if (tags.length > 0) parts.push(`  Tags: ${tags.join(", ")}`);
  if (row.project_path) parts.push(`  Project: ${row.project_path}`);
  parts.push(`  Created: ${row.created_at}`);
  return parts.join("\n");
}

function renderTodoMd(database: Database, projectPath: string): string {
  const rows = database
    .prepare("SELECT * FROM tasks WHERE project_path = ? AND status != 'cancelled' ORDER BY priority, created_at")
    .all(projectPath) as TaskRow[];

  const lines: string[] = [];
  lines.push("<!--");
  lines.push("  Auto-generated by task-manager plugin.");
  lines.push("  This file CAN be edited by hand — changes will be picked up on the next");
  lines.push("  tool call via `todo_sync`. A backup is kept at .TODO.md in case this file");
  lines.push("  is corrupted; the full state can always be recreated from the database.");
  lines.push("-->");
  lines.push("");
  lines.push("# TODO");
  lines.push("");

  const priorities = ["high", "medium", "low"];
  const labels: Record<string, string> = { high: "High Priority", medium: "Medium Priority", low: "Low Priority" };

  for (const pri of priorities) {
    const tasks = rows.filter((r) => r.priority === pri);
    if (tasks.length === 0) continue;
    lines.push(`## ${labels[pri]}`);
    lines.push("");
    for (const task of tasks) {
      const check = task.status === "completed" ? "x" : " ";
      const tags = JSON.parse(task.tags) as string[];
      let line = `- [${check}] ${task.title} (#${task.id})`;
      if (tags.length > 0) line += ` [${tags.join(", ")}]`;
      if (task.blocked_by) line += ` (blocked by #${task.blocked_by})`;
      lines.push(line);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function writeTodoFile(database: Database, projectPath: string): void {
  if (!isGitRepo(projectPath)) return;

  const content = renderTodoMd(database, projectPath);
  const filePath = join(projectPath, "TODO.md");
  const backupPath = join(projectPath, ".TODO.md");

  // Write backup before overwriting
  if (existsSync(filePath)) {
    copyFileSync(filePath, backupPath);
  }

  writeFileSync(filePath, content);

  // Ensure .TODO.md is in .gitignore
  ensureGitignore(projectPath, ".TODO.md");

  // Store hash to detect manual edits later
  const hash = new Bun.CryptoHasher("sha256").update(content).digest("hex");
  database.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(`last_render:${projectPath}`, hash);
}

function parseTodoMd(content: string): { id: number | null; title: string; completed: boolean; tags: string[]; blocked_by: number | null }[] {
  const results: { id: number | null; title: string; completed: boolean; tags: string[]; blocked_by: number | null }[] = [];
  const lineRegex = /^- \[(x| )\] (.+)$/;

  for (const line of content.split("\n")) {
    const match = line.match(lineRegex);
    if (!match) continue;

    const completed = match[1] === "x";
    let rest = match[2];

    // Extract id: (#123)
    let id: number | null = null;
    const idMatch = rest.match(/\(#(\d+)\)/);
    if (idMatch) {
      id = parseInt(idMatch[1], 10);
      rest = rest.replace(idMatch[0], "").trim();
    }

    // Extract blocked_by: (blocked by #123)
    let blocked_by: number | null = null;
    const blockedMatch = rest.match(/\(blocked by #(\d+)\)/);
    if (blockedMatch) {
      blocked_by = parseInt(blockedMatch[1], 10);
      rest = rest.replace(blockedMatch[0], "").trim();
    }

    // Extract tags: [tag1, tag2]
    let tags: string[] = [];
    const tagMatch = rest.match(/\[([^\]]+)\]$/);
    if (tagMatch) {
      tags = tagMatch[1].split(",").map((t) => t.trim());
      rest = rest.replace(tagMatch[0], "").trim();
    }

    results.push({ id, title: rest, completed, tags, blocked_by });
  }

  return results;
}

export const TaskManagerPlugin: Plugin = async () => {
  return {
    tool: {
      todo_add: tool({
        description:
          "Add a task to the project TODO. Persists across sessions and regenerates TODO.md.",
        args: {
          title: tool.schema.string().describe("Task description"),
          priority: tool.schema.string().optional().describe("Priority: high, medium (default), low"),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Categorization tags"),
          blocked_by: tool.schema.number().optional().describe("ID of a task that blocks this one"),
        },
        async execute(args, ctx) {
          return withRetry(() => {
            const database = getDb();
            const projectPath = ctx.directory || process.cwd();
            const priority = args.priority || "medium";
            const tags = JSON.stringify(args.tags || []);

            const result = database.prepare(
              "INSERT INTO tasks (title, priority, tags, blocked_by, project_path) VALUES (?, ?, ?, ?, ?)"
            ).run(args.title, priority, tags, args.blocked_by || null, projectPath);

            writeTodoFile(database, projectPath);

            return `Added task #${result.lastInsertRowid}: "${args.title}" [${priority}]`;
          }, true);
        },
      }),

      todo_update: tool({
        description:
          "Update a task's status, priority, or other fields. Regenerates TODO.md.",
        args: {
          id: tool.schema.number().describe("Task ID to update"),
          status: tool.schema.string().optional().describe("New status: pending, in_progress, completed, cancelled"),
          title: tool.schema.string().optional().describe("Updated title"),
          priority: tool.schema.string().optional().describe("New priority: high, medium, low"),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Replace tags"),
          blocked_by: tool.schema.number().optional().describe("Set or change blocking task (use 0 to clear)"),
        },
        async execute(args, ctx) {
          return withRetry(() => {
            const database = getDb();
            const existing = database.prepare("SELECT * FROM tasks WHERE id = ?").get(args.id) as TaskRow | null;
            if (!existing) return `Task #${args.id} not found.`;

            const updates: string[] = [];
            const params: any[] = [];

            if (args.status !== undefined) { updates.push("status = ?"); params.push(args.status); }
            if (args.title !== undefined) { updates.push("title = ?"); params.push(args.title); }
            if (args.priority !== undefined) { updates.push("priority = ?"); params.push(args.priority); }
            if (args.tags !== undefined) { updates.push("tags = ?"); params.push(JSON.stringify(args.tags)); }
            if (args.blocked_by !== undefined) { updates.push("blocked_by = ?"); params.push(args.blocked_by === 0 ? null : args.blocked_by); }

            if (updates.length === 0) return "No fields to update.";

            updates.push("updated_at = datetime('now')");
            params.push(args.id);

            database.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...params);

            const projectPath = existing.project_path || ctx.directory || process.cwd();
            writeTodoFile(database, projectPath);

            const updated = database.prepare("SELECT * FROM tasks WHERE id = ?").get(args.id) as TaskRow;
            return `Updated task #${args.id}:\n${formatTask(updated)}`;
          }, true);
        },
      }),

      todo_list: tool({
        description:
          "List tasks for the current project, optionally filtered by status, priority, or tags.",
        args: {
          status: tool.schema.string().optional().describe("Filter by status: pending, in_progress, completed, cancelled"),
          priority: tool.schema.string().optional().describe("Filter by priority: high, medium, low"),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Filter by tags (AND logic)"),
          all_projects: tool.schema.boolean().optional().describe("Show tasks from all projects (default: current project only)"),
        },
        async execute(args, ctx) {
          return withRetry(() => {
            const database = getDb();
            const projectPath = ctx.directory || process.cwd();
            let sql = "SELECT * FROM tasks WHERE 1=1";
            const params: any[] = [];

            if (!args.all_projects) {
              sql += " AND project_path = ?";
              params.push(projectPath);
            }
            if (args.status) {
              sql += " AND status = ?";
              params.push(args.status);
            }
            if (args.priority) {
              sql += " AND priority = ?";
              params.push(args.priority);
            }
            if (args.tags && args.tags.length > 0) {
              for (const tag of args.tags) {
                sql += " AND tags LIKE ?";
                params.push(`%"${tag}"%`);
              }
            }

            sql += " ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at";

            const rows = database.prepare(sql).all(...params) as TaskRow[];

            if (rows.length === 0) return "No tasks found.";
            return rows.map(formatTask).join("\n\n---\n\n");
          });
        },
      }),

      todo_sync: tool({
        description:
          "Sync changes from a manually edited TODO.md back into the database. Detects new tasks, status changes (checkbox), and removed tasks.",
        args: {
          path: tool.schema.string().optional().describe("Path to TODO.md (defaults to project root)"),
        },
        async execute(args, ctx) {
          return withRetry(() => {
            const database = getDb();
            const projectPath = ctx.directory || process.cwd();
            const filePath = args.path || join(projectPath, "TODO.md");

            if (!existsSync(filePath)) return "No TODO.md found to sync.";

            const content = readFileSync(filePath, "utf-8");

            // Check if file has actually been modified
            const lastRender = database.prepare("SELECT value FROM meta WHERE key = ?").get(`last_render:${projectPath}`) as { value: string } | null;
            const currentHash = new Bun.CryptoHasher("sha256").update(content).digest("hex");
            if (lastRender && lastRender.value === currentHash) {
              return "TODO.md has not been modified since last render. Nothing to sync.";
            }

            const parsed = parseTodoMd(content);
            let added = 0;
            let updated = 0;
            let removed = 0;

            // Collect IDs present in the file
            const fileIds = new Set(parsed.filter((p) => p.id !== null).map((p) => p.id));

            for (const item of parsed) {
              if (item.id) {
                // Existing task — check for status change
                const existing = database.prepare("SELECT * FROM tasks WHERE id = ?").get(item.id) as TaskRow | null;
                if (existing) {
                  const newStatus = item.completed ? "completed" : (existing.status === "completed" ? "pending" : existing.status);
                  if (newStatus !== existing.status || existing.title !== item.title) {
                    database.prepare("UPDATE tasks SET status = ?, title = ?, updated_at = datetime('now') WHERE id = ?")
                      .run(newStatus, item.title, item.id);
                    updated++;
                  }
                }
              } else {
                // New task (no id) — insert
                const tags = JSON.stringify(item.tags);
                database.prepare(
                  "INSERT INTO tasks (title, status, priority, tags, blocked_by, project_path) VALUES (?, ?, ?, ?, ?, ?)"
                ).run(item.title, item.completed ? "completed" : "pending", "medium", tags, item.blocked_by, projectPath);
                added++;
              }
            }

            // Detect removed tasks — DB tasks not in file get cancelled
            const activeTasks = database.prepare(
              "SELECT id FROM tasks WHERE project_path = ? AND status NOT IN ('cancelled', 'completed')"
            ).all(projectPath) as { id: number }[];
            for (const task of activeTasks) {
              if (!fileIds.has(task.id)) {
                database.prepare("UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(task.id);
                removed++;
              }
            }

            writeTodoFile(database, projectPath);

            const parts = [];
            if (added) parts.push(`${added} task(s) added`);
            if (updated) parts.push(`${updated} task(s) updated`);
            if (removed) parts.push(`${removed} task(s) removed`);
            return parts.length > 0 ? `Synced TODO.md: ${parts.join(", ")}.` : "TODO.md synced, no changes detected.";
          }, true);
        },
      }),
    },
  };
};
