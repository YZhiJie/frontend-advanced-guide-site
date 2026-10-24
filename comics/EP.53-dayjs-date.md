# EP.53 日期那点不精确的事

> 对应正文：[第三十二部分 · Day.js 日期工程](../32-dayjs.md)

## 剧情回顾

- **第 1 格**：标签君困惑——Day.js 把 `dayjs('2024-01-31').add(1, 'month')` 变成了 3 月 2 日？月末钳制也能搞错！还有服务器存的是 UTC 字符串 `2024-06-15T08:00:00Z`，前端用户在北京 GMT+8 看到的应该是 16:00 才对，但页面显示 08:00 直接把 Z 丢了。
- **第 2 格**：码叔点破——Day.js 默认**可变**（mutable），`add`/`subtract`/`startOf` 直接改原对象，链式调用要先 `.clone()`。月末钳制 `add(1, 'month')` 在 1 月 31 日 +1 个月应该是 2 月 29 日，但 Day.js 默认钳到 2 月最后一天 = 2 月 29？不对 2024 年是闰年所以是 29，但 2023 年就钳到 28。真正的"月末到月末"语义用 `.add(1, 'month').endOf('month').startOf('day')` 两步。时区错配根因：存 UTC 字符串但前端用本地时区 parse，或者反过来。
- **第 3 格**：像素酱实测——存的时候统一 `dayjs.utc(date).format('YYYY-MM-DDTHH:mm:ssZ')`，展示的时候 `.utcOffset(8).format('YYYY-MM-DD HH:mm')` 或带时区插件。月末钳制写个工具函数 `addMonthsClamped(d, n) => d.add(n, 'month').endOf('month').startOf('day')`。启用 strict mode `dayjs.extend(customParseFormat)` 防止脏输入被容错解析。
- **第 4 格**：码叔结案——三个高频坑：忘记 clone 导致原对象被改（Day.js 与 Moment.js 不同的默认语义）、月末钳制无脑 add 导致"日期飞了"、UTC vs 本地时区存储策略混乱。

## 知识点拆解

### 第 1 格 · 不可变 vs 可变的默认差异

```ts
// Day.js 默认 mutable（⚠️ 会改原对象）
const d1 = dayjs("2024-01-15");
const d2 = d1.add(1, "month");
console.log(d1.format("YYYY-MM-DD")); // 2024-02-15 ← 被改了！
console.log(d2.format("YYYY-MM-DD")); // 2024-02-15

// 解决：先 clone
const d1b = dayjs("2024-01-15");
const d2b = d1b.clone().add(1, "month");
// 或开启 immutable 插件
dayjs.extend(dayjs.pluginImmutable); // 之后默认不可变
```

Day.js 默认可变，Moment.js 也是可变，但 Luxon 默认不可变。迁移时最容易踩的坑就是"为什么我一个日期对象改了另一处也跟着变"。

### 第 2 格 · 月末钳制正确姿势

```ts
// ❌ 不对：1月31 + 1月 → 2月29（2024闰年）/ 2月28（平年）
//    这叫"月末钳制"不是"溢出到3月"
dayjs("2024-01-31").add(1, "month").format("YYYY-MM-DD"); // 2024-02-29 ✓ 钳住了

// ❌ 但你想要的语义可能是"每月同一天，不够就钳到月末"
//    再 add 又会从 2月29 往后跑 2月... 结果乱掉
dayjs("2024-01-31").add(2, "month").format("YYYY-MM-DD"); // 2024-03-31 ✓ 刚好对

// ✅ 正确：每次都钳到月末
function addMonthsClamped(date: string | Dayjs, n: number): Dayjs {
  return dayjs(date).add(n, "month").endOf("month").startOf("day");
}
```

### 第 3 格 · 时区存储与展示策略

```
存：统一 UTC（ISO 8601 + Z）
  dayjs.utc(date).format('YYYY-MM-DDTHH:mm:ss[Z]')
  → "2024-06-15T08:00:00Z"

取：前端根据用户时区展示
  dayjs.utc("2024-06-15T08:00:00Z")
    .utcOffset(8)        // 或用 tz 插件 dayjs.tz("Asia/Shanghai")
    .format("YYYY-MM-DD HH:mm")
  → "2024-06-15 16:00"（北京）
  → "2024-06-15 09:00"（伦敦 +1 BST）
```

**绝对禁止**：存本地时间字符串不带时区信息，不同时区用户看到的时间就错了。

### 第 4 格 · 三个最坑

1. **忘记 clone，原对象被默默修改**：链式 pipeline 里中间对象被后续操作改了，追溯起来极痛。建议全项目开 immutable 插件。
2. **月末 add 无脑调**：从月末往后挪月份每次都钳，结果叠加起来跟预期差很远。封装工具函数。
3. **UTC vs 本地时区存储混乱**：存了不带时区的字符串，或者前端 parse 时假设了错误时区。必须定死：存 UTC、展时区。

