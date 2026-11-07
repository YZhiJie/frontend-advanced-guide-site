// 文件: examples/108-04-platform-adapter.ts
// 平台适配层：同一份游戏逻辑跑在 H5 浏览器与微信小游戏
// 目标：游戏代码只依赖抽象接口，环境差异（canvas 获取、存储、生命周期）收敛到一处

import assert from "node:assert";

/** 游戏代码只面向这个接口编程 */
interface PlatformAdapter {
  readonly name: "h5" | "wxgame";
  getScreenSize(): { width: number; height: number; dpr: number };
  storageGet(key: string): string | null;
  storageSet(key: string, value: string): void;
  onShow(cb: () => void): void; // 回到前台（小游戏 onShow / H5 visibilitychange）
  onHide(cb: () => void): void; // 切到后台
}

/** 环境探测：小游戏的标志是全局 wx 对象且带 createCanvas */
function detectPlatform(env: Record<string, unknown>): "h5" | "wxgame" {
  const wx = env.wx as { createCanvas?: unknown } | undefined;
  if (wx && typeof wx.createCanvas === "function") return "wxgame";
  if (typeof env.document !== "undefined") return "h5";
  throw new Error("未知运行环境：既没有 wx.createCanvas 也没有 document");
}

/** H5 实现：localStorage + visibilitychange */
function createH5Adapter(env: {
  document: { hidden: boolean; addEventListener: (t: string, cb: () => void) => void };
  localStorage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
}): PlatformAdapter {
  return {
    name: "h5",
    getScreenSize: () => ({
      width: env.innerWidth,
      height: env.innerHeight,
      dpr: env.devicePixelRatio,
    }),
    storageGet: (k) => env.localStorage.getItem(k),
    storageSet: (k, v) => env.localStorage.setItem(k, v),
    onShow: (cb) =>
      env.document.addEventListener("visibilitychange", () => {
        if (!env.document.hidden) cb();
      }),
    onHide: (cb) =>
      env.document.addEventListener("visibilitychange", () => {
        if (env.document.hidden) cb();
      }),
  };
}

/** 微信小游戏实现：wx API */
function createWxAdapter(wx: {
  getSystemInfoSync(): { windowWidth: number; windowHeight: number; pixelRatio: number };
  getStorageSync(k: string): string;
  setStorageSync(k: string, v: string): void;
  onShow(cb: () => void): void;
  onHide(cb: () => void): void;
}): PlatformAdapter {
  return {
    name: "wxgame",
    getScreenSize: () => {
      const info = wx.getSystemInfoSync();
      return { width: info.windowWidth, height: info.windowHeight, dpr: info.pixelRatio };
    },
    // 小游戏 getStorageSync 无值时返回空字符串而非 null，这里统一成 null
    storageGet: (k) => {
      const v = wx.getStorageSync(k);
      return v === "" ? null : v;
    },
    storageSet: (k, v) => wx.setStorageSync(k, v),
    onShow: (cb) => wx.onShow(cb),
    onHide: (cb) => wx.onHide(cb),
  };
}

/** 游戏逻辑：只面向 PlatformAdapter，不知道自己在哪个平台 */
function saveHighScore(platform: PlatformAdapter, score: number): number {
  const prev = Number(platform.storageGet("high_score") ?? 0);
  const best = Math.max(prev, score);
  platform.storageSet("high_score", String(best));
  return best;
}

function runAssertions() {
  // ---------- 测试 1：环境探测 ----------
  const fakeWx = {
    createCanvas: () => ({}),
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 3 }),
    _store: new Map<string, string>(),
    getStorageSync(k: string) { return this._store.get(k) ?? ""; },
    setStorageSync(k: string, v: string) { this._store.set(k, v); },
    onShow(_cb: () => void) {},
    onHide(_cb: () => void) {},
  };
  const fakeH5Env = {
    document: { hidden: false, addEventListener: (_t: string, _cb: () => void) => {} },
    localStorage: {
      _m: new Map<string, string>(),
      getItem(k: string) { return this._m.get(k) ?? null; },
      setItem(k: string, v: string) { this._m.set(k, v); },
    },
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 2,
  };
  assert.equal(detectPlatform({ wx: fakeWx }), "wxgame");
  assert.equal(detectPlatform(fakeH5Env as unknown as Record<string, unknown>), "h5");
  assert.throws(() => detectPlatform({}), /未知运行环境/);
  console.log("[1/4] 环境探测 OK");

  // ---------- 测试 2：同一游戏逻辑在两个平台行为一致 ----------
  const wxAdapter = createWxAdapter(fakeWx);
  const h5Adapter = createH5Adapter(fakeH5Env);
  assert.equal(saveHighScore(wxAdapter, 800), 800);
  assert.equal(saveHighScore(wxAdapter, 500), 800); // 不覆盖更高分
  assert.equal(saveHighScore(h5Adapter, 1200), 1200);
  assert.equal(saveHighScore(h5Adapter, 300), 1200);
  console.log("[2/4] 跨平台逻辑一致 OK, wx best:", saveHighScore(wxAdapter, 0), "h5 best:", saveHighScore(h5Adapter, 0));

  // ---------- 测试 3：存储差异归一化（空串 vs null） ----------
  assert.equal(wxAdapter.storageGet("not_exist"), null, "小游戏空值应统一为 null");
  assert.equal(h5Adapter.storageGet("not_exist"), null);
  console.log("[3/4] 存储空值归一化 OK");

  // ---------- 测试 4：屏幕尺寸含 DPR（高清屏适配必需） ----------
  assert.deepEqual(wxAdapter.getScreenSize(), { width: 375, height: 667, dpr: 3 });
  assert.deepEqual(h5Adapter.getScreenSize(), { width: 390, height: 844, dpr: 2 });
  console.log("[4/4] 屏幕尺寸 OK");

  console.log("\n✅ 108-04 平台适配层 全部断言通过");
}

runAssertions();
