/** 67-04-reconciliation.ts —— 对账报表内核：整数分、合计校验、差异定位与虚拟窗口 */

interface LedgerRow {
  orderId: string;
  amountCents: number;
  currency: string;
}

type DiffKind = "only_platform" | "only_channel" | "amount" | "currency" | "duplicate";

interface Diff {
  kind: DiffKind;
  orderId: string;
  platformCents?: number;
  channelCents?: number;
  deltaCents?: number;
}

interface Report {
  matched: number;
  diffs: Diff[];
  platformTotal: number;
  channelTotal: number;
  totalDelta: number;
  balanced: boolean;
}

/**
 * 金额一律用「整数分」:0.1 + 0.2 在二进制浮点里不等于 0.3,
 * 对账差 1 分就是财务事故。字符串解析必须拒绝小数位超过两位的输入,
 * 而不是四舍五入——四舍五入会把脏数据变成「看起来对」的数据。
 */
function toCents(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isInteger(input)) throw new Error(`金额含小数,请传整数分: ${input}`);
    return input;
  }
  const clean = input.replace(/[,¥\s]/g, "");
  const m = clean.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) throw new Error(`非法金额: ${input}`);
  const sign = m[1] === "-" ? -1 : 1;
  const yuan = Number(m[2]);
  const fen = Number((m[3] ?? "0").padEnd(2, "0"));
  return sign * (yuan * 100 + fen);
}

function indexByOrder(rows: LedgerRow[]): { map: Map<string, LedgerRow>; duplicates: string[] } {
  const map = new Map<string, LedgerRow>();
  const duplicates: string[] = [];
  for (const r of rows) {
    if (map.has(r.orderId)) duplicates.push(r.orderId);
    else map.set(r.orderId, r);
  }
  return { map, duplicates };
}

function reconcile(platform: LedgerRow[], channel: LedgerRow[]): Report {
  const p = indexByOrder(platform);
  const c = indexByOrder(channel);
  const diffs: Diff[] = [];
  const seenDup = new Set<string>();

  for (const [id, row] of p.map) {
    const other = c.map.get(id);
    if (!other) {
      diffs.push({ kind: "only_platform", orderId: id, platformCents: row.amountCents });
      continue;
    }
    if (row.currency !== other.currency) {
      diffs.push({ kind: "currency", orderId: id, platformCents: row.amountCents, channelCents: other.amountCents });
      continue;
    }
    if (row.amountCents !== other.amountCents) {
      diffs.push({
        kind: "amount",
        orderId: id,
        platformCents: row.amountCents,
        channelCents: other.amountCents,
        deltaCents: row.amountCents - other.amountCents,
      });
    }
  }
  for (const [id, row] of c.map) {
    if (!p.map.has(id)) diffs.push({ kind: "only_channel", orderId: id, channelCents: row.amountCents });
  }
  for (const id of [...p.duplicates, ...c.duplicates]) {
    if (seenDup.has(id)) continue;
    seenDup.add(id);
    diffs.push({ kind: "duplicate", orderId: id });
  }

  const platformTotal = platform.reduce((s, r) => s + r.amountCents, 0);
  const channelTotal = channel.reduce((s, r) => s + r.amountCents, 0);
  const totalDelta = platformTotal - channelTotal;

  // 明细都对上但合计不等,说明存在未进入明细的资金(手续费、退款、跨日结算)
  let matched = 0;
  for (const [id, row] of p.map) {
    const other = c.map.get(id);
    if (other && other.currency === row.currency && other.amountCents === row.amountCents) matched++;
  }
  return {
    matched,
    diffs,
    platformTotal,
    channelTotal,
    totalDelta,
    balanced: diffs.length === 0 && totalDelta === 0,
  };
}

/**
 * 虚拟窗口:对账表常用「按差异类型分组 + 只看差异」,
 * 窗口函数只负责把筛选后的差异切成可视区,绝不把万行差异全量渲染。
 */
