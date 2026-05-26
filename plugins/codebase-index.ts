import { type Plugin, tool } from "@opencode-ai/plugin";
import { Database } from "bun:sqlite";
import {
  mkdirSync,
  existsSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  statSync,
  rmSync,
} from "fs";
import { homedir } from "os";
import { join, relative, sep, extname } from "path";

const DB_DIR = join(homedir(), ".opencode-memory");
const DB_PATH = join(DB_DIR, "codebase.db");
const BACKUP_DIR = join(DB_DIR, "backups");
const MAX_BACKUPS = 5;

const DEFAULT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".java", ".go", ".rs", ".c", ".cpp", ".h", ".hpp",
  ".swift", ".kt", ".rb", ".php",
  ".css", ".scss", ".less", ".sass",
  ".html", ".htm", ".xml", ".json", ".yaml", ".yml", ".toml",
  ".md", ".sql", ".graphql", ".proto",
  ".sh", ".bash", ".zsh",
  ".dockerfile", ".tf", ".hcl",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg",
  "dist", "build", ".next", ".nuxt", ".output",
  "coverage", ".nyc_output",
  "vendor", "bower_components",
  ".cache", "cache", ".tox", ".eggs", "__pycache__",
  ".serverless", ".webpack",
  "target", "bin", "obj",
  ".gradle", ".idea", ".vscode",
  ".opencode-memory",
]);

const SKIP_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock",
  ".DS_Store", "Thumbs.db",
]);

const CHUNK_SIZE = 50;
const CHUNK_OVERLAP = 10;
const MAX_FILE_SIZE = 512_000;

let db: Database | null = null;

