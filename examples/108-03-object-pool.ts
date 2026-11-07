// 文件: examples/108-03-object-pool.ts
// 对象池：高频创建/销毁对象（子弹、粒子、伤害数字）的复用容器
// 目标：消灭 GC 抖动——60fps 下每帧 new 几百个对象会触发频繁 minor GC，表现为规律性掉帧

import assert from "node:assert";

class ObjectPool<T> {
  private free: T[] = []; // 空闲队列
  private inUse = new Set<T>(); // 使用中集合（防重复归还）
  created = 0; // 真正 new 的次数
  reused = 0; // 复用次数
  constructor(
    private factory: () => T,
    private reset: (obj: T) => void, // 回收时重置状态，防止脏数据泄漏到下次使用
    private max = 128, // 池上限：防内存无限膨胀
  ) {}

  acquire(): T {
    let obj: T;
    if (this.free.length > 0) {
      obj = this.free.pop()!;
      this.reused++;
    } else {
      obj = this.factory();
      this.created++;
    }
    this.inUse.add(obj);
    return obj;
  }

  release(obj: T): void {
    if (!this.inUse.has(obj)) return; // 重复归还直接忽略（防呆）
    this.inUse.delete(obj);
    this.reset(obj);
    if (this.free.length < this.max) this.free.push(obj); // 超上限就丢给 GC
  }

  get activeCount(): number {
    return this.inUse.size;
  }
  get idleCount(): number {
    return this.free.length;
  }
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
}

function runAssertions() {
  // ---------- 测试 1：基本获取/归还 ----------
  const pool = new ObjectPool<Bullet>(
    () => ({ x: 0, y: 0, vx: 0, vy: 0, alive: false }),
    (b) => {
      b.alive = false;
      b.x = b.y = b.vx = b.vy = 0;
    },
    64,
  );
  const b1 = pool.acquire();
  b1.alive = true;
  b1.x = 100;
  assert.equal(pool.activeCount, 1);
  pool.release(b1);
  assert.equal(pool.activeCount, 0);
  assert.equal(pool.idleCount, 1);
  const b2 = pool.acquire();
  assert.equal(b2, b1, "应复用同一对象");
  assert.equal(b2.x, 0, "reset 应清空脏数据");
  console.log("[1/4] 获取/归还 OK, created:", pool.created, "reused:", pool.reused);

  // ---------- 测试 2：高频发射 200 发子弹，创建数受上限约束 ----------
  const bullets: Bullet[] = [];
  for (let wave = 0; wave < 200; wave++) {
    const b = pool.acquire();
    b.alive = true;
    bullets.push(b);
    if (bullets.length >= 10) pool.release(bullets.shift()!); // 同屏最多 10 发
  }
  assert.ok(pool.created <= 11, `真实创建应 ≤11，实际 ${pool.created}`);
  assert.ok(pool.reused >= 180, `复用应 ≥180，实际 ${pool.reused}`);
  console.log("[2/4] 高频复用 OK, created:", pool.created, "reused:", pool.reused);

  // ---------- 测试 3：重复归还防呆 ----------
  const b3 = pool.acquire();
  pool.release(b3);
  const idleBefore = pool.idleCount;
  pool.release(b3); // 第二次归还应被忽略
  assert.equal(pool.idleCount, idleBefore, "重复归还不应入池两次");
  console.log("[3/4] 重复归还防呆 OK");

  // ---------- 测试 4：池上限——空闲对象超 max 后丢弃 ----------
  const small = new ObjectPool<{ n: number }>(() => ({ n: 0 }), (o) => (o.n = 0), 4);
  const objs = Array.from({ length: 10 }, () => small.acquire());
  objs.forEach((o) => small.release(o));
  assert.equal(small.idleCount, 4, "空闲池应封顶在 max=4");
  console.log("[4/4] 池上限 OK, idle:", small.idleCount);

  console.log("\n✅ 108-03 对象池 全部断言通过");
}

runAssertions();