function windowSlice<T>(rows: T[], scrollTop: number, rowHeight: number, viewportHeight: number, overscan = 4) {
  const first = Math.floor(scrollTop / rowHeight);
  const count = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(rows.length, first + count + overscan);
  return {
    start,
    end,
    topSpacer: start * rowHeight,
    bottomSpacer: (rows.length - end) * rowHeight,
    rows: rows.slice(start, end),
  };
}

// ---- 断言 ----
console.assert(toCents("1,234.56") === 123456, "千分位与两位小数解析正确");
console.assert(toCents("0.5") === 50, "一位小数补零为 50 分");
console.assert(toCents("¥ 99") === 9900, "货币符号与空格应被忽略");
console.assert(toCents(-1234) === -1234, "负数整数分原样返回");

let floatRejected = false;
try {
  toCents(12.3);
} catch {
  floatRejected = true;
}
console.assert(floatRejected, "浮点金额必须直接拒绝");

const platform: LedgerRow[] = [
  { orderId: "A1", amountCents: 10000, currency: "CNY" },
  { orderId: "A2", amountCents: 25000, currency: "CNY" },
  { orderId: "A3", amountCents: 8000, currency: "CNY" },
  { orderId: "A4", amountCents: 6000, currency: "CNY" },
];
const channel: LedgerRow[] = [
  { orderId: "A1", amountCents: 10000, currency: "CNY" },
  { orderId: "A2", amountCents: 24000, currency: "CNY" }, // 差 1000 分
  { orderId: "A4", amountCents: 6000, currency: "USD" }, // 币种不一致
  { orderId: "A5", amountCents: 3000, currency: "CNY" }, // 渠道多一笔
];

const report = reconcile(platform, channel);
console.assert(report.balanced === false, "存在差异时不得标记平衡");
console.assert(report.diffs.length === 4, "平台独有/金额差/币种差/渠道独有共 4 条");

const amountDiff = report.diffs.find((d) => d.kind === "amount")!;
console.assert(
  amountDiff.orderId === "A2" && amountDiff.deltaCents === 1000,
  "金额差应带订单号与差额方向",
);
const currencyDiff = report.diffs.find((d) => d.kind === "currency")!;
console.assert(currencyDiff.orderId === "A4", "币种差单独一类,不混进金额差");
console.assert(
  report.diffs.filter((d) => d.kind === "only_platform").length === 1 &&
    report.diffs.filter((d) => d.kind === "only_channel").length === 1,
  "单边账必须分别标记,不能靠合计抹平",
);
console.assert(
  report.platformTotal === 49000 && report.channelTotal === 43000 && report.totalDelta === 6000,
  "合计用整数分累加,差额可用于二次核对",
);
console.assert(report.matched === 1, "仅 A1 完全匹配");

const dup = reconcile(
  [...platform, { orderId: "A1", amountCents: 10000, currency: "CNY" }],
  channel,
);
console.assert(dup.diffs.some((d) => d.kind === "duplicate" && d.orderId === "A1"), "重复单号必须报出");

const clean = reconcile(
  [{ orderId: "B1", amountCents: 500, currency: "CNY" }],
  [{ orderId: "B1", amountCents: 500, currency: "CNY" }],
);
console.assert(clean.balanced && clean.matched === 1, "完全一致时平衡且匹配数为 1");

const win = windowSlice(Array.from({ length: 100 }, (_, i) => i), 0, 40, 400, 2);
console.assert(win.start === 0 && win.rows.length === 12, "视口 10 行 + 上下各 2 行缓冲");
console.assert(win.bottomSpacer === (100 - 12) * 40, "底部占位撑起剩余滚动高度");

const winMid = windowSlice(Array.from({ length: 100 }, (_, i) => i), 40 * 50, 40, 400, 2);
console.assert(winMid.start === 48 && winMid.rows[0] === 48, "滚动到中部时窗口起点含上缓冲");

console.log("✅ 整数分解析 / 差异分类 / 合计校验 / 虚拟窗口全部通过");
