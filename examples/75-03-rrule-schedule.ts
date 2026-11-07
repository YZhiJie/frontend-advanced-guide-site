// 文件: examples/75-03-rrule-schedule.ts
// ============ RRULE 重复日程展开器：规则展开 + 例外日期 + 时区边界 + 会议室冲突检测 ============
// 覆盖 RFC 5545 的常用子集：FREQ=DAILY/WEEKLY/MONTHLY、INTERVAL、COUNT、UNTIL、
// BYDAY（周）、BYMONTHDAY（月）、EXDATE（例外日期）。
// 时区处理用 Intl 双程修正法：日程永远按「本地墙钟时间」展开，再换算成 UTC 存储与比较，
// 因此跨夏令时（DST）时本地 9:00 不变、UTC 自动平移——这是日程系统最经典的坑。
// 末尾演示会议室忙闲查询与冲突检测。全部输出确定，硬断言收尾。

// ---------- 1. 时区换算：本地墙钟 → UTC（Intl 双程修正） ----------

/** 求某 UTC 时刻在目标时区的偏移（毫秒），用 Intl 反解，不依赖任何时区数据库文件 */
function tzOffsetMs(timeZone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asIfUtc - utcMs;
}

/** 把「某时区的墙钟时间」换算成 UTC 毫秒；跨 DST 时第一程偏移可能不准，修正一次 */
function wallToUtc(timeZone: string, y: number, mo: number, d: number, h: number, mi: number): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let utc = guess - tzOffsetMs(timeZone, guess);
  const off2 = tzOffsetMs(timeZone, utc);
  if (guess - off2 !== utc) utc = guess - off2; // 第二程修正（DST 切换前后偏移不同）
  return utc;
}

/** 取某 UTC 时刻在目标时区的墙钟日期分量（展开日历天数时按本地日走，不按 24h 走） */
function utcToWall(timeZone: string, utcMs: number) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, wd: p.weekday, h: +p.hour, mi: +p.minute };
}

// ---------- 2. RRULE 解析（子集） ----------

interface RRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number; // 间隔，默认 1
  count?: number; // 总次数（先生成够数，再剔除 EXDATE——与 RFC 5545 一致）
  until?: number; // UTC 毫秒， occurrences 不得晚于它
  byDay?: string[]; // WEEKLY：MO,TU,WE,TH,FR,SA,SU
  byMonthDay?: number[]; // MONTHLY：1..31，无该日的月份跳过（如 2 月没有 31 号）
}

const WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]; // Date.getUTCDay 顺序

