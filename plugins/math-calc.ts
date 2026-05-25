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
  // Reject anything that looks like code injection
  const forbidden = /[;{}\[\]`'"\$\\]|function|return|var|let|const|import|export|require|process|global|this/i;
  if (forbidden.test(expression)) {
    return "Error: Expression contains forbidden characters or keywords";
  }

  // Allow: numbers, operators, parens, dots, commas, whitespace, Math functions, common constants
  const allowed = /^[\d\s+\-*/%.(),^|&~!<>=?:a-zA-Z_]+$/;
  if (!allowed.test(expression)) {
    return "Error: Expression contains invalid characters";
  }

  try {
    // Expose Math functions at top level
    const mathFns = Object.getOwnPropertyNames(Math)
      .map((k) => `const ${k} = Math.${k};`)
      .join(" ");
    const fn = new Function(`${mathFns} return (${expression});`);
    const result = fn();
    if (typeof result === "number" || typeof result === "bigint") {
      return `${expression} = ${result}`;
    }
    if (typeof result === "boolean") {
      return `${expression} = ${result}`;
    }
    return `Error: Expression did not produce a number (got ${typeof result})`;
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
