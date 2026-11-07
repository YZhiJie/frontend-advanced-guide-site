// 文件: examples/69-03-spa-pageview.ts
// ============ SPA 路由 pageview + 停留时长心跳：纯逻辑模拟（虚拟时钟，不依赖真实浏览器） ============
// SPA 没有整页加载，pageview 必须在路由切换时手动埋；
// 停留时长不能只看路由切换的时间差——切后台的时间必须用心跳剔除（visibilitychange）。

/** 硬断言：console.assert 在 Node 里只打印不退出，门禁需要的是「错了就红」 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 虚拟时钟：让演示可重复、可断言 ----------------

let now = 0; // 虚拟时间轴（ms），演示里手动推进
const clock = (): number => now;

// ---------------- 模拟路由：patch history 的思想，用最小对象演示 ----------------

type RouteHook = (to: string, from: string) => void;

/** 等价于「patch history.pushState」的最小实现：原生方法执行后派发路由事件 */
class MockHistory {
  private stack: string[] = ["/home"];
  private listeners = new Set<RouteHook>();

  current(): string {
    return this.stack[this.stack.length - 1];
  }

  /** 模拟浏览器 pushState：框架路由守卫之外最底层的拦截至高点 */
  pushState(path: string): void {
    const from = this.current();
    this.stack.push(path);
    this.emit(path, from);
  }

  /** 模拟浏览器前进/后退（popstate） */
  back(): void {
    if (this.stack.length <= 1) return;
    const from = this.stack.pop()!;
    this.emit(this.current(), from);
  }

  onRouteChange(fn: RouteHook): void {
    this.listeners.add(fn);
  }

  private emit(to: string, from: string): void {
    for (const fn of this.listeners) fn(to, from);
  }
}

// ---------------- pageview 追踪器：进入页面起表，离开页面结算 ----------------

interface PageviewEvent {
  name: "page_view";
  props: {
    page: string;
    referer: string; // 上一页，漏斗分析的「来源」维度
    enter_at: number;
  };
}

interface PageStayEvent {
  name: "page_stay";
  props: {
    page: string;
    duration_ms: number; // 只累计「前台可见」的时间
    heartbeats: number;
  };
}

type EmitFn = (e: PageviewEvent | PageStayEvent) => void;

const HEARTBEAT_MS = 5000; // 5 秒一次心跳

class PageTracker {
  private currentPage: string;
  private visibleMs = 0; // 本页累计前台可见时长
  private heartbeats = 0;
  private visible = true;
  /** 最近一次「已记账」的时间点：进入页面 / 每次心跳 / 从后台回前台 时刷新 */
  private lastTickAt: number;

  constructor(
    private emit: EmitFn,
    initialPage: string,
  ) {
    this.currentPage = initialPage;
    this.lastTickAt = clock();
    this.emit({
      name: "page_view",
      props: { page: initialPage, referer: "", enter_at: this.lastTickAt },
    });
  }

  /** 路由切换：结算旧页 → 起新页。框架钩子里调它就一行 */
  onRouteChange(to: string, from: string): void {
    this.settle(); // 旧页停留时长结算
    this.emit({
      name: "page_view",
      props: { page: to, referer: from, enter_at: clock() },
    });
    this.currentPage = to;
    this.lastTickAt = clock();
    this.visibleMs = 0;
    this.heartbeats = 0;
  }

  /** 心跳：每 5s 一跳，只有前台可见时才累计——切后台的时间天然剔除 */
  heartbeat(): void {
    if (!this.visible) return;
    this.visibleMs += clock() - this.lastTickAt; // 累计距上次记账的真实时长
    this.lastTickAt = clock();
    this.heartbeats++;
  }

  /** visibilitychange 模拟入口：hidden 暂停累计，visible 恢复时重置记账起点 */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.lastTickAt = clock(); // 关键：后台那段时间从「记账起点」里抹掉
  }

  /** 结算当前页（路由离开 / 页面卸载前调用） */
  settle(): void {
    // 不足一个心跳周期的零头：可见时按「距上次记账的真实时长」补记，
    // 避免「看了 3 秒就走」完全丢失；隐藏中则零头为 0（时间轴已冻结）
    const tail = this.visible ? clock() - this.lastTickAt : 0;
    const total = this.visibleMs + Math.max(0, tail);
    this.emit({
      name: "page_stay",
      props: { page: this.currentPage, duration_ms: total, heartbeats: this.heartbeats },
    });
  }
}

