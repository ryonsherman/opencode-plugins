import { type Plugin, tool } from "@opencode-ai/plugin";

const UNIT_TABLE: Record<string, Record<string, number>> = {
  // Bytes - binary (base: bytes)
  bytes: { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4, pb: 1024 ** 5 },
  // Distance (base: meters)
  distance: { nm: 0.000000001, um: 0.000001, mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852 },
  // Weight (base: grams)
  weight: { mg: 0.001, g: 1, kg: 1000, oz: 28.3495, lb: 453.592, ton: 907185, tonne: 1000000 },
  // Volume (base: milliliters)
  volume: { ml: 1, l: 1000, gal: 3785.41, qt: 946.353, pt: 473.176, cup: 236.588, floz: 29.5735, tbsp: 14.7868, tsp: 4.92892 },
  // Speed (base: m/s)
  speed: { "m/s": 1, "km/h": 0.277778, "mi/h": 0.44704, mph: 0.44704, kn: 0.514444, "ft/s": 0.3048 },
  // Data rate (base: bits/second)
  datarate: { bps: 1, kbps: 1000, mbps: 1000000, gbps: 1000000000, "b/s": 8, "kb/s": 8000, "mb/s": 8000000, "gb/s": 8000000000 },
  // Area (base: sq meters)
  area: { sqmm: 0.000001, sqcm: 0.0001, sqm: 1, sqkm: 1000000, sqft: 0.092903, sqyd: 0.836127, sqmi: 2589988, acre: 4046.86, ha: 10000 },
  // Pressure (base: pascals)
  pressure: { pa: 1, kpa: 1000, mpa: 1000000, bar: 100000, atm: 101325, psi: 6894.76, mmhg: 133.322, torr: 133.322 },
  // Energy (base: joules)
  energy: { j: 1, kj: 1000, cal: 4.184, kcal: 4184, wh: 3600, kwh: 3600000, btu: 1055.06, ev: 1.602e-19 },
  // Frequency (base: hertz)
  frequency: { hz: 1, khz: 1000, mhz: 1000000, ghz: 1000000000, rpm: 1/60 },
  // Angle (base: degrees)
  angle: { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360, arcmin: 1/60, arcsec: 1/3600 },
};

function convertTemp(value: number, from: string, to: string): number | null {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  let celsius: number;
  if (f === "c" || f === "celsius") celsius = value;
  else if (f === "f" || f === "fahrenheit") celsius = (value - 32) * 5 / 9;
  else if (f === "k" || f === "kelvin") celsius = value - 273.15;
  else return null;

  if (t === "c" || t === "celsius") return celsius;
  if (t === "f" || t === "fahrenheit") return celsius * 9 / 5 + 32;
  if (t === "k" || t === "kelvin") return celsius + 273.15;
  return null;
}

function findCategory(unit: string): { category: string; key: string } | null {
  const u = unit.toLowerCase();
  for (const [category, units] of Object.entries(UNIT_TABLE)) {
    if (u in units) return { category, key: u };
  }
  return null;
}

function convert(value: number, from: string, to: string): string {
  const f = from.toLowerCase();
  const t = to.toLowerCase();

  // Temperature special case
  const tempResult = convertTemp(value, f, t);
  if (tempResult !== null) return `${value} ${from} = ${tempResult} ${to}`;

  const fromInfo = findCategory(f);
  const toInfo = findCategory(t);

  if (!fromInfo) return `Unknown unit: ${from}`;
  if (!toInfo) return `Unknown unit: ${to}`;
  if (fromInfo.category !== toInfo.category) {
    return `Cannot convert between ${fromInfo.category} and ${toInfo.category}`;
  }

  const units = UNIT_TABLE[fromInfo.category];
  const base = value * units[fromInfo.key];
  const result = base / units[toInfo.key];
  return `${value} ${from} = ${result} ${to}`;
}

