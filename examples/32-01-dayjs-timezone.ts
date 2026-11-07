// 文件: examples/32-01-dayjs-timezone.ts
// ============ dayjs 比较、ISO 周与时区/DST：把「本地时间」当显式数据 ============
// 对应 32.3「比较、插件与周体系」与 32.4「时区、DST、本地化」：
// - isSame 必须显式写单位，isBetween 默认开区间；
// - isoWeek 是 ISO 8601 口径，和 locale 的 weekStart 无关；
// - tz 对象的偏移在构造时缓存，加减后要 .tz(zone, true) 重新归一化；
// - DST 当天「加一天」是 23 小时，不是 24 小时。

import dayjs from "dayjs";
import isBetween from "dayjs/plugin/isBetween.js";
import isoWeek from "dayjs/plugin/isoWeek.js";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";

// 插件注册顺序：utc 必须先于 timezone
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(isoWeek);

/** 硬断言：console.assert 在 Node 里不阻断，脚本需要「错了就红」 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// 1) 比较：单位决定粒度，区间默认开区间
const now = dayjs("2024-06-15T12:00:00");
const start = dayjs("2024-06-01");
const end = dayjs("2024-06-30");
console.log("isSame 按天：", now.isSame("2024-06-15T23:59:59", "day"), "| 默认开区间包含起点：", start.isBetween(start, end));
assert(now.isSame("2024-06-15T23:59:59", "day"), "同一天不同时刻按 day 比较应相等");
assert(now.isSame("2024-06-15T23:59:59") === false, "不传单位时按毫秒比较，应不相等");
assert(start.isBetween(start, end, "day", "[]"), "显式闭区间时起点应被包含");

// 2) ISO 周：2024-01-01 是周一，属于 ISO 第 1 周
const newYear = dayjs("2024-01-01");
console.log("ISO 周：", newYear.isoWeek(), "| ISO 周几：", newYear.isoWeekday(), "| 起点：", newYear.startOf("isoWeek").format("YYYY-MM-DD"));
assert(newYear.isoWeek() === 1, "2024-01-01 应属于 ISO 第 1 周");
assert(newYear.startOf("isoWeek").format("YYYY-MM-DD") === "2024-01-01", "ISO 周起点应是周一");

// 3) 同一瞬间的三种时区表示
const instant = dayjs.utc("2024-03-10T07:00:00Z");
console.log("上海：", instant.tz("Asia/Shanghai").format("YYYY-MM-DD HH:mm Z"));
console.log("纽约：", instant.tz("America/New_York").format("YYYY-MM-DD HH:mm Z"), "| utcOffset：", instant.tz("America/New_York").utcOffset());
assert(instant.tz("Asia/Shanghai").format("HH:mm") === "15:00", "UTC 07:00 对应上海 15:00");
assert(instant.tz("America/New_York").utcOffset() === -240, "3 月已进入夏令时，纽约偏移应为 -04:00（-240）");

// 4) DST：加一天是 23 小时，且偏移必须重新归一化
const beforeDst = dayjs.tz("2024-03-09 12:00", "America/New_York");
const nextDay = beforeDst.add(1, "day").tz("America/New_York", true);
const plus24h = beforeDst.add(24, "hour");
console.log("前一天偏移：", beforeDst.utcOffset(), "| 次日：", nextDay.format("YYYY-MM-DD HH:mm Z"), "| diff 小时：", nextDay.diff(beforeDst, "hour"));
console.log("加 24 小时后的本地时刻：", plus24h.tz("America/New_York").format("HH:mm Z"));
assert(beforeDst.utcOffset() === -300, "3 月 9 日纽约仍是 -05:00");
assert(nextDay.diff(beforeDst, "hour") === 23, "跨 DST 加一天应只跨 23 小时");
assert(plus24h.tz("America/New_York").format("HH:mm") === "13:00", "加 24 小时会落到次日 13:00");

console.log("✓ 32-01 dayjs 时区与 DST 断言全部通过");
