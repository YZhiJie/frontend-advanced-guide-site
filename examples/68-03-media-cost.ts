/** 68-03-media-cost.ts —— 媒体成本估算：码率、并发、转码与存储四本账 */

interface Rendition {
  name: string;
  /** 视频码率 (Mbps),不含音频 */
  mbps: number;
}

interface Plan {
  viewers: number;
  /** 单场时长(小时) */
  hours: number;
  renditions: Rendition[];
  /** 观众在各档位的分布,合计为 1 */
  mix: Record<string, number>;
  /** CDN 单价(元/GB) */
  cdnPricePerGb: number;
  /** 转码单价(元/转码小时) */
  transcodePricePerHour: number;
  /** 存储单价(元/GB·月) */
  storagePricePerGbMonth: number;
  /** 复用天数,0 表示直播结束即删除 */
  retainDays: number;
}

interface Cost {
  egressGb: number;
  cdnYuan: number;
  transcodeYuan: number;
  storageYuan: number;
  totalYuan: number;
  perViewerYuan: number;
}

const AUDIO_MBPS = 0.128;

/**
 * 成本四本账,顺序不能反:
 *   1) 出口流量 = 并发 × 单观众码率 × 时长(最大头,通常占 70%+)
 *   2) 转码 = 档位数 × 直播小时(与观众数无关,是固定成本)
 *   3) 存储 = 回放体积 × 保留天数(天然带长尾,容易被忽略)
 *   4) 单价 × 区域数:跨境分发单价上浮,不能只乘一个数
 * 估算的目的不是精确,而是让「上一档 4K」的代价可见。
 */
function estimate(p: Plan, regions = 1): Cost {
  const weight = Object.values(p.mix).reduce((a, b) => a + b, 0);
  if (Math.abs(weight - 1) > 1e-6) throw new Error(`观众档位分布合计必须为 1,当前 ${weight}`);
  for (const r of p.renditions) {
    if (p.mix[r.name] === undefined) throw new Error(`档位 ${r.name} 没有观众分布`);
  }

  // 1) 出口流量:按分布加权单观众码率
  const weightedMbps = p.renditions.reduce(
    (s, r) => s + r.mbps * (p.mix[r.name] ?? 0),
    0,
  ) + AUDIO_MBPS;
  const egressGb = ((p.viewers * weightedMbps * p.hours * 3600) / 8 / 1024) * regions;

  // 2) 转码:每档独立转码,与观众数无关
  const transcodeYuan = p.renditions.length * p.hours * p.transcodePricePerHour * regions;

  // 3) 存储:回放按最高档位保存(不能只存最低档,用户要点高清回放)
  const topMbps = Math.max(...p.renditions.map((r) => r.mbps)) + AUDIO_MBPS;
  const storageGb = ((topMbps * p.hours * 3600) / 8 / 1024) * p.renditions.length;
  const storageYuan = p.retainDays > 0 ? (storageGb * (p.retainDays / 30)) * p.storagePricePerGbMonth : 0;

  const cdnYuan = egressGb * p.cdnPricePerGb;
  const totalYuan = cdnYuan + transcodeYuan + storageYuan;
  return {
    egressGb: Math.round(egressGb),
    cdnYuan: Math.round(cdnYuan),
    transcodeYuan: Math.round(transcodeYuan),
    storageYuan: Math.round(storageYuan),
    totalYuan: Math.round(totalYuan),
    perViewerYuan: Math.round((totalYuan / p.viewers) * 100) / 100,
  };
}

/** 新增一个档位的边际成本——回答「值不值得多转一档」 */
function marginalCost(p: Plan, extra: Rendition): number {
  const before = estimate(p);
  const after = estimate({ ...p, renditions: [...p.renditions, extra], mix: { ...p.mix, [extra.name]: 0 } });
  const transcodeDelta = after.transcodeYuan - before.transcodeYuan;
  const storageDelta = after.storageYuan - before.storageYuan;
  return transcodeDelta + storageDelta; // 该档观众占比为 0,出口流量不变
}

// ---- 断言 ----
const plan: Plan = {
  viewers: 100_000,
  hours: 2,
  renditions: [
    { name: "1080p", mbps: 4 },
    { name: "720p", mbps: 2 },
    { name: "480p", mbps: 1 },
  ],
  mix: { "1080p": 0.2, "720p": 0.5, "480p": 0.3 },
  cdnPricePerGb: 0.2,
  transcodePricePerHour: 30,
  storagePricePerGbMonth: 0.05,
  retainDays: 0,
};

const cost = estimate(plan);
console.assert(cost.egressGb === 195_820, "加权码率 2.228Mbps × 10 万观众 × 2 小时 ≈ 191TB");
console.assert(cost.cdnYuan === 39_164, "CDN 费用 = 出口 GB × 单价");
console.assert(cost.transcodeYuan === 180, "转码按档位数 × 时长,与观众数无关");
console.assert(cost.storageYuan === 0, "不保留回放则无存储费");
console.assert(cost.perViewerYuan === 0.39, "人均成本应可解释");

const planNoRetain = estimate(plan, 3);
console.assert(planNoRetain.cdnYuan === 117_492, "跨境三区域单价与流量同步放大");

const retained = estimate({ ...plan, retainDays: 30 });
console.assert(retained.storageYuan === 1, "保留 30 天 = 一个月存储费,约 11GB × 0.05 元");

let badMix = false;
try {
  estimate({ ...plan, mix: { "1080p": 0.2, "720p": 0.5 } });
} catch {
  badMix = true;
}
console.assert(badMix, "档位分布合计不为 1 必须报错,而不是静默少算");

let unknown = false;
try {
  estimate({ ...plan, renditions: [...plan.renditions, { name: "4K", mbps: 15 }] });
} catch {
  unknown = true;
}
console.assert(unknown, "新增档位缺观众分布必须报错");

const with4k = estimate({
  ...plan,
  renditions: [...plan.renditions, { name: "4K", mbps: 15 }],
  mix: { ...plan.mix, "4K": 0 },
});
console.assert(
  with4k.totalYuan - cost.totalYuan === marginalCost(plan, { name: "4K", mbps: 15 }),
  "边际成本 = 新增档位的转码 + 存储增量",
);
console.assert(
  with4k.totalYuan - cost.totalYuan < cost.totalYuan * 0.05,
  "零观众档位的边际成本很小,但一旦有人看,出口流量会按 15Mbps 放大",
);

const all4k = estimate({
  ...plan,
  renditions: [...plan.renditions, { name: "4K", mbps: 15 }],
  mix: { "4K": 0.5, "1080p": 0.1, "720p": 0.2, "480p": 0.2 },
});
console.assert(all4k.cdnYuan > cost.cdnYuan * 3, "半数观众看 4K 时 CDN 成本超过三倍");

console.log("✅ 出口流量 / 转码固定成本 / 回放存储 / 边际成本全部通过");
