// 文件: examples/25-08-intl-format.ts —— Intl 国际化格式化:别再手写格式化函数
// ============ Intl.* 是平台内置的本地化引擎,Node 13+ 默认 full-icu,输出固定可跑============

// ── 数字分组:手写 toLocaleString 正则千分位是最常见的重复造轮子 ──
const num = 1234567.89;
console.log("数字 zh-CN:", new Intl.NumberFormat("zh-CN").format(num));
console.log("数字 de-DE(逗点互换):", new Intl.NumberFormat("de-DE").format(num));
// 货币:currency 参数 + style,汇率换算不做(它只管「显示」不管「牌价」)
console.log("货币 CNY:", new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(num));
// 单位:单价/流量/文件大小都不用手写「万/亿」换算表
console.log("单位 Mbps:", new Intl.NumberFormat("zh-CN", { style: "unit", unit: "megabit-per-second" }).format(300));

// ── 日期:必须显式给 timeZone,否则输出随宿主机时区漂移(CI 与本地不一致的经典事故) ──
const date = new Date("2026-10-19T08:30:00Z"); // 固定 UTC 时刻,保证示例输出确定
console.log("日期 zh-CN UTC:", new Intl.DateTimeFormat("zh-CN", {
  timeZone: "UTC", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
}).format(date));
console.log("日期 en-US UTC:", new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC", dateStyle: "medium", timeStyle: "short",
}).format(date));

// ── 相对时间:「3 天前」这类文案交给 RelativeTimeFormat,别手写 switch ──
const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
console.log("相对时间:", rtf.format(-3, "day"), "/", rtf.format(-1, "hour"), "/", rtf.format(2, "week"));

// ── 列表:逗号顿号的「和」连接,A、B 和 C 是 ListFormat 的事 ──
console.log("列表:", new Intl.ListFormat("zh-CN").format(["React", "Vue", "Svelte"]));

// ── 分词:Intl.Segmenter 把「没有空格的语言」切成词,搜索高亮/字数统计都靠它 ──
const seg = new Intl.Segmenter("zh-CN", { granularity: "word" });
const words = [...seg.segment("高级前端进阶指南的暗黑模式")]
  .filter((s) => s.isWordLike)
  .map((s) => s.segment);
console.log("中文分词:", words.join(" / "));

// ── 排序:localeCompare 每次调用都建 Collator,高频循环要复用实例 ──
const coll = new Intl.Collator("zh-CN");
const sorted = ["长江", "黄河", "淮河"].sort((a, b) => coll.compare(a, b));
console.log("拼音序:", sorted.join(" / "));

// 坑点速记:
//  1) 构造 Intl 实例有成本,热路径复用(模块级单例),不要在 render 里 new
//  2) 时区不写就是「随宿主」,测试与 CI 必须显式 timeZone
//  3) format 输出会随 ICU 数据版本微调,断言测试要锁 locale+ICU,或只断言结构不断言全等文案
