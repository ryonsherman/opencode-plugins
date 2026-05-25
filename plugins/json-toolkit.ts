import { type Plugin, tool } from "@opencode-ai/plugin";

function queryPath(obj: any, path: string): any {
  const segments: (string | number)[] = [];
  const re = /([^.\[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) segments.push(m[1]);
    else if (m[2] !== undefined) segments.push(Number(m[2]));
  }
  let current = obj;
  for (const seg of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[seg];
  }
  return current;
}

export const JsonToolkitPlugin: Plugin = async () => {
  return {
    tool: {
      json_validate: tool({
        description:
          "Validate a JSON string. Returns success or the parse error with position details.",
        args: {
          input: tool.schema.string().describe("JSON string to validate"),
        },
        async execute(args) {
          try {
            JSON.parse(args.input);
            return "Valid JSON";
          } catch (e: any) {
            return `Invalid JSON: ${e.message}`;
          }
        },
      }),

      json_format: tool({
        description:
          "Pretty-print a JSON string with configurable indentation.",
        args: {
          input: tool.schema.string().describe("JSON string to format"),
          indent: tool.schema
            .number()
            .optional()
            .describe("Number of spaces for indentation (default: 2)"),
        },
        async execute(args) {
          try {
            const parsed = JSON.parse(args.input);
            return JSON.stringify(parsed, null, args.indent ?? 2);
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
      }),

      json_minify: tool({
        description: "Minify a JSON string by removing all whitespace.",
        args: {
          input: tool.schema.string().describe("JSON string to minify"),
        },
        async execute(args) {
          try {
            const parsed = JSON.parse(args.input);
            return JSON.stringify(parsed);
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
      }),

      json_query: tool({
        description:
          "Query a value from a JSON string using a dot/bracket path. Examples: 'name', 'users[0].email', 'config.database.host'.",
        args: {
          input: tool.schema.string().describe("JSON string to query"),
          path: tool.schema
            .string()
            .describe("Dot/bracket path to the value (e.g. 'data.items[0].id')"),
        },
        async execute(args) {
          try {
            const parsed = JSON.parse(args.input);
            const result = queryPath(parsed, args.path);
            if (result === undefined) return `No value found at path: ${args.path}`;
            return typeof result === "object"
              ? JSON.stringify(result, null, 2)
              : String(result);
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
      }),
    },
  };
};
