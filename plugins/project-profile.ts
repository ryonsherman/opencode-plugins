import { type Plugin, tool } from "@opencode-ai/plugin";
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, copyFileSync, rmSync } from "fs";
import { join, basename, resolve } from "path";
import { homedir } from "os";

const DB_DIR = join(homedir(), ".opencode-memory");
const DB_PATH = join(DB_DIR, "project-profile.db");
const BACKUP_DIR = join(DB_DIR, "backups");
const MAX_BACKUPS = 5;

let db: Database | null = null;

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function backup() {
  if (!existsSync(DB_PATH)) return;
  ensureDir(BACKUP_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(BACKUP_DIR, `project-profile-${ts}.db`);
  copyFileSync(DB_PATH, dest);
  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("project-profile-"))
    .sort()
    .reverse();
  for (const old of backups.slice(MAX_BACKUPS)) {
    rmSync(join(BACKUP_DIR, old));
  }
}

function tryRestore(): Database | null {
  if (!existsSync(BACKUP_DIR)) return null;
  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("project-profile-"))
    .sort();
  if (backups.length === 0) return null;
  const latest = backups[backups.length - 1];
  copyFileSync(join(BACKUP_DIR, latest), DB_PATH);
  const restored = new Database(DB_PATH);
  restored.exec("PRAGMA journal_mode=WAL");
  initSchema(restored);
  return restored;
}

