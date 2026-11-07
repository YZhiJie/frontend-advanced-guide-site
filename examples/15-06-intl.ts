// 文件: examples/15-06-intl.ts —— Intl API:零依赖的本地化格式(纯 Node 可运行)
// ============ 日期、数字、货币、相对时间、复数 —— 全部原生支持 ============

const now = new Date('2026-09-15T10:30:00Z');

// ---- 日期时间:不要手写 yyy-MM-dd 拼接 ----
console.log(new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeStyle: 'short' }).format(now));
// 2026年9月15日 GMT+8 下午6:30
console.log(new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(now));
// September 15, 2026

// ---- 货币:自动处理小数位与符号位置(日元没有小数!) ----
console.log(new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(1234567.891));
// ¥1,234,567.89
console.log(new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(1234567.891));
// ￥1,234,568 —— 自动取整

// ---- 相对时间(列表"3 天前") ----
const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
console.log(rtf.format(-3, 'day'));  // 3 天前
console.log(rtf.format(1, 'hour'));  // 1 小时后

// ---- 复数:阿拉伯语有 6 种复数形式,手写 if 根本覆盖不了 ----
const pf = new Intl.PluralRules('en-US');
for (const n of [1, 2, 5]) {
    const category = pf.select(n); // 'one' | 'other'
    const template = category === 'one' ? `${n} item` : `${n} items`;
    console.log(template); // 1 item / 2 items / 5 items
}
