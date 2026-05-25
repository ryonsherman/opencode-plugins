import { type Plugin, tool } from "@opencode-ai/plugin";

function parseDate(input: string): Date | null {
  if (!input || input.toLowerCase() === "now") return new Date();
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return d;
}

interface Duration {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function parseDuration(input: string): Duration | null {
  const dur: Duration = { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
  const re = /(-?\d+(?:\.\d+)?)\s*(y(?:ears?)?|mo(?:nths?)?|w(?:eeks?)?|d(?:ays?)?|h(?:ours?|r)?|m(?:in(?:utes?)?)?|s(?:ec(?:onds?)?)?)/gi;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    matched = true;
    const val = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit.startsWith("y")) dur.years += val;
    else if (unit.startsWith("mo")) dur.months += val;
    else if (unit.startsWith("w")) dur.weeks += val;
    else if (unit.startsWith("d")) dur.days += val;
    else if (unit.startsWith("h")) dur.hours += val;
    else if (unit.startsWith("m")) dur.minutes += val;
    else if (unit.startsWith("s")) dur.seconds += val;
  }
  return matched ? dur : null;
}

function addDuration(date: Date, dur: Duration, subtract: boolean = false): Date {
  const sign = subtract ? -1 : 1;
  const result = new Date(date);
  if (dur.years) {
    const dayOfMonth = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCFullYear(result.getUTCFullYear() + sign * dur.years);
    const maxDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(dayOfMonth, maxDay));
  }
  if (dur.months) {
    const dayOfMonth = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + sign * dur.months);
    const maxDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(dayOfMonth, maxDay));
  }
  if (dur.weeks) result.setUTCDate(result.getUTCDate() + sign * dur.weeks * 7);
  if (dur.days) result.setUTCDate(result.getUTCDate() + sign * dur.days);
  if (dur.hours) result.setUTCHours(result.getUTCHours() + sign * dur.hours);
  if (dur.minutes) result.setUTCMinutes(result.getUTCMinutes() + sign * dur.minutes);
  if (dur.seconds) result.setUTCSeconds(result.getUTCSeconds() + sign * dur.seconds);
  return result;
}

function dateDiff(from: Date, to: Date): string {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  let months = to.getUTCMonth() - from.getUTCMonth();
  let days = to.getUTCDate() - from.getUTCDate();

  if (days < 0) {
    months--;
    const prevMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0));
    days += prevMonth.getUTCDate();
  }
  if (months < 0) {
    years--;
    months += 12;
  }

  const fromAdjusted = new Date(from);
  fromAdjusted.setUTCFullYear(fromAdjusted.getUTCFullYear() + years);
  fromAdjusted.setUTCMonth(fromAdjusted.getUTCMonth() + months);
  fromAdjusted.setUTCDate(fromAdjusted.getUTCDate() + days);

  let diff = to.getTime() - fromAdjusted.getTime();
  const hours = Math.floor(diff / 3600000);
  diff %= 3600000;
  const minutes = Math.floor(diff / 60000);
  diff %= 60000;
  const seconds = Math.floor(diff / 1000);

  const totalMs = to.getTime() - from.getTime();
  const totalDays = Math.floor(totalMs / 86400000);
  const totalHours = Math.floor(totalMs / 3600000);
  const totalMinutes = Math.floor(totalMs / 60000);
  const totalSeconds = Math.floor(totalMs / 1000);

  const parts: string[] = [];
  if (years) parts.push(`${years} year${years !== 1 ? "s" : ""}`);
  if (months) parts.push(`${months} month${months !== 1 ? "s" : ""}`);
  if (days) parts.push(`${days} day${days !== 1 ? "s" : ""}`);
  if (hours) parts.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
  if (minutes) parts.push(`${minutes} minute${minutes !== 1 ? "s" : ""}`);
  if (seconds) parts.push(`${seconds} second${seconds !== 1 ? "s" : ""}`);

  const human = parts.length > 0 ? parts.join(", ") : "0 seconds";

  let out = `**Difference:** ${human}\n\n`;
  out += `| Unit | Total |\n|------|-------|\n`;
  out += `| Days | ${totalDays} |\n`;
  out += `| Hours | ${totalHours} |\n`;
  out += `| Minutes | ${totalMinutes} |\n`;
  out += `| Seconds | ${totalSeconds} |\n`;
  out += `| Milliseconds | ${totalMs} |`;
  return out;
}

