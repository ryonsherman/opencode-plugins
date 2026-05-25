import { type Plugin, tool } from "@opencode-ai/plugin";
import { createHash, createHmac } from "crypto";

export const HashEncodePlugin: Plugin = async () => {
  return {
    tool: {
      hash: tool({
        description:
          "Compute a cryptographic hash of a string. Supports md5, sha1, sha256, sha512. Returns hex digest by default.",
        args: {
          input: tool.schema.string().describe("String to hash"),
          algorithm: tool.schema.string().optional().describe("Hash algorithm: md5, sha1, sha256 (default), sha512"),
          encoding: tool.schema.string().optional().describe("Output encoding: hex (default), base64"),
        },
        async execute(args) {
          const algo = args.algorithm || "sha256";
          const enc = (args.encoding || "hex") as "hex" | "base64";
          try {
            const result = createHash(algo).update(args.input).digest(enc);
            return `${algo}(${enc}): ${result}`;
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
      }),

      hmac: tool({
        description: "Compute an HMAC signature. Supports md5, sha1, sha256, sha512.",
        args: {
          input: tool.schema.string().describe("String to sign"),
          key: tool.schema.string().describe("Secret key"),
          algorithm: tool.schema.string().optional().describe("Hash algorithm: md5, sha1, sha256 (default), sha512"),
          encoding: tool.schema.string().optional().describe("Output encoding: hex (default), base64"),
        },
        async execute(args) {
          const algo = args.algorithm || "sha256";
          const enc = (args.encoding || "hex") as "hex" | "base64";
          try {
            const result = createHmac(algo, args.key).update(args.input).digest(enc);
            return `HMAC-${algo}(${enc}): ${result}`;
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
      }),

      encode: tool({
        description:
          "Encode or decode a string. Supports base64, url, and hex. Specify direction: encode (default) or decode.",
        args: {
          input: tool.schema.string().describe("String to encode/decode"),
          format: tool.schema.string().optional().describe("Format: base64 (default), url, hex"),
          decode: tool.schema.boolean().optional().describe("If true, decode instead of encode"),
        },
        async execute(args) {
          const format = args.format || "base64";
          const direction = args.decode ? "decode" : "encode";
          try {
            let result: string;
            switch (format) {
              case "base64":
                result = args.decode
                  ? Buffer.from(args.input, "base64").toString("utf-8")
                  : Buffer.from(args.input).toString("base64");
                break;
              case "url":
                result = args.decode ? decodeURIComponent(args.input) : encodeURIComponent(args.input);
                break;
              case "hex":
                result = args.decode
                  ? Buffer.from(args.input, "hex").toString("utf-8")
                  : Buffer.from(args.input).toString("hex");
                break;
              default:
                return `Unknown format: ${format}. Use base64, url, or hex.`;
            }
            return `${format} ${direction}: ${result}`;
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
      }),
    },
  };
};
