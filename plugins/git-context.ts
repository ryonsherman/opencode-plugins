import { type Plugin, tool } from "@opencode-ai/plugin";
import { execSync } from "child_process";

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", timeout: 5000 }).replace(/\n$/, "");
  } catch {
    return "";
  }
}

function isGitRepo(cwd: string): boolean {
  return git("rev-parse --is-inside-work-tree", cwd) === "true";
}

function getBranch(cwd: string): string {
  return git("branch --show-current", cwd) || git("rev-parse --short HEAD", cwd);
}

function getRemoteStatus(cwd: string): string {
  const status = git("status --branch --porcelain=v2", cwd);
  const ahead = status.match(/# branch\.ab \+(\d+) -(\d+)/);
  if (!ahead) return "no remote tracking";
  const [, a, b] = ahead;
  const parts: string[] = [];
  if (Number(a) > 0) parts.push(`${a} ahead`);
  if (Number(b) > 0) parts.push(`${b} behind`);
  return parts.length ? parts.join(", ") : "up to date";
}

function getDirtyFiles(cwd: string): { staged: string[]; unstaged: string[]; untracked: string[] } {
  const output = git("status --porcelain", cwd);
  if (!output) return { staged: [], unstaged: [], untracked: [] };
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const x = line[0];
    const y = line[1];
    const file = line.slice(3);
    if (x === "?") untracked.push(file);
    else {
      if (x !== " " && x !== "?") staged.push(file);
      if (y !== " " && y !== "?") unstaged.push(file);
    }
  }
  return { staged, unstaged, untracked };
}

function getRecentCommits(cwd: string, limit: number): string[] {
  const output = git(`log --oneline -${limit} --no-decorate`, cwd);
  return output ? output.split("\n") : [];
}

function getStashes(cwd: string): string[] {
  const output = git("stash list --oneline", cwd);
  return output ? output.split("\n") : [];
}

function getBranches(cwd: string): string[] {
  const output = git("branch --format=%(refname:short)|%(HEAD)|%(committerdate:relative)", cwd);
  if (!output) return [];
  return output.split("\n").map((line) => {
    const [name, head, date] = line.split("|");
    return head === "*" ? `* ${name} (${date})` : `  ${name} (${date})`;
  });
}

function formatContext(cwd: string, commitLimit: number): string {
  const branch = getBranch(cwd);
  const remote = getRemoteStatus(cwd);
  const dirty = getDirtyFiles(cwd);
  const commits = getRecentCommits(cwd, commitLimit);
  const stashes = getStashes(cwd);

  const lines: string[] = [];
  lines.push(`## Branch: ${branch}`);
  lines.push(`Remote: ${remote}`);
  lines.push("");

  const totalDirty = dirty.staged.length + dirty.unstaged.length + dirty.untracked.length;
  if (totalDirty > 0) {
    lines.push("## Working Tree");
    if (dirty.staged.length) {
      lines.push(`Staged (${dirty.staged.length}):`);
      dirty.staged.forEach((f) => lines.push(`  + ${f}`));
    }
    if (dirty.unstaged.length) {
      lines.push(`Unstaged (${dirty.unstaged.length}):`);
      dirty.unstaged.forEach((f) => lines.push(`  M ${f}`));
    }
    if (dirty.untracked.length) {
      lines.push(`Untracked (${dirty.untracked.length}):`);
      dirty.untracked.forEach((f) => lines.push(`  ? ${f}`));
    }
    lines.push("");
  } else {
    lines.push("## Working Tree: clean");
    lines.push("");
  }

  if (commits.length) {
    lines.push(`## Recent Commits (${commits.length})`);
    commits.forEach((c) => lines.push(`  ${c}`));
    lines.push("");
  }

  if (stashes.length) {
    lines.push(`## Stashes (${stashes.length})`);
    stashes.forEach((s) => lines.push(`  ${s}`));
    lines.push("");
  }

  return lines.join("\n");
}

export const GitContextPlugin: Plugin = async () => {
  return {
    tool: {
      git_context: tool({
        description:
          "Get full git context: current branch, remote status, dirty files, recent commits, and stashes. Use this at session start or whenever you need to understand the current state of the repo.",
        args: {
          path: tool.schema.string().optional().describe("Project directory (defaults to current working directory)"),
          limit: tool.schema.number().optional().describe("Number of recent commits to show (default: 10)"),
        },
        async execute(args, ctx) {
          const cwd = args.path || ctx.directory;
          if (!isGitRepo(cwd)) return `Not a git repository: ${cwd}`;
          return formatContext(cwd, args.limit || 10);
        },
      }),

      git_recent: tool({
        description: "Show recent git commits with short hashes and messages.",
        args: {
          path: tool.schema.string().optional().describe("Project directory (defaults to current working directory)"),
          limit: tool.schema.number().optional().describe("Number of commits to show (default: 10)"),
        },
        async execute(args, ctx) {
          const cwd = args.path || ctx.directory;
          if (!isGitRepo(cwd)) return `Not a git repository: ${cwd}`;
          const commits = getRecentCommits(cwd, args.limit || 10);
          if (!commits.length) return "No commits found.";
          return `## Recent Commits\n\n${commits.map((c) => `  ${c}`).join("\n")}`;
        },
      }),

      git_dirty: tool({
        description: "Show working tree status: staged, unstaged, and untracked files.",
        args: {
          path: tool.schema.string().optional().describe("Project directory (defaults to current working directory)"),
        },
        async execute(args, ctx) {
          const cwd = args.path || ctx.directory;
          if (!isGitRepo(cwd)) return `Not a git repository: ${cwd}`;
          const dirty = getDirtyFiles(cwd);
          const total = dirty.staged.length + dirty.unstaged.length + dirty.untracked.length;
          if (total === 0) return "Working tree is clean.";
          const lines: string[] = ["## Working Tree"];
          if (dirty.staged.length) {
            lines.push(`Staged (${dirty.staged.length}):`);
            dirty.staged.forEach((f) => lines.push(`  + ${f}`));
          }
          if (dirty.unstaged.length) {
            lines.push(`Unstaged (${dirty.unstaged.length}):`);
            dirty.unstaged.forEach((f) => lines.push(`  M ${f}`));
          }
          if (dirty.untracked.length) {
            lines.push(`Untracked (${dirty.untracked.length}):`);
            dirty.untracked.forEach((f) => lines.push(`  ? ${f}`));
          }
          return lines.join("\n");
        },
      }),

      git_branches: tool({
        description: "List git branches with current branch highlighted and last commit date.",
        args: {
          path: tool.schema.string().optional().describe("Project directory (defaults to current working directory)"),
        },
        async execute(args, ctx) {
          const cwd = args.path || ctx.directory;
          if (!isGitRepo(cwd)) return `Not a git repository: ${cwd}`;
          const branches = getBranches(cwd);
          if (!branches.length) return "No branches found.";
          return `## Branches\n\n${branches.join("\n")}`;
        },
      }),
    },
  };
};