function initSchema(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS profiles (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    scanned_at TEXT NOT NULL
  )`);
}

function getDb(): Database {
  if (!db) {
    ensureDir(DB_DIR);
    try {
      db = new Database(DB_PATH, { create: true });
      db.exec("PRAGMA journal_mode=WAL");
      initSchema(db);
    } catch (e) {
      db = tryRestore();
      if (!db) throw e;
    }
  }
  return db;
}

interface ProjectProfile {
  name: string;
  path: string;
  languages: string[];
  framework: string | null;
  packageManager: string | null;
  scripts: Record<string, string>;
  entryPoints: string[];
  configFiles: string[];
  structure: string[];
  monorepo: boolean;
  conventions: string[];
  scannedAt: string;
}

function fileExists(dir: string, name: string): boolean {
  return existsSync(join(dir, name));
}

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function detectLanguages(dir: string): string[] {
  const langs = new Set<string>();
  const extMap: Record<string, string> = {
    ".ts": "TypeScript", ".tsx": "TypeScript",
    ".js": "JavaScript", ".jsx": "JavaScript",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".rb": "Ruby",
    ".java": "Java",
    ".kt": "Kotlin",
    ".cs": "C#",
    ".cpp": "C++", ".cc": "C++", ".cxx": "C++",
    ".c": "C", ".h": "C",
    ".swift": "Swift",
    ".php": "PHP",
    ".ex": "Elixir", ".exs": "Elixir",
    ".zig": "Zig",
  };

  const ignoreDirs = new Set(["node_modules", ".git", "dist", "build", "__pycache__", "target", "vendor", ".next"]);

  function walk(d: string, depth: number) {
    if (depth > 4) return;
    try {
      const entries = readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") && entry.isDirectory()) continue;
        if (entry.isDirectory()) {
          if (!ignoreDirs.has(entry.name)) walk(join(d, entry.name), depth + 1);
        } else {
          const ext = entry.name.match(/\.[^.]+$/)?.[0];
          if (ext && extMap[ext]) langs.add(extMap[ext]);
        }
        if (langs.size >= 10) return; // enough diversity detected
      }
    } catch {}
  }

  walk(dir, 0);
  return [...langs].sort();
}

function detectFramework(dir: string): string | null {
  const pkg = readJson(join(dir, "package.json"));
  if (pkg) {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps["next"]) return "Next.js";
    if (allDeps["nuxt"]) return "Nuxt";
    if (allDeps["@angular/core"]) return "Angular";
    if (allDeps["svelte"] || allDeps["@sveltejs/kit"]) return "SvelteKit";
    if (allDeps["react"]) return "React";
    if (allDeps["vue"]) return "Vue";
    if (allDeps["express"]) return "Express";
    if (allDeps["fastify"]) return "Fastify";
    if (allDeps["hono"]) return "Hono";
    if (allDeps["@nestjs/core"]) return "NestJS";
    if (allDeps["@opencode-ai/plugin"]) return "OpenCode Plugin";
  }

  // Python
  if (fileExists(dir, "requirements.txt") || fileExists(dir, "pyproject.toml") || fileExists(dir, "setup.py")) {
    try {
      const content = readFileSync(
        join(dir, existsSync(join(dir, "pyproject.toml")) ? "pyproject.toml" : "requirements.txt"),
        "utf-8"
      );
      if (content.includes("fastapi")) return "FastAPI";
      if (content.includes("django")) return "Django";
      if (content.includes("flask")) return "Flask";
    } catch {}
  }

  // Go
  if (fileExists(dir, "go.mod")) {
    try {
      const content = readFileSync(join(dir, "go.mod"), "utf-8");
      if (content.includes("gin-gonic")) return "Gin";
      if (content.includes("gofiber")) return "Fiber";
      if (content.includes("echo")) return "Echo";
    } catch {}
  }

  // Rust
  if (fileExists(dir, "Cargo.toml")) {
    try {
      const content = readFileSync(join(dir, "Cargo.toml"), "utf-8");
      if (content.includes("actix")) return "Actix";
      if (content.includes("axum")) return "Axum";
      if (content.includes("rocket")) return "Rocket";
    } catch {}
  }

  return null;
}

function detectPackageManager(dir: string): string | null {
  if (fileExists(dir, "bun.lockb") || fileExists(dir, "bun.lock")) return "bun";
  if (fileExists(dir, "pnpm-lock.yaml")) return "pnpm";
  if (fileExists(dir, "yarn.lock")) return "yarn";
  if (fileExists(dir, "package-lock.json")) return "npm";
  if (fileExists(dir, "Pipfile.lock")) return "pipenv";
  if (fileExists(dir, "poetry.lock")) return "poetry";
  if (fileExists(dir, "uv.lock")) return "uv";
  if (fileExists(dir, "requirements.txt")) return "pip";
  if (fileExists(dir, "go.sum")) return "go modules";
  if (fileExists(dir, "Cargo.lock")) return "cargo";
  if (fileExists(dir, "Gemfile.lock")) return "bundler";
  return null;
}

function detectScripts(dir: string): Record<string, string> {
  const scripts: Record<string, string> = {};

  // package.json scripts
  const pkg = readJson(join(dir, "package.json"));
  if (pkg?.scripts) {
    const important = ["dev", "start", "build", "test", "lint", "format", "typecheck"];
    for (const key of important) {
      if (pkg.scripts[key]) scripts[key] = pkg.scripts[key];
    }
  }

  // Makefile targets
  if (fileExists(dir, "Makefile")) {
    try {
      const content = readFileSync(join(dir, "Makefile"), "utf-8");
      const targets = content.match(/^[a-zA-Z_-]+(?=:)/gm);
      if (targets) {
        const important = targets.filter(t => !t.startsWith(".") && !t.startsWith("_")).slice(0, 10);
        for (const t of important) scripts[`make ${t}`] = "(Makefile target)";
      }
    } catch {}
  }

  return scripts;
}

function detectEntryPoints(dir: string): string[] {
  const entries: string[] = [];
  const pkg = readJson(join(dir, "package.json"));
  if (pkg?.main) entries.push(pkg.main);
  if (pkg?.module) entries.push(pkg.module);
  if (pkg?.bin) {
    if (typeof pkg.bin === "string") entries.push(pkg.bin);
    else Object.values(pkg.bin).forEach((v: any) => entries.push(v));
  }

  const commonEntries = [
    "src/index.ts", "src/index.js", "src/main.ts", "src/main.js",
    "src/app.ts", "src/app.js", "index.ts", "index.js",
    "main.py", "app.py", "src/main.py", "main.go", "cmd/main.go",
    "src/main.rs", "src/lib.rs",
  ];
  for (const entry of commonEntries) {
    if (fileExists(dir, entry) && !entries.includes(entry)) entries.push(entry);
  }

  return entries.slice(0, 5);
}

function detectConfigFiles(dir: string): string[] {
  const configs: string[] = [];
  const check = [
    "tsconfig.json", "jsconfig.json", ".eslintrc.js", ".eslintrc.json", "eslint.config.js",
    ".prettierrc", ".prettierrc.json", "prettier.config.js",
    "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
    ".env.example", ".github/workflows", "Makefile",
    "jest.config.js", "jest.config.ts", "vitest.config.ts",
    "tailwind.config.js", "tailwind.config.ts",
    "webpack.config.js", "vite.config.ts", "vite.config.js",
    "pyproject.toml", "setup.py", "setup.cfg",
    "go.mod", "Cargo.toml", "Gemfile",
    ".opencode.json", ".opencode.jsonc",
  ];
  for (const f of check) {
    if (fileExists(dir, f)) configs.push(f);
  }
  return configs.sort();
}

function detectStructure(dir: string): string[] {
  const structure: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "__pycache__" && e.name !== "dist" && e.name !== "build" && e.name !== ".git");
    for (const d of dirs.slice(0, 15)) {
      structure.push(`${d.name}/`);
    }
  } catch {}
  return structure;
}

function detectMonorepo(dir: string): boolean {
  const pkg = readJson(join(dir, "package.json"));
  if (pkg?.workspaces) return true;
  if (fileExists(dir, "pnpm-workspace.yaml")) return true;
  if (fileExists(dir, "lerna.json")) return true;
  if (existsSync(join(dir, "packages")) && statSync(join(dir, "packages")).isDirectory()) return true;
  return false;
}

function scanProject(dir: string): ProjectProfile {
  const absPath = resolve(dir);
  return {
    name: basename(absPath),
    path: absPath,
    languages: detectLanguages(absPath),
    framework: detectFramework(absPath),
    packageManager: detectPackageManager(absPath),
    scripts: detectScripts(absPath),
    entryPoints: detectEntryPoints(absPath),
    configFiles: detectConfigFiles(absPath),
    structure: detectStructure(absPath),
    monorepo: detectMonorepo(absPath),
    conventions: [],
    scannedAt: new Date().toISOString(),
  };
}

function formatProfile(p: ProjectProfile): string {
  const lines: string[] = [];
  lines.push(`## ${p.name}`);
  lines.push(`Path: ${p.path}`);
  lines.push(`Scanned: ${p.scannedAt.replace("T", " ").replace(/\.\d+Z/, "")}`);
  lines.push("");

  if (p.languages.length) lines.push(`**Languages:** ${p.languages.join(", ")}`);
  if (p.framework) lines.push(`**Framework:** ${p.framework}`);
  if (p.packageManager) lines.push(`**Package manager:** ${p.packageManager}`);
  if (p.monorepo) lines.push(`**Monorepo:** yes`);
  lines.push("");

  if (p.entryPoints.length) {
    lines.push("**Entry points:**");
    p.entryPoints.forEach(e => lines.push(`  ${e}`));
    lines.push("");
  }

  if (Object.keys(p.scripts).length) {
    lines.push("**Scripts:**");
    for (const [key, val] of Object.entries(p.scripts)) {
      lines.push(`  ${key}: ${val}`);
    }
    lines.push("");
  }

  if (p.configFiles.length) {
    lines.push(`**Config:** ${p.configFiles.join(", ")}`);
    lines.push("");
  }

  if (p.structure.length) {
    lines.push(`**Top-level dirs:** ${p.structure.join(", ")}`);
    lines.push("");
  }

  if (p.conventions.length) {
    lines.push("**Conventions:**");
    p.conventions.forEach((c, i) => lines.push(`  ${i + 1}. ${c}`));
    lines.push("");
  }

  return lines.join("\n");
}

