// 文件: examples/30-01-lodash-toolkit.ts
// ============ lodash-es 工具箱：具名导入 + 聚合排序 + 安全取值 + 防抖 ============
// 对应 30.2「入门：高频 API 与 iteratee」与 30.3「安全边界与异步控制」：
// - 全部用具名导入（可摇树），不出现默认导入；
// - 聚合链路 groupBy → orderBy → mapValues 全程不改入参；
// - 深路径读取先 has 再 get，原型链属性不会被误当成业务字段；
// - debounce 收口成带 cancel/flush 的保存器，靠真实计时验证。

import {
  chunk,
  debounce,
  differenceBy,
  get,
  groupBy,
  has,
  keyBy,
  mapValues,
  orderBy,
  uniqBy,
} from "lodash-es";

/** 硬断言：console.assert 在 Node 里不阻断，脚本需要「错了就红」 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

interface User {
  id: string;
  name: string;
  role: "admin" | "editor";
  score: number;
}

const users: User[] = [
  { id: "u-1", name: "Ada", role: "admin", score: 92 },
  { id: "u-2", name: "Bob", role: "editor", score: 88 },
  { id: "u-3", name: "Cid", role: "admin", score: 95 },
];
const originalFirst = users[0]?.name;

// 1) 分组后可做组内多字段排序：orderBy 返回新数组，原数组顺序不变
const byRole = groupBy(users, "role");
const ranked = mapValues(byRole, (list) => orderBy(list, ["score"], ["desc"]));
console.log("组内排名：", ranked.admin.map((user) => `${user.name}/${user.score}`).join(", "));
assert(ranked.admin?.[0]?.name === "Cid", "admin 组应按分数倒序，首位是 Cid");
assert(users[0]?.name === originalFirst, "orderBy 不应修改入参数组");

// 2) 索引与去重：keyBy 建 O(1) 字典，uniqBy 按业务键保留首次出现
const byId = keyBy(users, "id");
const uniqueRoles = uniqBy(users, (user) => user.role);
assert(byId["u-2"]?.name === "Bob", "keyBy 应以 id 为键");
assert(uniqueRoles.length === 2, "按 role 去重应得到 2 条");

// 3) 集合差集与切片：分页取第一页
const active = users.filter((user) => user.score >= 90);
const stale = differenceBy(active, users.slice(0, 1), "id");
const firstPage = chunk(users, 2)[0] ?? [];
console.log("活跃：", active.map((user) => user.name).join(", "), "| 差集：", stale.map((user) => user.name).join(", "));
assert(stale.length === 1 && stale[0]?.name === "Cid", "差集应只剩 Cid");
assert(firstPage.length === 2, "chunk(users, 2) 首页应有 2 条");

// 4) 安全取值：has 只认自有属性路径，原型链上的属性一律拦下
const snapshot = { order: { owner: { name: "Ada" } } };
const ownName = has(snapshot, "order.owner.name") ? get(snapshot, "order.owner.name") : "未知";
const protoVerdict = has(snapshot, "order.toString") ? get(snapshot, "order.toString") : "未知";
console.log("自有路径：", ownName, "| 原型链路径：", protoVerdict);
assert(ownName === "Ada", "自有深层路径应取到 Ada");
assert(protoVerdict === "未知", "原型链路径必须回退 fallback");

// 5) 防抖保存器：窗口内多次调用只落盘最后一次，flush 立即执行
const saved: string[] = [];
const saver = debounce((draft: string) => saved.push(draft), 30);
saver("v1");
saver("v2");
saver("v3");
await new Promise((resolve) => setTimeout(resolve, 60));
assert(saved.length === 1 && saved[0] === "v3", "30ms 静默后只应保存最后一次 v3");
saver.cancel();
console.log("保存次数：", saved.length, "| 最后落盘：", saved[0]);

console.log("✓ 30-01 lodash-es 工具箱断言全部通过");
