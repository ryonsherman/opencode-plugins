import { type Plugin, tool } from "@opencode-ai/plugin";

type Edit = { type: "equal" | "insert" | "delete"; value: string };

function shortestEdit(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v = new Array(2 * max + 1).fill(0);
  v[1 + max] = 0; // offset index by max
  const trace: number[][] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])) {
        x = v[k + 1 + max]; // move down
      } else {
        x = v[k - 1 + max] + 1; // move right
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + max] = x;
      if (x === n && y === m) {
        return trace;
      }
    }
  }
  return trace;
}

function backtrack(trace: number[][], a: string[], b: string[]): Edit[] {
  let x = a.length;
  let y = b.length;
  const max = a.length + b.length;
  const edits: Edit[] = [];

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;

    let prevK: number;
    if (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = v[prevK + max];
    const prevY = prevX - prevK;

    // Diagonal moves (equals)
    while (x > prevX && y > prevY) {
      x--;
      y--;
      edits.push({ type: "equal", value: a[x] });
    }

    if (d > 0) {
      if (x === prevX) {
        // moved down: insert
        y--;
        edits.push({ type: "insert", value: b[y] });
      } else {
        // moved right: delete
        x--;
        edits.push({ type: "delete", value: a[x] });
      }
    }
  }

  return edits.reverse();
}

function myersDiff(a: string[], b: string[]): Edit[] {
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return b.map(v => ({ type: "insert" as const, value: v }));
  if (b.length === 0) return a.map(v => ({ type: "delete" as const, value: v }));
  const trace = shortestEdit(a, b);
  return backtrack(trace, a, b);
}

function formatUnified(edits: Edit[], context: number): string {
  const lines: string[] = [];
  for (let i = 0; i < edits.length; i++) {
    const { type, value } = edits[i];
    if (type === "equal") {
      let nearChange = false;
      for (let j = Math.max(0, i - context); j <= Math.min(edits.length - 1, i + context); j++) {
        if (edits[j].type !== "equal") { nearChange = true; break; }
      }
      if (nearChange) lines.push(` ${value}`);
    } else if (type === "delete") {
      lines.push(`-${value}`);
    } else {
      lines.push(`+${value}`);
    }
  }
  return lines.join("\n");
}

function stats(edits: Edit[]) {
  let additions = 0, deletions = 0, unchanged = 0;
  for (const e of edits) {
    if (e.type === "insert") additions++;
    else if (e.type === "delete") deletions++;
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

          const edits = myersDiff(a, b);
          const s = stats(edits);
          const diff = formatUnified(edits, context);

          return `${diff}\n\n---\n${s.additions} addition(s), ${s.deletions} deletion(s), ${s.unchanged} unchanged line(s)`;
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
          const edits = myersDiff(a, b);

          // Group consecutive edits of same type
          const segments: { type: string; text: string }[] = [];
          for (const e of edits) {
            if (segments.length > 0 && segments[segments.length - 1].type === e.type) {
              segments[segments.length - 1].text += e.value;
            } else {
              segments.push({ type: e.type, text: e.value });
            }
          }

          const parts = segments.map((s) => {
            if (s.type === "equal") return s.text;
            if (s.type === "delete") return `[-${s.text}-]`;
            return `{+${s.text}+}`;
          });

          const s = stats(edits);
          return `${parts.join("")}\n\n---\n${s.additions} char(s) added, ${s.deletions} char(s) removed, ${s.unchanged} unchanged`;
        },
      }),
    },
  };
};
