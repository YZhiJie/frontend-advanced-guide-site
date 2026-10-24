// 文件: examples/08-02-page-stack.ts —— [Node] 模拟小程序页面栈:10 层上限 / 返回传参 / 与浏览器历史栈的差异
// ============ 小程序的路由模型:逻辑层自维护的"单向栈"(只有后退,没有前进)============

interface Page {
  path: string;
  query: Record<string, string>;
  data: Record<string, unknown>;
}

class MiniRouter {
  /** 页面栈:栈底是首页、栈顶是当前页;数组本身不含"前进栈"(与浏览器历史不同) */
  private stack: Page[] = [];

  /** navigateTo:入栈(打开新页面),受 10 层硬限制保护 */
  navigateTo(path: string, query: Record<string, string> = {}): void {
    if (this.stack.length >= 10) {
      throw new Error(
        `navigateTo:fail 页面栈已满(上限 10 层),当前 ${this.stack.length} 层`,
      );
    }
    this.stack.push({ path, query, data: {} });
  }

  /** redirectTo:替换当前栈顶,栈深不变 */
  redirectTo(path: string, query: Record<string, string> = {}): void {
    if (this.stack.length === 0) throw new Error("redirectTo:fail 页面栈为空");
    this.stack[this.stack.length - 1] = { path, query, data: {} };
  }

  /** switchTab / reLaunch:清空页面栈后重建(只保留目标页) */
  switchTab(path: string): void {
    this.stack = [{ path, query: {}, data: {} }];
  }

  /** navigateBack:出栈,只能"后退"、没有"前进";delta 可一次退多层 */
  navigateBack(delta = 1): void {
    if (this.stack.length <= 1)
      throw new Error("navigateBack:fail 已经是首页,无法再退");
    this.stack.splice(Math.max(1, this.stack.length - delta), delta);
  }

  /** 返回传参:改写目标页 data,等价于小程序 eventChannel 的参数回传 */
  backWithData(
    targetStackIndex: number,
    payload: Record<string, unknown>,
  ): void {
    const target = this.stack[targetStackIndex];
    if (!target) throw new Error("目标页不在栈中");
    Object.assign(target.data, payload);
  }

  get depth(): number {
    return this.stack.length;
  }

  /** 对应小程序 getCurrentPages():返回栈内各页的 path?query */
  snapshot(): string[] {
    return this.stack.map((p) => {
      const qs = new URLSearchParams(p.query).toString();
      return qs ? `${p.path}?${qs}` : p.path;
    });
  }

  pageAt(index: number): Page {
    return this.stack[index];
  }
}

// ============ 场景一:入栈、返回传参、后退 ============
const router = new MiniRouter();
router.navigateTo("pages/home/index");
router.navigateTo("pages/list/index", { keyword: "键盘" });
router.navigateTo("pages/detail/index", { id: "42" });
console.log("当前栈:", router.snapshot().join(" → "));

router.backWithData(1, { selected: "keyboard-42" }); // 详情页把选择结果写回列表页
router.navigateBack();
console.log("返回后栈:", router.snapshot().join(" → "));
console.log("列表页 data:", JSON.stringify(router.pageAt(1).data));

// ============ 场景二:redirectTo 栈深不变;switchTab 清空栈 ============
router.redirectTo("pages/list/index", { keyword: "鼠标" });
console.log(
  "redirectTo 后栈深:",
  router.depth,
  "当前页:",
  router.snapshot().slice(-1)[0],
);

router.switchTab("pages/mine/index");
console.log(
  "switchTab 后栈:",
  router.snapshot().join(" → "),
  "栈深:",
  router.depth,
);

// ============ 场景三:10 层上限与"退到首页"边界 ============
const deep = new MiniRouter();
deep.navigateTo("pages/p1/index");
for (let i = 2; i <= 10; i++) deep.navigateTo(`pages/p${i}/index`);
console.log("压满后栈深:", deep.depth);
try {
  deep.navigateTo("pages/p11/index");
} catch (e) {
  console.log("第 11 层被拒绝:", (e as Error).message);
}

for (let i = 0; i < 9; i++) deep.navigateBack();
console.log(
  "退到首页栈深:",
  deep.depth,
  "当前页:",
  deep.snapshot().slice(-1)[0],
);
try {
  deep.navigateBack();
} catch (e) {
  console.log("首页再退被拒绝:", (e as Error).message);
}