// ---------------- 演示 ----------------

function main() {
  console.log("===== 场景：/home 看 12 秒 → 详情页看 5s 切后台 20s 再回来看 5s → 返回首页 =====");

  const events: Array<PageviewEvent | PageStayEvent> = [];
  const history = new MockHistory();
  const tracker = new PageTracker((e) => {
    events.push(e);
    if (e.name === "page_view") {
      console.log(
        `[事件] page_view  page=${e.props.page}  referer=${e.props.referer || "(直接打开)"}`,
      );
    } else {
      console.log(
        `[事件] page_stay  page=${e.props.page}  duration=${e.props.duration_ms}ms（${e.props.heartbeats} 次心跳）`,
      );
    }
  }, history.current());
  history.onRouteChange((to, from) => tracker.onRouteChange(to, from));

  // /home：跳 2 次心跳（10s），零头 2s，共 12s
  now += HEARTBEAT_MS;
  tracker.heartbeat();
  now += HEARTBEAT_MS;
  tracker.heartbeat();
  now += 2000;

  // 跳详情页：/home 结算 12s
  history.pushState("/detail/42");

  // 详情页看 5s 后切后台 20s（心跳不计），再回来看 5s 后返回
  now += HEARTBEAT_MS;
  tracker.heartbeat();
  tracker.setVisible(false); // 切后台：锁屏/切 App，iOS 上 unload 不触发，全靠 visibilitychange
  now += 20000;
  tracker.heartbeat(); // 后台心跳应被忽略
  tracker.heartbeat();
  tracker.setVisible(true); // 回前台：记账起点重置，后台 20s 从时间轴抹掉
  now += HEARTBEAT_MS;
  tracker.heartbeat();

  // 返回首页：/detail/42 结算应只有前台 10s，不含后台 20s
  history.back();

  // 首页又看了 3s，卸载前结算最后一页（不足一个心跳的零头也要补记）
  now += 3000;
  tracker.settle();

  console.log("\n===== 断言 =====");
  const stayHome = events.find(
    (e): e is PageStayEvent => e.name === "page_stay" && e.props.page === "/home",
  )!;
  assert(stayHome.props.duration_ms === 12000, `/home 停留意应为 12s，实际 ${stayHome.props.duration_ms}`);
  console.log(`/home 停留 12000ms ✅（2 次心跳 + 2s 零头）`);

  const stayDetail = events.find(
    (e): e is PageStayEvent => e.name === "page_stay" && e.props.page === "/detail/42",
  )!;
  assert(
    stayDetail.props.duration_ms === 10000,
    `后台 20s 不应计入，应为 10s，实际 ${stayDetail.props.duration_ms}`,
  );
  console.log(`/detail/42 停留 10000ms ✅（切后台 20s 被心跳机制剔除）`);

  const stayHome2 = events.filter(
    (e): e is PageStayEvent => e.name === "page_stay" && e.props.page === "/home",
  )[1];
  assert(stayHome2.props.duration_ms === 3000, `返回后 3s 零头应补记，实际 ${stayHome2.props.duration_ms}`);
  console.log("返回首页 3s（不足一个心跳周期）零头补记 ✅");

  const pvDetail = events.find(
    (e): e is PageviewEvent => e.name === "page_view" && e.props.page === "/detail/42",
  )!;
  assert(pvDetail.props.referer === "/home", "referer 应记录来源页");
  const pvBack = events.filter((e) => e.name === "page_view").at(-1) as PageviewEvent;
  assert(
    pvBack.props.page === "/home" && pvBack.props.referer === "/detail/42",
    "后退也应产生 page_view，referer 为详情页",
  );
  console.log("page_view 链路（含后退）referer 完整 ✅");

  console.log("\n✅ SPA pageview 与停留时长心跳全部演示通过");
}

main();
