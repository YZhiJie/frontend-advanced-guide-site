// 文件: examples/39-05-fanout-strategy.ts
// ============ 群聊扩散：写扩散 vs 读扩散 vs 混合 ============
// 群消息如何到达群成员？两条路线：
// - 写扩散（fan-out on write）：发一条消息，服务端往每个成员的收件箱各写一条。
//   读快（各端只查自己收件箱）；写炸（万人群一条消息 = 一万次写入）。
// - 读扩散（fan-out on read）：消息只写一份到群时间线，成员上线后逐群拉取。
//   写省（一条消息一次写入）；读炸（关注 100 个群 = 打开 App 要扫 100 条时间线）。
// 业界主流是混合：小群写扩散（读体验好），超大群读扩散（写成本可控）。
// 本示例用成本模型量化两种策略在不同群规模下的写入量。

export interface Strategy {
  name: string;
  /** 发一条消息的写入成本 = f(群成员数) */
  writeCostPerMsg: (members: number) => number;
  /** 一个成员打开 App 的读取成本 = f(他关注的群个数·每群新消息数) */
  readCostPerOpen: (convCount: number, newMsgsPerConv: number) => number;
}

export const writeDiffusion: Strategy = {
  name: "写扩散",
  writeCostPerMsg: (members) => members, // 每人收件箱写一条
  readCostPerOpen: (_convs, _newMsgs) => 1, // 读自己一个收件箱
};

export const readDiffusion: Strategy = {
  name: "读扩散",
  writeCostPerMsg: () => 1, // 群时间线写一条
  readCostPerOpen: (convs, newMsgs) => convs * newMsgs, // 逐群拉增量
};

/** 混合策略：≤ 阈值走写扩散，超过走读扩散 */
export function hybrid(threshold: number): Strategy {
  return {
    name: `混合(阈值${threshold})`,
    writeCostPerMsg: (members) => (members <= threshold ? members : 1),
    readCostPerOpen: (convs, newMsgs) => convs * newMsgs, // 读侧与读扩散同构（简化模型）
  };
}

export interface Conv {
  convId: string;
  members: number;
  msgsPerHour: number;
}

/** 单群每小时写入成本 */
export function hourlyWriteCost(conv: Conv, s: Strategy): number {
  return conv.msgsPerHour * s.writeCostPerMsg(conv.members);
}

/** 决策：给定群画像，比较各策略成本 */
export function decide(
  conv: Conv,
  candidates: readonly Strategy[],
): { picked: string; costs: Array<{ name: string; cost: number }> } {
  const costs = candidates.map((s) => ({
    name: s.name,
    cost: hourlyWriteCost(conv, s),
  }));
  const picked = costs.reduce(
    (min, c) => (c.cost < min.cost ? c : min),
    costs[0]!,
  ).name;
  return { picked, costs };
}

// ---------------- 验证 ----------------

const strategies = [writeDiffusion, readDiffusion, hybrid(500)];

const smallGroup: Conv = { convId: "小群", members: 50, msgsPerHour: 100 };
const bigGroup: Conv = { convId: "大群", members: 5000, msgsPerHour: 600 };
const megaGroup: Conv = { convId: "万人群", members: 10000, msgsPerHour: 100 };

for (const conv of [smallGroup, bigGroup, megaGroup]) {
  const { picked, costs } = decide(conv, strategies);
  console.log(
    `\n=== ${conv.convId}（${conv.members} 人 · ${conv.msgsPerHour} 条/时） ===`,
  );
  console.log(costs.map((c) => `${c.name}: ${c.cost} 次写/时`).join(" | "));
  console.log("→ 选用:", picked);
}

console.log("\n=== 读侧成本对比（打开 App 时） ===");
const me = { convs: 120, newMsgs: 30 };
console.log(
  "写扩散读成本:",
  writeDiffusion.readCostPerOpen(me.convs, me.newMsgs),
  "次查询（只查统一收件箱）",
);
console.log(
  "读扩散读成本:",
  readDiffusion.readCostPerOpen(me.convs, me.newMsgs),
  "次查询（120 个群逐个拉）",
);
console.log(
  "→ 群多但小（职场 IM）偏写扩散；群巨大（直播弹幕/全员群）读扩散才扛得住写",
);

console.log("\n=== 前端感知差异 ===");
console.log(`
// 写扩散：一端已读 = 收件箱标已读，天然多端同步
// 读扩散：已读是"每个端各自的游标"，需要显式同步 read 游标（见 39-04）
`);