## 坑点清单

> 🔗 正文对照：[《32.7 本章避坑清单》](../32-dayjs#_32-7-本章避坑清单)

1. **Day.js 默认 mutable**：`add`/`subtract`/`startOf` 全部原地改对象，不像 Luxon 那样默认返回新实例。多组件共享同一个 Dayjs 对象会出现"A 改了 B 也跟着变"的幽灵 bug。
2. **月末钳制不直观**：`dayjs('2024-01-31').add(1, 'month')` 返回 2 月 29 日（闰年），这是钳制而不是"溢出"。再 `.add(1, 'month')` 就从 2 月 29 日往后 +1 个月 = 3 月 29 日，不是 3 月 31 日——跟"每月最后一天"的预期差 2 天。
3. **时区存储策略不定**：存了不带时区的 `"2024-06-15 08:00:00"`，前端 `dayjs()` 按本地时区 parse，北京用户和纽约用户看到的"绝对时刻"是完全不同的。
4. **严格 parse 不启用**：`dayjs('hello')` 默认返回一个 Invalid Dayjs，但业务里没检查 `.isValid()` 就往下跑。开 `customParseFormat` 插件 + 固定格式字符串。

## 自测 3 题

**1. Day.js 默认 mutable 语义给了你一个 buggy 的"共享日期对象"，如何修复？两种方案对比。**

<details>
<summary>参考答案</summary>

假设两个组件都引用同一个 `selectedDate = dayjs('2024-06-01')`，组件 A 调了 `selectedDate.startOf('week')`，组件 B 发现自己的日期也变了。

**方案 A：每次操作前 clone**

```ts
const adjusted = selectedDate.clone().startOf("week");
```

优点：零依赖，随时改随时生效。缺点：每个调用点都要记得 clone，漏一次就坑。

**方案 B：全局开 immutable 插件**

```ts
import dayjs from "dayjs";
import immutable from "dayjs/plugin/immutable";
dayjs.extend(immutable);

// 之后所有操作默认返回新对象
const adjusted = selectedDate.startOf("week"); // selectedDate 不变
```

优点：一劳永逸，符合直觉。缺点：插件引入成本（极小），且项目里原来依赖 mutable 语义的地方会静默失效（但很少）。

**推荐 B**。不可变才是时间对象的正确语义——时间是单向流动的，不应该被回滚。

</details>

**2. 写一个 `addMonthsClamped` 工具函数，要求：从月末出发加 N 个月，每次都钳到目标月的月末。**

<details>
<summary>参考答案</summary>

```ts
import dayjs from "dayjs";

/**
 * 从月末出发加 n 个月，结果钳到目标月的月末。
 * 例：2024-01-31 + 1 = 2024-02-29（闰年）
 *     2024-01-31 + 2 = 2024-03-31
 *     2023-01-31 + 1 = 2023-02-28（平年）
 */
export function addMonthsClamped(input: dayjs.ConfigType, n: number): dayjs.Dayjs {
  return dayjs(input).add(n, "month").endOf("month").startOf("day");
}
```

关键理解：Day.js 的 `add(1, 'month')` 本身就做了月末钳制（1 月 31 加 1 月 = 2 月的最后一天）。问题出在**叠加多次**时——2 月 28 加 1 月 = 3 月 28，不是 3 月 31。所以每一步加完后要 `.endOf('month')` 重新钳一次。

</details>

**3. 为什么"存本地时间"是坏策略？给出完整的 UTC 存/取/展示代码。**

<details>
<summary>参考答案</summary>

坏在**时区信息丢失**。假设服务器存 `"2024-06-15 08:00:00"`，没有任何时区标记：

- 北京用户（UTC+8）parse 成 UTC 00:00:00 → 实际服务器存的就是北京时间 08:00
- 伦敦用户（UTC+1 BST）parse 成 UTC 07:00:00 → 同一个字符串，两个用户看到的"绝对时刻"差 7 小时

**存：统一 UTC，带 Z**

```ts
// 前端提交时
const payload = {
  eventStart: dayjs(tzUserPicked, "YYYY-MM-DD HH:mm", "Asia/Shanghai")
    .utc()
    .format("YYYY-MM-DDTHH:mm:ss[Z]"), // "2024-06-14T16:00:00Z"
};
```

**取：前端按用户时区展示**

```ts
import utc from "dayjs/plugin/utc";
import tz from "dayjs/plugin/timezone";
dayjs.extend(utc);
dayjs.extend(tz);

// 用户选自己的时区（或用浏览器 Intl.DateTimeFormat().resolvedOptions().timeZone）
const userTz = "Asia/Shanghai";

const display = dayjs.utc("2024-06-14T16:00:00Z")
  .tz(userTz)
  .format("YYYY-MM-DD HH:mm Z");
// → "2024-06-15 00:00 +08:00"
```

**存 UTC + 展时区**，是所有带时区的业务的不二策略。

</details>