function parseRRule(s: string): RRule {
  const kv = Object.fromEntries(s.split(";").map((p) => p.split("=") as [string, string]));
  const rule: RRule = { freq: kv.FREQ as RRule["freq"], interval: kv.INTERVAL ? +kv.INTERVAL : 1 };
  if (kv.COUNT) rule.count = +kv.COUNT;
  if (kv.UNTIL) rule.until = Date.parse(kv.UNTIL.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"));
  if (kv.BYDAY) rule.byDay = kv.BYDAY.split(",");
  if (kv.BYMONTHDAY) rule.byMonthDay = kv.BYMONTHDAY.split(",").map(Number);
  return rule;
}

// ---------- 3. 日程模型与展开 ----------

interface CalendarEvent {
  title: string;
  timeZone: string; // 创建者所在时区（墙钟口径）
  startWall: { y: number; mo: number; d: number; h: number; mi: number }; // 首次开始的墙钟
  durationMin: number;
  rrule: RRule;
  exdates: string[]; // 例外日期，墙钟口径 "YYYY-MM-DD"
}

/** 把墙钟日期平移 n 天（纯日期运算，不涉及时区） */
function addDays(y: number, mo: number, d: number, n: number) {
  const t = new Date(Date.UTC(y, mo - 1, d) + n * 86400_000);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function fmtDay(y: number, mo: number, d: number) {
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 展开窗口内的全部 occurrence 开始时刻（UTC 毫秒，升序） */
function expand(ev: CalendarEvent, winStartUtc: number, winEndUtc: number): number[] {
  const out: number[] = [];
  const exset = new Set(ev.exdates);
  const s = ev.startWall;
  let generated = 0; // 规则已生成的次数（COUNT 口径）

  // 候选日生成器：按 freq 产出墙钟日期序列
  const candidates: { y: number; mo: number; d: number }[] = [];
  if (ev.rrule.freq === "DAILY") {
    for (let i = 0; ; i += ev.rrule.interval) {
      const day = addDays(s.y, s.mo, s.d, i);
      candidates.push(day);
      if (Date.UTC(day.y, day.mo - 1, day.d) > winEndUtc + 86400_000 * 2) break;
      if (candidates.length > 4000) break; // 保险丝
    }
  } else if (ev.rrule.freq === "WEEKLY") {
    const days = ev.rrule.byDay ?? [WD[new Date(Date.UTC(s.y, s.mo - 1, s.d)).getUTCDay()]];
    // 从起始日所在周的周日开始，每周 interval 步进，周内按 BYDAY 逐个生成
    const startWd = new Date(Date.UTC(s.y, s.mo - 1, s.d)).getUTCDay();
    const week0 = addDays(s.y, s.mo, s.d, -startWd); // 起始周的周日
    for (let w = 0; ; w += ev.rrule.interval) {
      for (const wd of days) {
        const day = addDays(week0.y, week0.mo, week0.d, w * 7 + WD.indexOf(wd));
        // 不早于首次开始日
        if (Date.UTC(day.y, day.mo - 1, day.d) < Date.UTC(s.y, s.mo - 1, s.d)) continue;
        candidates.push(day);
      }
      const probe = addDays(week0.y, week0.mo, week0.d, w * 7);
      if (Date.UTC(probe.y, probe.mo - 1, probe.d) > winEndUtc + 86400_000 * 9) break;
      if (candidates.length > 4000) break;
    }
  } else {
    // MONTHLY：BYMONTHDAY 缺省取开始日的「日」
    const mds = ev.rrule.byMonthDay ?? [s.d];
    for (let m = 0; ; m += ev.rrule.interval) {
      const base = new Date(Date.UTC(s.y, s.mo - 1 + m, 1));
      const y = base.getUTCFullYear(), mo = base.getUTCMonth() + 1;
      for (const md of mds) {
        const probe = new Date(Date.UTC(y, mo - 1, md));
        if (probe.getUTCMonth() !== mo - 1) continue; // 该月没有这一天（如 2 月 31 日）→ 跳过
        if (Date.UTC(y, mo - 1, md) < Date.UTC(s.y, s.mo - 1, s.d)) continue;
        candidates.push({ y, mo, d: md });
      }
      if (Date.UTC(y, mo - 1, 1) > winEndUtc + 86400_000 * 40) break;
      if (m > 1200) break;
    }
  }

  for (const c of candidates) {
    const utc = wallToUtc(ev.timeZone, c.y, c.mo, c.d, s.h, s.mi);
    if (ev.rrule.until !== undefined && utc > ev.rrule.until) break;
    if (ev.rrule.count !== undefined && generated >= ev.rrule.count) break;
    generated++;
    // EXDATE 在生成后剔除（RFC 5545：COUNT 先计数，EXDATE 再删）
    if (exset.has(fmtDay(c.y, c.mo, c.d))) continue;
    if (utc >= winStartUtc && utc < winEndUtc) out.push(utc);
  }
  return out.sort((a, b) => a - b);
}

// ---------- 4. 会议室：忙闲查询与冲突检测 ----------

interface Booking {
  room: string;
  startUtc: number;
  endUtc: number;
  title: string;
}

const bookings: Booking[] = [];

function book(room: string, title: string, tz: string, y: number, mo: number, d: number, h: number, mi: number, durMin: number) {
  const start = wallToUtc(tz, y, mo, d, h, mi);
  bookings.push({ room, title, startUtc: start, endUtc: start + durMin * 60_000 });
}

/** 冲突检测：新会议的每个 occurrence 与该会议室已有预定做区间重叠判定 */
function findConflicts(room: string, occurrencesUtc: number[], durationMin: number): { at: Date; with: string }[] {
  const list = bookings.filter((b) => b.room === room).sort((a, b) => a.startUtc - b.startUtc);
  const out: { at: Date; with: string }[] = [];
  for (const s of occurrencesUtc) {
    const e = s + durationMin * 60_000;
    for (const b of list) {
      if (b.startUtc >= e) break; // 已排序，后面的不可能再重叠
      if (s < b.endUtc) out.push({ at: new Date(s), with: b.title });
    }
  }
  return out;
}

/** 忙闲查询：某天（墙钟口径）该会议室的忙碌区间 */
function busyIntervals(room: string, tz: string, y: number, mo: number, d: number) {
  const dayStart = wallToUtc(tz, y, mo, d, 0, 0);
  const dayEnd = wallToUtc(tz, ...Object.values(addDays(y, mo, d, 1)) as [number, number, number], 0, 0);
  return bookings
    .filter((b) => b.room === room && b.startUtc < dayEnd && b.endUtc > dayStart)
    .map((b) => ({ start: utcToWall(tz, b.startUtc), end: utcToWall(tz, b.endUtc), title: b.title }));
}

// ---------- 5. 演示与断言 ----------

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z";

const WIN = [Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1)] as const; // 2026 全年窗口

console.log("========== 1. 每日站会（Asia/Shanghai 09:30，共 5 次） ==========");
const standup: CalendarEvent = {
  title: "每日站会", timeZone: "Asia/Shanghai",
  startWall: { y: 2026, mo: 3, d: 2, h: 9, mi: 30 }, durationMin: 15,
  rrule: parseRRule("FREQ=DAILY;COUNT=5"), exdates: [],
};
const sOcc = expand(standup, WIN[0], WIN[1]);
sOcc.forEach((t) => console.log(`  ${iso(t)}`));
assert(sOcc.length === 5, "应展开 5 次");
assert(iso(sOcc[0]) === "2026-03-02 01:30Z", "北京 09:30 = UTC 01:30");
assert(iso(sOcc[4]) === "2026-03-06 01:30Z", "末次应为 3 月 6 日");

console.log("\n========== 2. 每周一三五 周报会（COUNT=6） ==========");
const weekly: CalendarEvent = {
  title: "周报会", timeZone: "Asia/Shanghai",
  startWall: { y: 2026, mo: 3, d: 2, h: 14, mi: 0 }, durationMin: 60, // 3 月 2 日是周一
  rrule: parseRRule("FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6"), exdates: [],
};
const wOcc = expand(weekly, WIN[0], WIN[1]);
wOcc.forEach((t) => console.log(`  ${iso(t)}（${new Date(t).toISOString().slice(0, 10)} ${WD[new Date(t).getUTCDay()]}）`));
assert(wOcc.length === 6, "应展开 6 次");
assert(iso(wOcc[1]) === "2026-03-04 06:00Z", "第二次应为周三");

console.log("\n========== 3. 每月 31 号 结账会（2/4/6/9/11 月应跳过） ==========");
const monthly: CalendarEvent = {
  title: "月度结账", timeZone: "Asia/Shanghai",
  startWall: { y: 2026, mo: 1, d: 31, h: 17, mi: 0 }, durationMin: 60,
  rrule: parseRRule("FREQ=MONTHLY;BYMONTHDAY=31;COUNT=5"), exdates: [],
};
const mOcc = expand(monthly, WIN[0], WIN[1]);
mOcc.forEach((t) => console.log(`  ${iso(t)}`));
assert(mOcc.map((t) => new Date(t).getUTCMonth() + 1).join() === "1,3,5,7,8", "只应落在有 31 号的月份");

console.log("\n========== 4. EXDATE 例外：清明假期跳过 4 月 6 日站会 ==========");
const standup2: CalendarEvent = {
  ...standup,
  startWall: { y: 2026, mo: 4, d: 3, h: 9, mi: 30 },
  rrule: parseRRule("FREQ=DAILY;COUNT=5"),
  exdates: ["2026-04-06"],
};
const s2 = expand(standup2, WIN[0], WIN[1]);
console.log(`  展开 ${s2.length} 次：${s2.map((t) => iso(t).slice(0, 10)).join("，")}`);
assert(s2.length === 4, "COUNT=5 生成 5 次，EXDATE 删掉 1 次后应剩 4 次（RFC 口径：先计数后剔除）");
assert(!s2.some((t) => iso(t).startsWith("2026-04-06")), "4 月 6 日应被剔除");

console.log("\n========== 5. DST 边界：纽约每周一 09:00，跨过 2026-03-08 夏令时 ==========");
const nyWeekly: CalendarEvent = {
  title: "纽约周会", timeZone: "America/New_York",
  startWall: { y: 2026, mo: 3, d: 2, h: 9, mi: 0 }, durationMin: 30,
  rrule: parseRRule("FREQ=WEEKLY;COUNT=3"), exdates: [],
};
const ny = expand(nyWeekly, Date.UTC(2026, 1, 1), Date.UTC(2026, 4, 1));
ny.forEach((t) => {
  const wall = utcToWall("America/New_York", t);
  console.log(`  UTC ${iso(t)}  →  纽约本地 ${wall.y}-${String(wall.mo).padStart(2, "0")}-${String(wall.d).padStart(2, "0")} ${String(wall.h).padStart(2, "0")}:${String(wall.mi).padStart(2, "0")}`);
});
assert(iso(ny[0]) === "2026-03-02 14:00Z" && iso(ny[1]) === "2026-03-09 13:00Z", "DST 后 UTC 应提前 1 小时");
assert(ny.every((t) => utcToWall("America/New_York", t).h === 9), "本地墙钟必须恒为 9:00");

console.log("\n========== 6. 会议室冲突检测与忙闲 ==========");
// 已有预定：3 月 4 日（周三）14:00-15:00 「预算评审」占用 A301
book("A301", "预算评审", "Asia/Shanghai", 2026, 3, 4, 14, 0, 60);
// 新会议：每周三 14:00 周报会，3 次
const newWeekly: CalendarEvent = {
  title: "周三例会", timeZone: "Asia/Shanghai",
  startWall: { y: 2026, mo: 3, d: 4, h: 14, mi: 0 }, durationMin: 60,
  rrule: parseRRule("FREQ=WEEKLY;COUNT=3"), exdates: [],
};
const occ = expand(newWeekly, WIN[0], WIN[1]);
const conflicts = findConflicts("A301", occ, 60);
console.log(`  周三例会 3 次，冲突 ${conflicts.length} 次：${conflicts.map((c) => `${iso(c.at.getTime())} 撞「${c.with}」`).join("；") || "无"}`);
assert(conflicts.length === 1 && conflicts[0].with === "预算评审", "只有首周与预算评审重叠");

// 把新会议也订进 A301（跳过冲突那次），再查 3 月 11 日忙闲
book("A301", "周三例会", "Asia/Shanghai", 2026, 3, 11, 14, 0, 60);
const busy = busyIntervals("A301", "Asia/Shanghai", 2026, 3, 11);
console.log(`  A301 在 2026-03-11 的忙碌区间：${busy.map((b) => `${String(b.start.h).padStart(2, "0")}:${String(b.start.mi).padStart(2, "0")}~${String(b.end.h).padStart(2, "0")}:${String(b.end.mi).padStart(2, "0")}「${b.title}」`).join("，")}`);
assert(busy.length === 1 && busy[0].start.h === 14 && busy[0].end.h === 15, "忙闲应按本地墙钟给出 14~15 点");

console.log("\n✅ 全部断言通过：RRULE 展开、EXDATE、DST 平移、冲突检测与忙闲均按预期工作");
