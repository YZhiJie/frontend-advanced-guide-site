/** 60-02-safe-date.ts —— 跨浏览器安全日期解析与格式化
 *
 * 背景:Safari/WebKit 对 `new Date("2024-01-01 00:00:00")` 返回 Invalid Date
 * (非 ISO 8601 的「空格分隔 + 短横线」组合不在规范内,各引擎行为分裂)。
 * 本模块把「字符串 → Date」收敛为一个全引擎一致的纯函数:
 * 合法→本地时区逐字段构造;非法→返回 null,绝不让 NaN 流进下游。
 */
const RE =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/;

export function safeParseDate(input: string | number | Date): Date | null {
  if (input instanceof Date)
    return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input === "number") {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = input.trim().match(RE);
  if (!m) return null; // 格式不认 → null,由调用方决定降级(占位符/重试/报错)
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  // 逐字段构造走本地时区:不经过引擎的字符串解析器,行为在所有内核一致
  const date = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  // 防「2024-02-31」这类进位溢出:逐字段回验,溢出即判非法
  const ok =
    date.getFullYear() === +y &&
    date.getMonth() === +mo - 1 &&
    date.getDate() === +d;
  return ok ? date : null;
}

const pad = (n: number): string => String(n).padStart(2, "0");
export function formatDate(date: Date, fmt = "YYYY-MM-DD HH:mm:ss"): string {
  return fmt
    .replace("YYYY", String(date.getFullYear()))
    .replace("MM", pad(date.getMonth() + 1))
    .replace("DD", pad(date.getDate()))
    .replace("HH", pad(date.getHours()))
    .replace("mm", pad(date.getMinutes()))
    .replace("ss", pad(date.getSeconds()));
}

// ---- 硬断言:Safari 会挂的输入,这里必须稳定 ----
const safariKiller = safeParseDate("2024-01-01 00:00:00");
console.assert(
  safariKiller !== null && !Number.isNaN(safariKiller.getTime()),
  "短横线+空格分隔在 WebKit 下必须解析成功",
);
console.assert(
  safariKiller!.getFullYear() === 2024 && safariKiller!.getMonth() === 0,
  "字段正确",
);
console.assert(safeParseDate("2024/03/05") !== null, "斜杠格式兼容");
console.assert(safeParseDate("2024-03-05T12:30:45") !== null, "T 分隔兼容");
console.assert(safeParseDate("2024-13-01") === null, "13 月必须拒绝");
console.assert(safeParseDate("2024-02-31") === null, "2 月 31 日必须拒绝");
console.assert(safeParseDate("garbage") === null, "垃圾输入 → null 而非 NaN");
console.assert(
  safeParseDate(new Date("invalid" as unknown as string)) === null,
  "非法 Date 实例 → null",
);
const ts = safeParseDate(1704067200000);
console.assert(ts !== null && ts.getTime() === 1704067200000, "时间戳直通");
console.assert(
  formatDate(safeParseDate("2024-3-5 6:07:08")!) === "2024-03-05 06:07:08",
  "格式化补零",
);
console.log("✅ 跨浏览器安全日期解析通过");