function getDb(): Database {
  if (!db) {
    if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root_path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      file_count INTEGER DEFAULT 0,
      chunk_count INTEGER DEFAULT 0,
      last_indexed_at TEXT
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS code_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      content TEXT NOT NULL
    )
  `);

  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_chunks_project ON code_chunks(project_id)"
  );

  const ftsExists = database
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='code_chunks_fts'")
    .get() as { name: string } | null;

  if (!ftsExists) {
    database.exec(`
      CREATE VIRTUAL TABLE code_chunks_fts USING fts5(
        content,
        content=code_chunks,
        content_rowid=id,
        tokenize='porter'
      )
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON code_chunks BEGIN
        INSERT INTO code_chunks_fts(rowid, content) VALUES (new.id, new.content);
      END
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON code_chunks BEGIN
        INSERT INTO code_chunks_fts(code_chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON code_chunks BEGIN
        INSERT INTO code_chunks_fts(code_chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO code_chunks_fts(rowid, content) VALUES (new.id, new.content);
      END
    `);
  }
}

// --- Backup & recovery ---

function backupDb(): void {
  const database = db;
  if (!database) return;
  try {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(DB_PATH, join(BACKUP_DIR, `codebase.db.${ts}`));
    const files = readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("codebase.db."))
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
    .filter((f) => f.startsWith("codebase.db."))
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

function isCorruption(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("corrupt") || msg.includes("malformed") || msg.includes("disk i/o error");
}

function writeDb<T>(fn: () => T): T {
  try {
    const result = fn();
    try { backupDb(); } catch {}
    return result;
  } catch (err) {
    if (isCorruption(err) && tryRestore()) {
      try {
        const result = fn();
        try { backupDb(); } catch {}
        return result;
      } catch {}
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

// --- File scanning & chunking ---

function* walkDir(dir: string): Generator<string> {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;
        yield* walkDir(fullPath);
      } else if (entry.isFile()) {
        if (SKIP_FILES.has(entry.name)) continue;
        const ext = extname(entry.name).toLowerCase();
        if (!DEFAULT_EXTS.has(ext)) continue;
        yield fullPath;
      }
    }
  } catch {}
}

interface Chunk {
  relPath: string;
  absPath: string;
  index: number;
  startLine: number;
  endLine: number;
  content: string;
}

function chunkFile(absPath: string, rootPath: string): Chunk[] {
  const stat = statSync(absPath);
  if (!stat.isFile() || stat.size > MAX_FILE_SIZE || stat.size === 0) return [];

  const content = readFileSync(absPath, "utf-8");
  const lines = content.split("\n");
  if (lines.length === 0) return [];

  const relPath = relative(rootPath, absPath);
  const chunks: Chunk[] = [];
  const step = CHUNK_SIZE - CHUNK_OVERLAP;

  for (let i = 0; i < lines.length; i += step) {
    const end = Math.min(i + CHUNK_SIZE, lines.length);
    chunks.push({
      relPath,
      absPath,
      index: chunks.length,
      startLine: i + 1,
      endLine: end,
      content: lines.slice(i, end).join("\n"),
    });
    if (end >= lines.length) break;
  }

  return chunks;
}

function indexProject(rootPath: string): { files: number; chunks: number } {
  const database = getDb();
  const resolvedPath = rootPath.replace(/\/$/, "");
  const projectName = resolvedPath.split(sep).pop() || "unknown";

  const deleteStmt = database.query(
    "DELETE FROM code_chunks WHERE project_id = (SELECT id FROM projects WHERE root_path = ?)"
  );
  const deleteProject = database.query(
    "DELETE FROM projects WHERE root_path = ?"
  );

  database.exec("BEGIN TRANSACTION");
  try {
    deleteStmt.run(resolvedPath);
    deleteProject.run(resolvedPath);

    const insertProject = database.query(
      "INSERT INTO projects (root_path, name) VALUES (?, ?)"
    );
    insertProject.run(resolvedPath, projectName);
    const projectId = Number(
      database.query("SELECT last_insert_rowid() as id").get().id
    );

    const insertChunk = database.query(`
      INSERT INTO code_chunks (project_id, file_path, rel_path, chunk_index, start_line, end_line, content)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let fileCount = 0;
    let chunkCount = 0;

    for (const filePath of walkDir(resolvedPath)) {
      const chunks = chunkFile(filePath, resolvedPath);
      if (chunks.length === 0) continue;
      fileCount++;

      for (const ch of chunks) {
        insertChunk.run(
          projectId,
          ch.absPath,
          ch.relPath,
          ch.index,
          ch.startLine,
          ch.endLine,
          ch.content
        );
        chunkCount++;
      }
    }

    database.query(`
      UPDATE projects SET file_count = ?, chunk_count = ?, last_indexed_at = datetime('now')
      WHERE id = ?
    `).run(fileCount, chunkCount, projectId);

    database.exec("COMMIT");
    return { files: fileCount, chunks: chunkCount };
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
}

// --- Tools ---

const codebaseIndex = tool({
  description:
    "Scan and index a codebase directory for full-text search. Reads source files, splits them into chunks, and builds an FTS5 index. Run this before using codebase_search. Re-runs replace the existing index for that path.",
  args: {
    path: tool.schema
      .string()
      .optional()
      .describe("Root path of the codebase to index (default: current project directory)"),
  },
  execute: async (args, ctx) => {
    return writeDb(() => {
      const rootPath = args.path || ctx.directory;
      if (!rootPath || !existsSync(rootPath)) {
        return JSON.stringify({ error: `Path not found: ${rootPath}` });
      }
      const result = indexProject(rootPath);
      return JSON.stringify({
        indexed: true,
        path: rootPath.replace(/\/$/, ""),
        files: result.files,
        chunks: result.chunks,
      });
    });
  },
});

const codebaseSearch = tool({
  description:
    "Search indexed code using FTS5 full-text search with BM25 ranking. Finds relevant code by matching function names, comments, variables, and code patterns. Always check the index status first if unsure whether a project has been indexed.",
  args: {
    query: tool.schema
      .string()
      .describe("Search query — natural language or code terms describing what to find"),
    path: tool.schema
      .string()
      .optional()
      .describe("Root path of the indexed project (if omitted, searches all indexed projects)"),
    filter: tool.schema
      .string()
      .optional()
      .describe("Optional path filter — narrows results to files matching a substring or pattern (e.g. 'src/api' or '.ts')"),
    limit: tool.schema
      .number()
      .optional()
      .default(15)
      .describe("Maximum results to return (1-50)"),
  },
  execute: async (args, ctx) => {
    const targetPath = args.path ? args.path.replace(/\/$/, "") : (ctx.directory?.replace(/\/$/, "") || "");
    if (targetPath) {
      const isIndexed = readDb(() => {
        const database = getDb();
        const row = database
          .query("SELECT id FROM projects WHERE root_path = ?")
          .get(targetPath) as { id: number } | null;
        return row !== null;
      });
      if (!isIndexed && existsSync(targetPath)) {
        writeDb(() => indexProject(targetPath));
      }
    }
    return readDb(() => {
      const database = getDb();
      const safeQuery = args.query.replace(/"/g, '""');
      const ftsQuery = `"${safeQuery}"`;
      const limit = Math.min(Math.max(args.limit ?? 15, 1), 50);
      const params: unknown[] = [ftsQuery];

      let projectJoin = "";
      let projectWhere = "";
      if (args.path) {
        projectJoin = "JOIN projects p ON c.project_id = p.id";
        projectWhere = "AND p.root_path = ?";
        params.push(targetPath);
      }

      let filterWhere = "";
      if (args.filter) {
        filterWhere = "AND c.rel_path LIKE ?";
        params.push(`%${args.filter}%`);
      }

      params.push(limit);

      const sql = `
        SELECT c.id, c.rel_path, c.start_line, c.end_line, c.content, p.root_path, p.name as project, rank
        FROM code_chunks_fts
        JOIN code_chunks c ON c.id = code_chunks_fts.rowid
        ${projectJoin}
        WHERE code_chunks_fts MATCH ?
          ${projectWhere}
          ${filterWhere}
        ORDER BY rank
        LIMIT ?
      `;

      try {
        const rows = database.query(sql).all(...params) as Array<{
          id: number;
          rel_path: string;
          start_line: number;
          end_line: number;
          content: string;
          root_path: string;
          project: string;
          rank: number;
        }>;

        const grouped: Record<string, typeof rows> = {};
        for (const r of rows) {
          const key = `${r.root_path}:${r.rel_path}`;
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(r);
        }

        const parts = Object.entries(grouped).flatMap(([key, chunks]) => {
          const [root, ...rest] = key.split(":");
          const filePath = rest.join(":");
          const header = `## \`${filePath}\` (${chunks[0].project})`;
          const items = chunks.map(
            (c) =>
              `**Chunk** (lines ${c.start_line}-${c.end_line}, score: ${c.rank.toFixed(2)})\n\`\`\`\n${c.content}\n\`\`\``
          );
          return [header, ...items, "---"];
        });

        return `Found ${rows.length} result${rows.length === 1 ? "" : "s"}:\n\n${parts.slice(0, -1).join("\n\n")}`;
      } catch (err) {
        return JSON.stringify({
          error: `Search failed: ${(err as Error).message}`,
        });
      }
    });
  },
});

const codebaseIndexStatus = tool({
  description:
    "Show index statistics for a codebase: file count, chunk count, last indexed timestamp, and project info. Use this to check if a project has been indexed before searching.",
  args: {
    path: tool.schema
      .string()
      .optional()
      .describe("Project root path to check (if omitted, shows all indexed projects)"),
  },
  execute: async (args) => {
    return readDb(() => {
      const database = getDb();

      if (args.path) {
        const resolved = args.path.replace(/\/$/, "");
        const row = database
          .query("SELECT * FROM projects WHERE root_path = ?")
          .get(resolved) as Record<string, unknown> | null;

        if (!row) {
          return JSON.stringify({ indexed: false, path: resolved });
        }

        return JSON.stringify({
          indexed: true,
          path: row.root_path,
          name: row.name,
          files: row.file_count,
          chunks: row.chunk_count,
          last_indexed: row.last_indexed_at,
        });
      }

      const rows = database
        .query("SELECT * FROM projects ORDER BY last_indexed_at DESC")
        .all() as Array<Record<string, unknown>>;

      return JSON.stringify(
        rows.length === 0
          ? { indexed: false, projects: [] }
          : {
              indexed: true,
              projects: rows.map((r) => ({
                path: r.root_path,
                name: r.name,
                files: r.file_count,
                chunks: r.chunk_count,
                last_indexed: r.last_indexed_at,
              })),
            },
        null,
        2
      );
    });
  },
});

const codebaseDeleteIndex = tool({
  description:
    "Delete a project's index from the codebase database. Removes all chunks and FTS entries for the specified path.",
  args: {
    path: tool.schema
      .string()
      .describe("Root path of the project index to delete"),
  },
  execute: async (args) => {
    return writeDb(() => {
      const database = getDb();
      const resolved = args.path.replace(/\/$/, "");
      const project = database
        .query("SELECT id, name FROM projects WHERE root_path = ?")
        .get(resolved) as { id: number; name: string } | null;
      if (!project) {
        return JSON.stringify({ deleted: false, error: "not found", path: resolved });
      }
      database.query("DELETE FROM projects WHERE id = ?").run(project.id);
      return JSON.stringify({ deleted: true, path: resolved, name: project.name });
    });
  },
});

export const CodebaseIndexPlugin: Plugin = async () => {
  return {
    tool: {
      codebase_index: codebaseIndex,
      codebase_search: codebaseSearch,
      codebase_index_status: codebaseIndexStatus,
      codebase_delete_index: codebaseDeleteIndex,
    },
  };
};
