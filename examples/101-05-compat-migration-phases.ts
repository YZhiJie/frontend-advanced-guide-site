/**
 * 第 101 部分 · Vue 2 → Vue 3 迁移实战
 * 把 @vue/compat 渐进式迁移的"四步走"固化为状态机：
 *   输入项目体检特征（依赖升级 / E2E / 警告数 / 回归 / 灰度 / 清理项），
 *   判定当前所处阶段 + 阻塞项清单，防止"警告被静默豁免后炸在阶段 3"。
 *   阶段语义：
 *     P1 双语义运行：alias 指向 @vue/compat，compatConfig MODE 2，跑通核心链路
 *     P2 警告清零：逐条修复 compat 警告，静默豁免必须留注释说明
 *     P3 去兼容层：移除 alias 与 compat 包，回归 + 灰度监控验证
 *     P4 清理收尾：删干净 compat 配置与临时 lint 豁免
 * 运行：npx tsx examples/101-05-compat-migration-phases.ts
 */
import assert from "node:assert";

type Phase = "P1_双语义运行" | "P2_警告清零" | "P3_去兼容层" | "P4_清理收尾";

interface Audit {
  depsUpgraded: boolean; // router4 / vuex4 / 新组件库 / compiler-sfc 就绪
  e2eGreen: boolean; // 核心链路 E2E 全绿
  openWarnings: number; // 未修复的 compat 警告数
  unexplainedSilenced: number; // 无注释说明的静默豁免数
  regressionPassed: boolean; // 去兼容层后回归测试通过
  grayMetricsStable: boolean; // 灰度放量后监控指标无劣化
  compatAliasRemoved: boolean; // 构建里 vue → @vue/compat 的 alias 已删
  lintExemptionsRemoved: boolean; // 迁移期临时 lint 豁免已清
}

const ORDER: Phase[] = ["P1_双语义运行", "P2_警告清零", "P3_去兼容层", "P4_清理收尾"];

function currentPhase(a: Audit): { phase: Phase; blockers: string[] } {
  const blockers: string[] = [];
  if (!a.depsUpgraded || !a.e2eGreen) {
    if (!a.depsUpgraded) blockers.push("依赖未升级到 Vue3 生态（router4 / vuex4 / 组件库 / compiler-sfc）");
    if (!a.e2eGreen) blockers.push("核心链路 E2E 未全绿，禁止进入警告修复阶段");
    return { phase: "P1_双语义运行", blockers };
  }
  if (a.openWarnings > 0 || a.unexplainedSilenced > 0) {
    if (a.openWarnings > 0) blockers.push(`仍有 ${a.openWarnings} 条 compat 警告未修复`);
    if (a.unexplainedSilenced > 0) blockers.push(`有 ${a.unexplainedSilenced} 条静默豁免缺注释说明（阶段 3 必炸项）`);
    return { phase: "P2_警告清零", blockers };
  }
  if (!a.regressionPassed || !a.grayMetricsStable) {
    if (!a.regressionPassed) blockers.push("去兼容层后回归测试未通过");
    if (!a.grayMetricsStable) blockers.push("灰度监控指标劣化（报错率/性能分桶对照）");
    return { phase: "P3_去兼容层", blockers };
  }
  if (!a.compatAliasRemoved || !a.lintExemptionsRemoved) {
    if (!a.compatAliasRemoved) blockers.push("构建中 compat alias 未删除，项目仍在兼容层上运行");
    if (!a.lintExemptionsRemoved) blockers.push("迁移期临时 lint 豁免未清理，防回退门禁未闭合");
    return { phase: "P4_清理收尾", blockers };
  }
  return { phase: "P4_清理收尾", blockers: [] };
}

// ---------- 1. 典型项目体检：逐阶段推进 ----------
const base: Audit = {
  depsUpgraded: false,
  e2eGreen: false,
  openWarnings: 12,
  unexplainedSilenced: 2,
  regressionPassed: false,
  grayMetricsStable: false,
  compatAliasRemoved: false,
  lintExemptionsRemoved: false,
};

