// Timezone helpers based on Intl (no floating money involved).

function partsIn(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(date)) p[x.type] = x.value;
  const required = (key: string): number => {
    const value = p[key];
    if (value === undefined) throw new Error(`Missing date part: ${key}`);
    return Number(value);
  };
  return {
    y: required("year"), mo: required("month"), d: required("day"),
    h: required("hour") % 24, mi: required("minute"), s: required("second"),
  };
}

function offsetMs(date: Date, tz: string): number {
  const p = partsIn(date, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

const pad = (n: number) => n.toString().padStart(2, "0");

/** Local wall time (YYYY-MM-DD, HH:mm) in tz → UTC Date. */
export function zonedToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const [y = NaN, mo = NaN, d = NaN] = dateStr.split("-").map(Number);
  const [h = NaN, mi = NaN] = (timeStr || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const off1 = offsetMs(new Date(guess), tz);
  let t = guess - off1;
  const off2 = offsetMs(new Date(t), tz);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

/** UTC instant → local {date, time} in tz. */
export function utcToZoned(input: Date | string, tz: string): { date: string; time: string } {
  const p = partsIn(typeof input === "string" ? new Date(input) : input, tz);
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

export function todayIn(tz: string, now: Date = new Date()): string {
  return utcToZoned(now, tz).date;
}

export function addDays(dateStr: string, n: number): string {
  const [y = NaN, m = NaN, d = NaN] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function monthRange(month: string): { from: string; to: string; days: number } {
  const [y = NaN, m = NaN] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(days)}`, days };
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return addDays(s, 0) === s;
}

export function isValidTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
export function formatDateZh(dateStr: string): string {
  const [y = NaN, m = NaN, d = NaN] = dateStr.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${y}年${m}月${d}日（${WEEK[wd]}）`;
}

export const TIMEZONES = [
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Europe/London",
  "Europe/Paris",
  "America/Los_Angeles",
  "America/New_York",
  "Australia/Sydney",
  "UTC",
];
