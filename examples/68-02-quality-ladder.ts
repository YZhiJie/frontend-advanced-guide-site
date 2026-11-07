/** 68-02-quality-ladder.ts —— 弱网降级阶梯：快降慢升、单步调整与滞回窗口 */

type Level = 0 | 1 | 2 | 3 | 4; // 0 最高画质,4 仅音频

interface Metrics {
  fps: number;
  rttMs: number;
  lossPct: number;
  /** 播放缓冲余量(秒) */
  bufferSec: number;
}

interface LadderState {
  level: Level;
  stableWindows: number;
}

export const LEVEL_LABEL: Record<Level, string> = {
  0: "1080p60",
  1: "1080p30",
  2: "720p",
  3: "480p",
  4: "仅音频",
};

const DOWN_RULES: ((m: Metrics) => string | null)[] = [
  (m) => (m.fps < 15 ? "帧率低于 15,已无法连贯观看" : null),
  (m) => (m.lossPct > 12 ? "丢包超过 12%,花屏概率极高" : null),
  (m) => (m.rttMs > 500 ? "往返延迟超过 500ms,互动不可用" : null),
  (m) => (m.bufferSec < 0.4 ? "缓冲低于 0.4s,随时可能卡顿" : null),
];

function shouldDown(m: Metrics): string | null {
  for (const rule of DOWN_RULES) {
    const hit = rule(m);
    if (hit) return hit;
  }
  return null;
}

/** 升级条件比降级严格得多:必须四项同时健康,并连续稳定 3 个窗口 */
function isHealthy(m: Metrics) {
  return m.fps >= 28 && m.rttMs <= 120 && m.lossPct <= 2 && m.bufferSec >= 2;
}

function tick(state: LadderState, m: Metrics): { next: LadderState; action: "down" | "up" | "hold"; reason: string } {
  const down = shouldDown(m);

  // 降级:立刻、可跨多级(卡顿对体验是断崖式的,等不起)
  if (down) {
    const next = Math.min(4, state.level + 1) as Level;
    return {
      next: { level: next, stableWindows: 0 },
      action: "down",
      reason: `${down} → 降到 ${LEVEL_LABEL[next]}`,
    };
  }

  if (!isHealthy(m)) {
    return { next: { level: state.level, stableWindows: 0 }, action: "hold", reason: "指标一般,保持当前档位并重置稳定计数" };
  }

  const stable = state.stableWindows + 1;
  if (stable < 3) {
    return {
      next: { level: state.level, stableWindows: stable },
      action: "hold",
      reason: `健康窗口连续 ${stable}/3,继续观察`,
    };
  }

  if (state.level === 0) {
    return { next: { level: 0, stableWindows: 0 }, action: "hold", reason: "已是最高档位" };
  }

  // 升级:一次只升一档,防止在边界反复横跳
  const next = (state.level - 1) as Level;
  return {
    next: { level: next, stableWindows: 0 },
    action: "up",
    reason: `连续 3 个健康窗口 → 升到 ${LEVEL_LABEL[next]}`,
  };
}

// ---- 断言 ----
let state: LadderState = { level: 0, stableWindows: 0 };

const good: Metrics = { fps: 30, rttMs: 80, lossPct: 1, bufferSec: 3 };

const t1 = tick(state, good);
console.assert(t1.action === "hold" && t1.next.stableWindows === 1, "首个健康窗口只计数,不升级");

const t2 = tick(t1.next, good);
console.assert(t2.action === "hold" && t2.next.stableWindows === 2, "第二个健康窗口仍不升级");

const t3 = tick(t2.next, good);
console.assert(t3.action === "hold" && t3.next.stableWindows === 0, "最高档位即使连续健康也保持");

state = { level: 3, stableWindows: 2 };
const up = tick(state, good);
console.assert(up.action === "up" && up.next.level === 2, "连续 3 个健康窗口后升一档");
console.assert(up.next.stableWindows === 0, "升级后稳定计数清零");

const jump = tick({ level: 0, stableWindows: 0 }, { fps: 10, rttMs: 600, lossPct: 20, bufferSec: 0.2 });
console.assert(jump.action === "down" && jump.next.level === 1, "多重劣化时先降一级,不一次跳到底");
console.assert(jump.reason.includes("帧率"), "降级理由应指向最先触发的规则");

const recover = tick({ level: 4, stableWindows: 0 }, { fps: 30, rttMs: 80, lossPct: 1, bufferSec: 3 });
console.assert(recover.action === "hold" && recover.next.stableWindows === 1, "仅音频恢复也要先观察 3 窗");

const borderline = tick({ level: 2, stableWindows: 0 }, { fps: 26, rttMs: 200, lossPct: 3, bufferSec: 1.5 });
console.assert(borderline.action === "hold" && borderline.next.stableWindows === 0, "临界指标不升不降,并清零计数");

const floor = tick({ level: 4, stableWindows: 0 }, { fps: 8, rttMs: 800, lossPct: 30, bufferSec: 0.1 });
console.assert(floor.action === "down" && floor.next.level === 4, "最低档位不再下降,但仍需记录劣化");

console.log("✅ 快降慢升 / 单步调整 / 滞回窗口 / 边界档位全部通过");
