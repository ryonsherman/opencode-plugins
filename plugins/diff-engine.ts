import { type Plugin, tool } from "@opencode-ai/plugin";

type DiffOp = [number, string]; // [0=equal, -1=remove, 1=add, value]

function myersDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v: number[] = new Array(2 * max + 1);
  const trace: number[][] = [];
  v[max + 1] = 0;

  for (let d = 0; d <= max; d++) {
    trace.push([...v]);
    for (let k = -d; k <= d; k += 2) {
      const idx = k + max;
      let x: number;
      if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) {
        x = v[idx + 1];
      } else {
        x = v[idx - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[idx] = x;
      if (x >= n && y >= m) {
        return backtrack(trace, a, b, max);
      }
    }
  }
  return backtrack(trace, a, b, max);
}

function backtrack(trace: number[][], a: string[], b: string[], max: number): DiffOp[] {
  const ops: DiffOp[] = [];
  let x = a.length;
  let y = b.length;

  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d - 1];
    const k = x - y;
    const idx = k + max;
    let prevK: number;
    if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[prevK + max];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push([0, a[x]]);
    }
    if (x > prevX) {
      x--;
      ops.push([-1, a[x]]);
    } else if (y > prevY) {
      y--;
      ops.push([1, b[y]]);
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push([0, a[x]]);
  }
  return ops.reverse();
}

function formatUnified(ops: DiffOp[], context: number): string {
  const lines: string[] = [];
  for (let i = 0; i < ops.length; i++) {
    const [type, value] = ops[i];
    if (type === 0) {
      // Check if this equal line is within context range of a change
      let nearChange = false;
      for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) {
        if (ops[j][0] !== 0) { nearChange = true; break; }
      }
      if (nearChange) lines.push(` ${value}`);
    } else if (type === -1) {
      lines.push(`-${value}`);
    } else {
      lines.push(`+${value}`);
    }
  }
  return lines.join("\n");
}

function diffStats(ops: DiffOp[]): { additions: number; deletions: number; unchanged: number } {
  let additions = 0, deletions = 0, unchanged = 0;
  for (const [type] of ops) {
    if (type === 1) additions++;
    else if (type === -1) deletions++;
    else unchanged++;
  }
  return { additions, deletions, unchanged };
}

export const DiffEnginePlugin: Plugin = async () => {
  return {
    tool: {
      diff_lines: tool({
        description:
          "Compare two strings line-by-line using Myers diff algorithm. Returns unified diff output showing additions (+), deletions (-), and context lines. Use this for accurate text comparison instead of eyeballing differences.",
        args: {
          old_text: tool.schema.string().describe("Original text (the 'before' version)"),
          new_text: tool.schema.string().describe("Modified text (the 'after' version)"),
          context: tool.schema.number().optional().describe("Number of context lines around changes (default: 3)"),
        },
        async execute(args, ctx) {
          const context = args.context ?? 3;
          const a = args.old_text.split("\n");
          const b = args.new_text.split("\n");

          if (args.old_text === args.new_text) {
            return "No differences found.";
          }

          const ops = myersDiff(a, b);
          const stats = diffStats(ops);
          const diff = formatUnified(ops, context);

          return `${diff}\n\n---\n${stats.additions} addition(s), ${stats.deletions} deletion(s), ${stats.unchanged} unchanged line(s)`;
        },
      }),

      diff_chars: tool({
        description:
          "Compare two strings character-by-character using Myers diff algorithm. Best for short strings where line-level diff is too coarse (e.g. variable names, single-line values, typos).",
        args: {
          old_text: tool.schema.string().describe("Original text"),
          new_text: tool.schema.string().describe("Modified text"),
        },
        async execute(args, ctx) {
          if (args.old_text === args.new_text) {
            return "No differences found.";
          }

          const a = args.old_text.split("");
          const b = args.new_text.split("");
          const ops = myersDiff(a, b);

          // Group consecutive ops of same type
          const segments: { type: number; text: string }[] = [];
          for (const [type, ch] of ops) {
            if (segments.length > 0 && segments[segments.length - 1].type === type) {
              segments[segments.length - 1].text += ch;
            } else {
              segments.push({ type, text: ch });
            }
          }

          const parts = segments.map((s) => {
            if (s.type === 0) return s.text;
            if (s.type === -1) return `[-${s.text}-]`;
            return `{+${s.text}+}`;
          });

          const stats = diffStats(ops);
          return `${parts.join("")}\n\n---\n${stats.additions} char(s) added, ${stats.deletions} char(s) removed, ${stats.unchanged} unchanged`;
        },
      }),
    },
  };
};
