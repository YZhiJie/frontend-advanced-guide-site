/** 62-01-unread-badge.ts —— 未读数归约器：分类聚合 + 已读回执幂等 + 乐观扣减与服务端对账 */

type Category = "system" | "todo" | "announcement" | "mention";
interface Notification {
  id: string;
  category: Category;
  read: boolean;
}

// 未读数归约：总数 = 各分类之和;单条已读只扣它所属分类
class UnreadReducer {
  private byCategory = new Map<Category, number>();
  private readIds = new Set<string>(); // 已读回执幂等:同一 id 重复回执不重复扣减

  hydrate(list: Notification[]) {
    this.byCategory.clear();
    this.readIds.clear();
    for (const n of list) {
      if (n.read) this.readIds.add(n.id);
      else this.byCategory.set(n.category, (this.byCategory.get(n.category) ?? 0) + 1);
    }
  }

  // 已读回执：返回是否真的发生了扣减(幂等判定)
  markRead(n: Notification): boolean {
    if (this.readIds.has(n.id)) return false; // 重复回执/重复点击,忽略
    this.readIds.add(n.id);
    const cur = this.byCategory.get(n.category) ?? 0;
    this.byCategory.set(n.category, Math.max(0, cur - 1)); // 下限钳制:不为负
    return true;
  }

  // 批量全部已读：只清指定分类,其他分类不受影响
  markCategoryAllRead(category: Category) {
    this.byCategory.set(category, 0);
  }

  // 新通知推送到达：未读 +1
  onPush(n: Notification) {
    if (n.read || this.readIds.has(n.id)) return;
    this.byCategory.set(n.category, (this.byCategory.get(n.category) ?? 0) + 1);
  }

  count(category?: Category): number {
    if (category) return this.byCategory.get(category) ?? 0;
    let sum = 0;
    for (const v of this.byCategory.values()) sum += v;
    return sum;
  }

  // 服务端对账：本地乐观扣减可能与服务端不一致(他端已读),以服务端为准重置
  reconcile(serverCounts: Record<Category, number>) {
    for (const [c, v] of Object.entries(serverCounts) as [Category, number][]) {
      this.byCategory.set(c, v);
    }
  }
}

// Badge 展示规则：99+ 截断;mention(@我) 用红点样式区别于数字
function badgeText(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

// ---- 断言 ----
const r = new UnreadReducer();
r.hydrate([
  { id: "1", category: "system", read: false },
  { id: "2", category: "system", read: false },
  { id: "3", category: "todo", read: false },
  { id: "4", category: "mention", read: true },
]);
console.assert(r.count() === 3 && r.count("system") === 2, "归约：总数与分类数正确");

// 幂等回执：重复已读不重复扣
console.assert(r.markRead({ id: "1", category: "system", read: false }) === true, "首次回执扣减");
console.assert(r.markRead({ id: "1", category: "system", read: false }) === false, "重复回执幂等");
console.assert(r.count("system") === 1, "重复回执后分类数不变");

// 推送到达与全清
r.onPush({ id: "5", category: "todo", read: false });
console.assert(r.count("todo") === 2, "推送未读+1");
r.markCategoryAllRead("todo");
console.assert(r.count("todo") === 0 && r.count() === 1, "分类全清不影响其他");

// 下限钳制：服务端正推了一条已被对账清掉的重复推送
r.reconcile({ system: 0, todo: 0, announcement: 0, mention: 0 });
console.assert(r.count() === 0, "对账以服务端为准");
r.markRead({ id: "9", category: "system", read: false });
console.assert(r.count("system") === 0, "扣减下限钳制不为负");

// Badge 文案
console.assert(badgeText(0) === "" && badgeText(7) === "7" && badgeText(120) === "99+", "Badge 截断规则");

console.log("✅ 未读归约 / 幂等回执 / 对账 / Badge 规则全部通过");