function formatInTimezone(date: Date, timezone: string): string {
  try {
    return date.toLocaleString("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "short",
    });
  } catch (e: any) {
    return `Error: Invalid timezone "${timezone}" — ${e.message}`;
  }
}

function convertTimeUnit(value: number, from: string, to: string): string {
  const units: Record<string, number> = {
    ns: 1e-9, us: 1e-6, ms: 0.001, s: 1, sec: 1, min: 60, hr: 3600, h: 3600,
    day: 86400, d: 86400, week: 604800, w: 604800,
  };
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  if (!(f in units)) return `Unknown time unit: ${from}`;
  if (!(t in units)) return `Unknown time unit: ${to}`;
  const result = (value * units[f]) / units[t];
  return `${value} ${from} = ${result} ${to}`;
}

export const TimeCalcPlugin: Plugin = async () => {
  return {
    tool: {
      time_calc: tool({
        description:
          "Add or subtract a duration from a date. Calendar-aware (handles months/leap years correctly). Duration format: '3y 2mo 5d 4h 30m 10s'. Use '-' prefix on values to subtract, or set subtract=true.",
        args: {
          date: tool.schema.string().describe("Starting date (ISO 8601, or 'now'). Default: now"),
          duration: tool.schema.string().describe("Duration to add (e.g. '3mo 2d', '1y 6mo', '4h 30m')"),
          subtract: tool.schema.boolean().optional().describe("Subtract instead of add (default: false)"),
        },
        async execute(args) {
          const date = parseDate(args.date || "now");
          if (!date) return `Error: Could not parse date "${args.date}"`;
          const dur = parseDuration(args.duration);
          if (!dur) return `Error: Could not parse duration "${args.duration}". Use format like '3y 2mo 5d 4h 30m 10s'`;
          const result = addDuration(date, dur, args.subtract || false);
          const op = args.subtract ? "-" : "+";
          return `${date.toISOString()} ${op} ${args.duration} = ${result.toISOString()}`;
        },
      }),

      time_diff: tool({
        description:
          "Calculate the difference between two dates. Returns human-readable breakdown and totals in days/hours/minutes/seconds.",
        args: {
          from: tool.schema.string().describe("Start date (ISO 8601, or 'now')"),
          to: tool.schema.string().describe("End date (ISO 8601, or 'now')"),
        },
        async execute(args) {
          const fromDate = parseDate(args.from);
          const toDate = parseDate(args.to);
          if (!fromDate) return `Error: Could not parse from date "${args.from}"`;
          if (!toDate) return `Error: Could not parse to date "${args.to}"`;
          const swapped = fromDate > toDate;
          const [earlier, later] = swapped ? [toDate, fromDate] : [fromDate, toDate];
          let result = dateDiff(earlier, later);
          if (swapped) result = `(negative — from > to)\n\n${result}`;
          return result;
        },
      }),

      time_now: tool({
        description:
          "Get the current date/time, optionally in a specific timezone.",
        args: {
          timezone: tool.schema.string().optional().describe("IANA timezone (e.g. 'America/New_York', 'UTC', 'Asia/Tokyo'). Default: local"),
        },
        async execute(args) {
          const now = new Date();
          if (args.timezone) {
            return formatInTimezone(now, args.timezone);
          }
          return now.toISOString();
        },
      }),

      time_convert: tool({
        description:
          "Convert a timestamp between timezones, or convert time duration units (ns, us, ms, s, min, hr, day, week).",
        args: {
          value: tool.schema.string().describe("A timestamp (ISO 8601) to convert between timezones, OR a number for unit conversion"),
          from: tool.schema.string().describe("Source timezone (IANA) or time unit (ns, us, ms, s, min, hr, day, week)"),
          to: tool.schema.string().describe("Target timezone (IANA) or time unit"),
        },
        async execute(args) {
          // Try as unit conversion first
          const num = parseFloat(args.value);
          const timeUnits = ["ns", "us", "ms", "s", "sec", "min", "hr", "h", "day", "d", "week", "w"];
          if (!isNaN(num) && timeUnits.includes(args.from.toLowerCase())) {
            return convertTimeUnit(num, args.from, args.to);
          }

          // Otherwise treat as timezone conversion
          const date = parseDate(args.value);
          if (!date) return `Error: Could not parse "${args.value}" as date or number`;
          const fromStr = formatInTimezone(date, args.from);
          const toStr = formatInTimezone(date, args.to);
          if (fromStr.startsWith("Error")) return fromStr;
          if (toStr.startsWith("Error")) return toStr;
          return `${fromStr}\n→ ${toStr}`;
        },
      }),
    },
  };
};