function safeEval(expression: string): string {
  // Recursive descent parser — no code execution, only math operations
  const mathConstants: Record<string, number> = {
    PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10,
    LOG2E: Math.LOG2E, LOG10E: Math.LOG10E, SQRT2: Math.SQRT2, SQRT1_2: Math.SQRT1_2,
    Infinity: Infinity, NaN: NaN,
  };
  const mathFunctions: Record<string, (...args: number[]) => number> = {
    abs: Math.abs, acos: Math.acos, acosh: Math.acosh, asin: Math.asin,
    asinh: Math.asinh, atan: Math.atan, atanh: Math.atanh, atan2: Math.atan2,
    cbrt: Math.cbrt, ceil: Math.ceil, clz32: Math.clz32, cos: Math.cos,
    cosh: Math.cosh, exp: Math.exp, expm1: Math.expm1, floor: Math.floor,
    fround: Math.fround, hypot: Math.hypot, imul: Math.imul, log: Math.log,
    log1p: Math.log1p, log2: Math.log2, log10: Math.log10, max: Math.max,
    min: Math.min, pow: Math.pow, random: Math.random, round: Math.round,
    sign: Math.sign, sin: Math.sin, sinh: Math.sinh, sqrt: Math.sqrt,
    tan: Math.tan, tanh: Math.tanh, trunc: Math.trunc,
  };

  let pos = 0;
  const input = expression.trim();

  function peek(): string { return input[pos] || ""; }
  function advance(): string { return input[pos++]; }
  function skipWhitespace(): void { while (pos < input.length && /\s/.test(input[pos])) pos++; }

  function parseExpression(): number {
    return parseTernary();
  }

  function parseTernary(): number {
    const cond = parseOr();
    skipWhitespace();
    if (peek() === "?") {
      advance(); skipWhitespace();
      const thenVal = parseExpression();
      skipWhitespace();
      if (peek() !== ":") throw new Error("Expected ':' in ternary");
      advance(); skipWhitespace();
      const elseVal = parseExpression();
      return cond ? thenVal : elseVal;
    }
    return cond;
  }

  function parseOr(): number {
    let left = parseAnd();
    skipWhitespace();
    while (pos < input.length - 1 && input[pos] === "|" && input[pos + 1] === "|") {
      pos += 2; skipWhitespace();
      const right = parseAnd();
      left = (left || right) ? 1 : 0;
    }
    return left;
  }

  function parseAnd(): number {
    let left = parseBitwiseOr();
    skipWhitespace();
    while (pos < input.length - 1 && input[pos] === "&" && input[pos + 1] === "&") {
      pos += 2; skipWhitespace();
      const right = parseBitwiseOr();
      left = (left && right) ? 1 : 0;
    }
    return left;
  }

  function parseBitwiseOr(): number {
    let left = parseBitwiseXor();
    skipWhitespace();
    while (peek() === "|" && input[pos + 1] !== "|") {
      advance(); skipWhitespace();
      left = (left | parseBitwiseXor()) >>> 0;
    }
    return left;
  }

  function parseBitwiseXor(): number {
    let left = parseBitwiseAnd();
    skipWhitespace();
    while (peek() === "^" && input[pos + 1] !== "^") {
      advance(); skipWhitespace();
      left = (left ^ parseBitwiseAnd()) >>> 0;
    }
    return left;
  }

  function parseBitwiseAnd(): number {
    let left = parseEquality();
    skipWhitespace();
    while (peek() === "&" && input[pos + 1] !== "&") {
      advance(); skipWhitespace();
      left = (left & parseEquality()) >>> 0;
    }
    return left;
  }

  function parseEquality(): number {
    let left = parseComparison();
    skipWhitespace();
    while (pos < input.length - 1) {
      if (input[pos] === "=" && input[pos + 1] === "=") {
        pos += 2; skipWhitespace();
        left = left === parseComparison() ? 1 : 0;
      } else if (input[pos] === "!" && input[pos + 1] === "=") {
        pos += 2; skipWhitespace();
        left = left !== parseComparison() ? 1 : 0;
      } else break;
    }
    return left;
  }

  function parseComparison(): number {
    let left = parseShift();
    skipWhitespace();
    while (pos < input.length) {
      if (input[pos] === "<" && input[pos + 1] === "=") {
        pos += 2; skipWhitespace(); left = left <= parseShift() ? 1 : 0;
      } else if (input[pos] === ">" && input[pos + 1] === "=") {
        pos += 2; skipWhitespace(); left = left >= parseShift() ? 1 : 0;
      } else if (input[pos] === "<" && input[pos + 1] !== "<") {
        pos += 1; skipWhitespace(); left = left < parseShift() ? 1 : 0;
      } else if (input[pos] === ">" && input[pos + 1] !== ">") {
        pos += 1; skipWhitespace(); left = left > parseShift() ? 1 : 0;
      } else break;
    }
    return left;
  }

  function parseShift(): number {
    let left = parseAddSub();
    skipWhitespace();
    while (pos < input.length - 1) {
      if (input[pos] === "<" && input[pos + 1] === "<") {
        pos += 2; skipWhitespace(); left = left << parseAddSub();
      } else if (input[pos] === ">" && input[pos + 1] === ">" && input[pos + 2] === ">") {
        pos += 3; skipWhitespace(); left = left >>> parseAddSub();
      } else if (input[pos] === ">" && input[pos + 1] === ">") {
        pos += 2; skipWhitespace(); left = left >> parseAddSub();
      } else break;
    }
    return left;
  }

  function parseAddSub(): number {
    let left = parseMulDiv();
    skipWhitespace();
    while (peek() === "+" || peek() === "-") {
      const op = advance(); skipWhitespace();
      const right = parseMulDiv();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseMulDiv(): number {
    let left = parseExponent();
    skipWhitespace();
    while (peek() === "*" && input[pos + 1] !== "*" || peek() === "/" || peek() === "%") {
      const op = advance(); skipWhitespace();
      const right = parseExponent();
      if (op === "*") left = left * right;
      else if (op === "/") left = left / right;
      else left = left % right;
    }
    return left;
  }

  function parseExponent(): number {
    const base = parseUnary();
    skipWhitespace();
    if (pos < input.length - 1 && input[pos] === "*" && input[pos + 1] === "*") {
      pos += 2; skipWhitespace();
      return Math.pow(base, parseExponent()); // right-associative
    }
    return base;
  }

  function parseUnary(): number {
    skipWhitespace();
    if (peek() === "-") { advance(); skipWhitespace(); return -parseUnary(); }
    if (peek() === "+") { advance(); skipWhitespace(); return +parseUnary(); }
    if (peek() === "~") { advance(); skipWhitespace(); return ~parseUnary(); }
    if (peek() === "!") { advance(); skipWhitespace(); return parseUnary() ? 0 : 1; }
    return parseAtom();
  }

  function parseAtom(): number {
    skipWhitespace();

    // Parenthesized expression
    if (peek() === "(") {
      advance(); skipWhitespace();
      const val = parseExpression();
      skipWhitespace();
      if (peek() !== ")") throw new Error("Expected ')'");
      advance();
      return val;
    }

    // Number literal
    if (/[\d.]/.test(peek())) {
      let numStr = "";
      // Handle hex/octal/binary
      if (peek() === "0" && pos + 1 < input.length && /[xXoObB]/.test(input[pos + 1])) {
        numStr += advance() + advance();
        while (pos < input.length && /[\da-fA-F]/.test(input[pos])) numStr += advance();
      } else {
        while (pos < input.length && /[\d.]/.test(input[pos])) numStr += advance();
        if (peek() === "e" || peek() === "E") {
          numStr += advance();
          if (peek() === "+" || peek() === "-") numStr += advance();
          while (pos < input.length && /\d/.test(input[pos])) numStr += advance();
        }
      }
      const num = Number(numStr);
      if (isNaN(num) && numStr !== "NaN") throw new Error(`Invalid number: ${numStr}`);
      return num;
    }

    // Identifier: constant or function call
    if (/[a-zA-Z_]/.test(peek())) {
      let name = "";
      while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) name += advance();
      skipWhitespace();

      // Function call
      if (peek() === "(") {
        const fn = Object.prototype.hasOwnProperty.call(mathFunctions, name) ? mathFunctions[name] : null;
        if (!fn) throw new Error(`Unknown function: ${name}`);
        advance(); skipWhitespace();
        const args: number[] = [];
        if (peek() !== ")") {
          args.push(parseExpression());
          skipWhitespace();
          while (peek() === ",") {
            advance(); skipWhitespace();
            args.push(parseExpression());
            skipWhitespace();
          }
        }
        if (peek() !== ")") throw new Error("Expected ')'");
        advance();
        return fn(...args);
      }

      // Constant
      if (Object.prototype.hasOwnProperty.call(mathConstants, name)) return mathConstants[name];
      throw new Error(`Unknown identifier: ${name}`);
    }

    throw new Error(`Unexpected character: '${peek()}' at position ${pos}`);
  }

  try {
    const result = parseExpression();
    skipWhitespace();
    if (pos < input.length) throw new Error(`Unexpected character: '${peek()}' at position ${pos}`);
    if (typeof result !== "number") return `Error: Expression did not produce a number`;
    return `${expression} = ${result}`;
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export const MathCalcPlugin: Plugin = async () => {
  return {
    tool: {
      math_eval: tool({
        description:
          "Evaluate a math expression. Supports arithmetic (+, -, *, /, %, **), bitwise operators, comparisons, and all Math functions (sqrt, pow, log, sin, cos, tan, PI, E, floor, ceil, round, abs, min, max, etc.).",
        args: {
          expression: tool.schema.string().describe("Math expression to evaluate (e.g. 'sqrt(144) + 2**10', '1024 * 1024 * 3.5')"),
        },
        async execute(args) {
          return safeEval(args.expression);
        },
      }),

      unit_convert: tool({
        description:
          "Convert between units. Supports: bytes (b, kb, mb, gb, tb, pb), distance (nm, um, mm, cm, m, km, in, ft, yd, mi, nmi), weight (mg, g, kg, oz, lb, ton, tonne), volume (ml, l, gal, qt, pt, cup, floz, tbsp, tsp), speed (m/s, km/h, mi/h, mph, kn, ft/s), data rate (bps, kbps, mbps, gbps, b/s, kb/s, mb/s, gb/s), area (sqmm, sqcm, sqm, sqkm, sqft, sqyd, sqmi, acre, ha), pressure (pa, kpa, mpa, bar, atm, psi, mmhg, torr), energy (j, kj, cal, kcal, wh, kwh, btu, ev), frequency (hz, khz, mhz, ghz, rpm), angle (deg, rad, grad, turn, arcmin, arcsec), temperature (c, f, k). For time conversions use time_convert.",
        args: {
          value: tool.schema.number().describe("The numeric value to convert"),
          from: tool.schema.string().describe("Source unit (e.g. 'gb', 'min', 'km', 'f')"),
          to: tool.schema.string().describe("Target unit (e.g. 'mb', 'hr', 'mi', 'c')"),
        },
        async execute(args) {
          return convert(args.value, args.from, args.to);
        },
      }),
    },
  };
};
