import { type Plugin, tool } from "@opencode-ai/plugin";

function buildRegex(pattern: string, flags?: string): RegExp {
  return new RegExp(pattern, flags || "");
}

function formatMatch(match: RegExpExecArray, index: number): string {
  const lines: string[] = [];
  lines.push(`Match ${index + 1}: "${match[0]}" (index ${match.index}–${match.index + match[0].length - 1})`);
  for (let i = 1; i < match.length; i++) {
    lines.push(`  Group ${i}: ${match[i] === undefined ? "(not captured)" : `"${match[i]}"`}`);
  }
  if (match.groups) {
    for (const [name, value] of Object.entries(match.groups)) {
      lines.push(`  Named "${name}": ${value === undefined ? "(not captured)" : `"${value}"`}`);
    }
  }
  return lines.join("\n");
}

export const RegexTesterPlugin: Plugin = async () => {
  return {
    tool: {
      regex_test: tool({
        description:
          "Test a regular expression against a string. Returns all matches with groups and indices. Use this to verify regex patterns work correctly before using them in code.",
        args: {
          pattern: tool.schema.string().describe("Regular expression pattern (without delimiters)"),
          flags: tool.schema.string().optional().describe("Regex flags (g, i, m, s, u, v, d). Defaults to 'g'"),
          input: tool.schema.string().describe("Input string to test against"),
        },
        async execute(args) {
          try {
            const flags = args.flags ?? "g";
            const re = buildRegex(args.pattern, flags);
            const results: string[] = [];
            results.push(`Pattern: /${args.pattern}/${flags}`);
            results.push(`Input: "${args.input}"`);
            results.push("");

            if (flags.includes("g")) {
              const matches: RegExpExecArray[] = [];
              let m: RegExpExecArray | null;
              while ((m = re.exec(args.input)) !== null) {
                matches.push(m);
                if (!m[0].length) re.lastIndex++; // prevent infinite loop on zero-length matches
              }
              if (matches.length === 0) {
                results.push("No matches.");
              } else {
                results.push(`${matches.length} match${matches.length > 1 ? "es" : ""}:`);
                results.push("");
                matches.forEach((match, i) => results.push(formatMatch(match, i)));
              }
            } else {
              const m = re.exec(args.input);
              if (!m) {
                results.push("No match.");
              } else {
                results.push("1 match:");
                results.push("");
                results.push(formatMatch(m, 0));
              }
            }

            return results.join("\n");
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
      }),

      regex_replace: tool({
        description:
          "Test a regex replacement. Shows the result of replacing matches in the input string. Useful for verifying substitution patterns ($1, $2, named groups, etc.).",
        args: {
          pattern: tool.schema.string().describe("Regular expression pattern (without delimiters)"),
          flags: tool.schema.string().optional().describe("Regex flags. Defaults to 'g'"),
          input: tool.schema.string().describe("Input string"),
          replacement: tool.schema.string().describe("Replacement string (supports $1, $2, $<name>, $&, etc.)"),
        },
        async execute(args) {
          try {
            const flags = args.flags ?? "g";
            const re = buildRegex(args.pattern, flags);
            const result = args.input.replace(re, args.replacement);
            const lines: string[] = [];
            lines.push(`Pattern: /${args.pattern}/${flags}`);
            lines.push(`Replace: "${args.replacement}"`);
            lines.push(`Input:   "${args.input}"`);
            lines.push(`Output:  "${result}"`);
            if (result === args.input) {
              lines.push("");
              lines.push("(no change — pattern did not match)");
            }
            return lines.join("\n");
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
      }),

      regex_explain: tool({
        description:
          "Break down a regular expression into human-readable parts. Explains each token, quantifier, group, and assertion in the pattern.",
        args: {
          pattern: tool.schema.string().describe("Regular expression pattern to explain"),
          flags: tool.schema.string().optional().describe("Regex flags for context"),
        },
        async execute(args) {
          const flags = args.flags || "";
          const lines: string[] = [];
          lines.push(`Pattern: /${args.pattern}/${flags}`);
          lines.push("");

          // Validate first
          try {
            new RegExp(args.pattern, flags);
          } catch (e: any) {
            return `Invalid regex: ${e.message}`;
          }

          if (flags) {
            lines.push("Flags:");
            const flagDescriptions: Record<string, string> = {
              g: "global — find all matches, not just the first",
              i: "case-insensitive matching",
              m: "multiline — ^ and $ match line boundaries",
              s: "dotAll — . matches newline characters",
              u: "unicode — enable full Unicode matching",
              v: "unicodeSets — extended Unicode character classes",
              d: "hasIndices — include match index info",
              y: "sticky — match only at lastIndex position",
            };
            for (const f of flags) {
              lines.push(`  ${f} — ${flagDescriptions[f] || "unknown flag"}`);
            }
            lines.push("");
          }

          lines.push("Breakdown:");
          const tokens = tokenize(args.pattern);
          for (const token of tokens) {
            lines.push(`  ${token.raw.padEnd(20)} ${token.description}`);
          }

          return lines.join("\n");
        },
      }),
    },
  };
};

interface Token {
  raw: string;
  description: string;
}

function tokenize(pattern: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    // Escaped characters
    if (ch === "\\") {
      const next = pattern[i + 1];
      if (!next) {
        tokens.push({ raw: "\\", description: "trailing backslash (invalid)" });
        i++;
        continue;
      }
      const escapes: Record<string, string> = {
        d: "digit [0-9]",
        D: "non-digit [^0-9]",
        w: "word character [a-zA-Z0-9_]",
        W: "non-word character [^a-zA-Z0-9_]",
        s: "whitespace [\\t\\n\\r\\f\\v ]",
        S: "non-whitespace",
        b: "word boundary",
        B: "non-word boundary",
        n: "newline",
        r: "carriage return",
        t: "tab",
        "0": "null character",
      };
      if (escapes[next]) {
        tokens.push({ raw: `\\${next}`, description: escapes[next] });
        i += 2;
      } else if (next >= "1" && next <= "9") {
        tokens.push({ raw: `\\${next}`, description: `backreference to group ${next}` });
        i += 2;
      } else {
        tokens.push({ raw: `\\${next}`, description: `literal "${next}"` });
        i += 2;
      }
      continue;
    }

    // Character class
    if (ch === "[") {
      let j = i + 1;
      if (pattern[j] === "^") j++;
      if (pattern[j] === "]") j++; // ] right after [ or [^ is literal
      while (j < pattern.length && pattern[j] !== "]") {
        if (pattern[j] === "\\") j++; // skip escaped char
        j++;
      }
      const raw = pattern.slice(i, j + 1);
      const negated = pattern[i + 1] === "^";
      tokens.push({ raw, description: `${negated ? "negated " : ""}character class` });
      i = j + 1;
      continue;
    }

    // Groups
    if (ch === "(") {
      if (pattern.slice(i, i + 3) === "(?:") {
        tokens.push({ raw: "(?:", description: "non-capturing group start" });
        i += 3;
      } else if (pattern.slice(i, i + 4) === "(?<=") {
        tokens.push({ raw: "(?<=", description: "positive lookbehind start" });
        i += 4;
      } else if (pattern.slice(i, i + 4) === "(?<!") {
        tokens.push({ raw: "(?<!", description: "negative lookbehind start" });
        i += 4;
      } else if (pattern.slice(i, i + 3) === "(?=") {
        tokens.push({ raw: "(?=", description: "positive lookahead start" });
        i += 3;
      } else if (pattern.slice(i, i + 3) === "(?!") {
        tokens.push({ raw: "(?!", description: "negative lookahead start" });
        i += 3;
      } else if (pattern[i + 1] === "?" && pattern[i + 2] === "<" && pattern[i + 3] !== "=" && pattern[i + 3] !== "!") {
        const nameEnd = pattern.indexOf(">", i + 3);
        const name = pattern.slice(i + 3, nameEnd);
        tokens.push({ raw: pattern.slice(i, nameEnd + 1), description: `named capturing group "${name}" start` });
        i = nameEnd + 1;
      } else {
        tokens.push({ raw: "(", description: "capturing group start" });
        i++;
      }
      continue;
    }

    if (ch === ")") {
      tokens.push({ raw: ")", description: "group end" });
      i++;
      continue;
    }

    // Quantifiers
    if (ch === "{") {
      const qMatch = pattern.slice(i).match(/^\{(\d+)(,(\d*))?\}/);
      if (qMatch) {
        const raw = qMatch[0];
        const min = qMatch[1];
        const hasComma = qMatch[2] !== undefined;
        const max = qMatch[3];
        let desc: string;
        if (!hasComma) desc = `exactly ${min} times`;
        else if (!max) desc = `${min} or more times`;
        else desc = `${min} to ${max} times`;
        tokens.push({ raw, description: desc });
        i += raw.length;
        continue;
      }
      tokens.push({ raw: "{", description: 'literal "{"' });
      i++;
      continue;
    }

    // Simple tokens
    const simple: Record<string, string> = {
      ".": "any character (except newline unless s flag)",
      "^": "start of string/line",
      $: "end of string/line",
      "*": "0 or more (greedy)",
      "+": "1 or more (greedy)",
      "?": "0 or 1 (greedy) / makes preceding quantifier lazy",
      "|": "alternation (OR)",
    };
    if (simple[ch]) {
      // Check for lazy/possessive modifier
      if ((ch === "*" || ch === "+" || ch === "?") && pattern[i + 1] === "?") {
        tokens.push({ raw: ch + "?", description: simple[ch].replace("greedy", "lazy") });
        i += 2;
      } else {
        tokens.push({ raw: ch, description: simple[ch] });
        i++;
      }
      continue;
    }

    // Literal character
    tokens.push({ raw: ch, description: `literal "${ch}"` });
    i++;
  }

  return tokens;
}
