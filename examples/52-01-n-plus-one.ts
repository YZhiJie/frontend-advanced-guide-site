// 文件: examples/52-01-n-plus-one.ts
// ============ N+1 查询与批量加载:同样是「取 20 个订单」,为什么一个 21 次、一个 2 次 ============
// 设计要点:
// 1) N+1 的根因是「循环里访问关联数据」,ORM 的懒加载最容易触发;
// 2) 修复方式不是加缓存,而是把「逐个查」改成「批量查 + 内存 join」;
// 3) 批量查询要防 id 爆炸:分片(如每 500 个一批)+ 去重。

interface Order {
  id: number;
  userId: number;
  amount: number;
}

interface User {
  id: number;
  name: string;
}

class FakeDb {
  queryCount = 0;
  private users: User[];

  constructor(size = 1000) {
    this.users = Array.from({ length: size }, (_, i) => ({ id: i + 1, name: `用户${i + 1}` }));
  }

  async getOrderPage(limit: number): Promise<Order[]> {
    this.queryCount++;
    await delay(1);
    return Array.from({ length: limit }, (_, i) => ({
      id: i + 1,
      userId: ((i * 7) % this.users.length) + 1,
      amount: (i + 1) * 10,
    }));
  }

  /** 单条查询:每次都是一次数据库往返 */
  async getUser(id: number): Promise<User | undefined> {
    this.queryCount++;
    await delay(1);
    return this.users.find((u) => u.id === id);
  }

  /** 批量查询:一次往返拿多个 id,复杂度从 O(N) 降到 O(1) 次查询 */
  async getUsers(ids: number[]): Promise<User[]> {
    this.queryCount++;
    await delay(1);
    const set = new Set(ids);
    return this.users.filter((u) => set.has(u.id));
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 场景 1:典型 N+1 ----------------
const db1 = new FakeDb();
const orders1 = await db1.getOrderPage(20);
const naive: Array<{ orderId: number; userName: string }> = [];
for (const o of orders1) {
  const user = await db1.getUser(o.userId);
  naive.push({ orderId: o.id, userName: user?.name ?? "未知" });
}
console.log(`N+1:订单 ${orders1.length} 条 → 查询 ${db1.queryCount} 次`);
assert(db1.queryCount === 21, "1 次订单查询 + 20 次用户查询");

// ---------------- 场景 2:批量 + 内存 join ----------------
const db2 = new FakeDb();
const orders2 = await db2.getOrderPage(20);
const userIds = [...new Set(orders2.map((o) => o.userId))];
const users = await db2.getUsers(userIds);
const userMap = new Map(users.map((u) => [u.id, u]));
const batched = orders2.map((o) => ({
  orderId: o.id,
  userName: userMap.get(o.userId)?.name ?? "未知",
}));
console.log(`批量:订单 ${orders2.length} 条 / 去重用户 ${userIds.length} 个 → 查询 ${db2.queryCount} 次`);
assert(db2.queryCount === 2, "订单 1 次 + 用户批量 1 次");
assert(batched[0].userName === naive[0].userName, "结果必须与 N+1 版本一致");

// ---------------- 场景 3:大批量分片 ----------------
const db3 = new FakeDb(2000);
const many = await db3.getOrderPage(1200);
const ids = [...new Set(many.map((o) => o.userId))];
const CHUNK = 500;
let fetched = 0;
for (let i = 0; i < ids.length; i += CHUNK) {
  fetched += (await db3.getUsers(ids.slice(i, i + CHUNK))).length;
}
console.log(`分片:去重用户 ${ids.length} 个,按 ${CHUNK} 分片 → 用户查询 ${Math.ceil(ids.length / CHUNK)} 次`);
assert(db3.queryCount <= 1 + Math.ceil(ids.length / CHUNK), "查询次数应为订单 1 次 + 分片数");
assert(fetched >= ids.length, "分片后仍应覆盖全部用户");

// ---------------- 场景 4:懒加载的隐蔽触发 ----------------
const hidden: Order[] = [{ id: 1, userId: 1, amount: 100 }];
let touched = 0;
const proxy = new Proxy(hidden[0], {
  get(target, prop, receiver) {
    if (prop === "userId") touched++;
    return Reflect.get(target, prop, receiver);
  },
});
void proxy.userId;
void proxy.userId;
console.log(`同一字段访问 2 次 → 懒加载触发 ${touched} 次`);
assert(touched === 2, "序列化/模板里重复访问关联字段会放大 N+1");

console.log("\n结论:先批量、再分片、最后才考虑缓存;N+1 是查询形状问题,不是缓存问题。");

// 标记为模块,避免与其它示例的顶层变量重名
export {};