export const ProjectProfilePlugin: Plugin = async () => {
  return {
    tool: {
      project_profile: tool({
        description:
          "Show the stored profile for a project. Returns cached metadata (languages, framework, scripts, entry points, config). Auto-scans on first access if no profile exists.",
        args: {
          path: tool.schema.string().optional().describe("Project directory (defaults to current working directory)"),
        },
        async execute(args, ctx) {
          const dir = resolve(args.path || ctx.directory);
          if (!existsSync(dir)) return `Directory not found: ${dir}`;

          const database = getDb();
          const row = database.prepare("SELECT data FROM profiles WHERE path = ?").get(dir) as any;

          if (row) {
            const profile: ProjectProfile = JSON.parse(row.data);
            return formatProfile(profile);
          }

          // Auto-scan on first access
          const profile = scanProject(dir);
          database.prepare("INSERT OR REPLACE INTO profiles (path, name, data, scanned_at) VALUES (?, ?, ?, ?)").run(
            profile.path, profile.name, JSON.stringify(profile), profile.scannedAt
          );
          backup();
          return formatProfile(profile) + "\n(first scan — profile cached)";
        },
      }),

      project_scan: tool({
        description: "Force re-scan a project and update its stored profile.",
        args: {
          path: tool.schema.string().optional().describe("Project directory (defaults to current working directory)"),
        },
        async execute(args, ctx) {
          const dir = resolve(args.path || ctx.directory);
          if (!existsSync(dir)) return `Directory not found: ${dir}`;

          const profile = scanProject(dir);
          const database = getDb();

          // Preserve existing conventions
          const existing = database.prepare("SELECT data FROM profiles WHERE path = ?").get(dir) as any;
          if (existing) {
            const old: ProjectProfile = JSON.parse(existing.data);
            profile.conventions = old.conventions;
          }

          database.prepare("INSERT OR REPLACE INTO profiles (path, name, data, scanned_at) VALUES (?, ?, ?, ?)").run(
            profile.path, profile.name, JSON.stringify(profile), profile.scannedAt
          );
          backup();
          return formatProfile(profile) + "\n(profile updated)";
        },
      }),

      project_delete: tool({
        description: "Remove a stored project profile.",
        args: {
          path: tool.schema.string().optional().describe("Project directory (defaults to current working directory)"),
        },
        async execute(args, ctx) {
          const dir = resolve(args.path || ctx.directory);
          const database = getDb();
          const result = database.prepare("DELETE FROM profiles WHERE path = ?").run(dir);
          if (result.changes === 0) return `No profile found for: ${dir}`;
          backup();
          return `Deleted profile for: ${dir}`;
        },
      }),

      project_convention_add: tool({
        description:
          "Add a convention to a project profile. Conventions guide code generation (e.g. style, architecture, naming patterns).",
        args: {
          convention: tool.schema.string().describe("Convention to add (e.g. 'Use single quotes and 2-space indent')"),
          path: tool.schema.string().optional().describe("Project directory (defaults to current working directory)"),
        },
        async execute(args, ctx) {
          const dir = resolve(args.path || ctx.directory);
          const database = getDb();
          const row = database.prepare("SELECT data FROM profiles WHERE path = ?").get(dir) as any;
          if (!row) return `No profile found for: ${dir}. Run project_scan first.`;

          const profile: ProjectProfile = JSON.parse(row.data);
          profile.conventions.push(args.convention);
          database.prepare("UPDATE profiles SET data = ? WHERE path = ?").run(JSON.stringify(profile), dir);
          backup();
          return `Added convention: "${args.convention}"\n\nTotal conventions: ${profile.conventions.length}`;
        },
      }),

      project_convention_remove: tool({
        description: "Remove a convention from a project profile by its number (1-based index).",
        args: {
          index: tool.schema.number().describe("Convention number to remove (1-based)"),
          path: tool.schema.string().optional().describe("Project directory (defaults to current working directory)"),
        },
        async execute(args, ctx) {
          const dir = resolve(args.path || ctx.directory);
          const database = getDb();
          const row = database.prepare("SELECT data FROM profiles WHERE path = ?").get(dir) as any;
          if (!row) return `No profile found for: ${dir}. Run project_scan first.`;

          const profile: ProjectProfile = JSON.parse(row.data);
          const idx = args.index - 1;
          if (idx < 0 || idx >= profile.conventions.length) {
            return `Invalid index. Project has ${profile.conventions.length} convention(s).`;
          }
          const removed = profile.conventions.splice(idx, 1)[0];
          database.prepare("UPDATE profiles SET data = ? WHERE path = ?").run(JSON.stringify(profile), dir);
          backup();
          return `Removed convention: "${removed}"\n\nRemaining: ${profile.conventions.length}`;
        },
      }),
    },
  };
};