// 场景 A：刚立项，依赖没升级 → 卡在 P1
let r = currentPhase(base);
assert.equal(r.phase, "P1_双语义运行");
assert.ok(r.blockers.some((b) => b.includes("依赖未升级")));
console.log("[A] 立项期 →", r.phase, "｜阻塞：", r.blockers.join("；"));

// 场景 B：依赖 + E2E 就绪，但还有警告与无说明豁免 → 卡在 P2
r = currentPhase({ ...base, depsUpgraded: true, e2eGreen: true });
assert.equal(r.phase, "P2_警告清零");
assert.equal(r.blockers.length, 2, "警告与静默豁免是两个独立阻塞项");
assert.ok(r.blockers.some((b) => b.includes("必炸项")), "无注释豁免要显式标为阶段 3 必炸项");
console.log("[B] 修复期 →", r.phase, "｜阻塞：", r.blockers.join("；"));

// 场景 C：警告清零，但回归未过 / 灰度劣化 → 卡在 P3
r = currentPhase({
  ...base,
  depsUpgraded: true,
  e2eGreen: true,
  openWarnings: 0,
  unexplainedSilenced: 0,
  regressionPassed: false,
  grayMetricsStable: false,
});
assert.equal(r.phase, "P3_去兼容层");
assert.equal(r.blockers.length, 2);
console.log("[C] 去兼容层期 →", r.phase, "｜阻塞：", r.blockers.join("；"));

// 场景 D：回归 + 灰度通过，但 compat 配置没删干净 → 卡在 P4
r = currentPhase({
  ...base,
  depsUpgraded: true,
  e2eGreen: true,
  openWarnings: 0,
  unexplainedSilenced: 0,
  regressionPassed: true,
  grayMetricsStable: true,
});
assert.equal(r.phase, "P4_清理收尾");
assert.ok(r.blockers.some((b) => b.includes("alias 未删除")));
console.log("[D] 清理期 →", r.phase, "｜阻塞：", r.blockers.join("；"));

// 场景 E：全部就绪 → P4 无阻塞，迁移正式收官
const done: Audit = {
  depsUpgraded: true,
  e2eGreen: true,
  openWarnings: 0,
  unexplainedSilenced: 0,
  regressionPassed: true,
  grayMetricsStable: true,
  compatAliasRemoved: true,
  lintExemptionsRemoved: true,
};
r = currentPhase(done);
assert.deepEqual(r, { phase: "P4_清理收尾", blockers: [] });
console.log("[E] 收官 →", r.phase, "｜阻塞：无");

// ---------- 2. 单调性：阶段判定不回退（体检特征只进不退的检查） ----------
function phaseIndex(a: Audit): number {
  return ORDER.indexOf(currentPhase(a).phase);
}
const progressed: Audit[] = [
  base,
  { ...base, depsUpgraded: true, e2eGreen: true },
  { ...base, depsUpgraded: true, e2eGreen: true, openWarnings: 0, unexplainedSilenced: 0 },
  done,
];
const indexes = progressed.map(phaseIndex);
assert.deepEqual(
  indexes,
  indexes.slice().sort((x, y) => x - y),
  "推进过程阶段索引必须单调不减",
);
console.log("[2] 阶段单调性校验通过：", indexes.map((i) => ORDER[i]).join(" → "));

// ---------- 3. 高危反例：静默豁免压警告，P3 一移除 compat 就炸 ----------
const cheat: Audit = {
  ...{ ...base, depsUpgraded: true, e2eGreen: true },
  openWarnings: 0,
  unexplainedSilenced: 5, // 警告"压掉"了但没修
};
const cheatResult = currentPhase(cheat);
assert.equal(cheatResult.phase, "P2_警告清零", "压警告过不了 P2 门禁");
assert.ok(cheatResult.blockers.some((b) => b.includes("5 条静默豁免")));
console.log("[3] 反例拦截通过：silenceWarnings 压掉 5 条豁免 → 仍卡在", cheatResult.phase);

console.log("✅ 101-05 全部断言通过");
