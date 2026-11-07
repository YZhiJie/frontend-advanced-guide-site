// 文件: examples/73-02-contract-test.ts
// ============ 契约测试内核:一套 storage 契约用例跑遍三端 adapter,输出一致性报告 ============
// 设计要点:
// 1. 契约用例只写一次,放在 services 层旁边;每个 adapter 的 CI 都必须跑同一套
// 2. 「容量超限必须抛 QuotaExceededError」这类行为契约,比类型签名更难对齐,也最容易违约
// 3. 演示一个真实世界违约:H5 桥接层超容量时静默丢数据——契约测试把它揪出来

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ---------- 被测接口(与 73-01 相同的 services 契约) ----------

interface StorageCapability {
  readonly kind: string;
  readonly quotaMB: number;
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

/** 契约规定的标准化错误:任何端容量超限都必须抛这个名字,业务才能统一 catch */
class QuotaExceededError extends Error {
  override readonly name = "QuotaExceededError";
}

// ---------- 三端 adapter(web/desktop 合规,h5 埋了一个真实违约) ----------

/** Web:localStorage 语义,超 5MB 抛 QuotaExceededError(与浏览器原生行为一致) */
class WebStorageAdapter implements StorageCapability {
  readonly kind = "web-localstorage";
  readonly quotaMB = 5;
  private store = new Map<string, string>();
  private used = 0;
  async set(key: string, value: string) {
    const bytes = key.length + value.length;
    const prev = this.store.has(key) ? key.length + this.store.get(key)!.length : 0;
    if (this.used - prev + bytes > this.quotaMB * 1024 * 1024) {
      throw new QuotaExceededError(`localStorage 超出 ${this.quotaMB}MB 配额`);
    }
    this.used = this.used - prev + bytes;
    this.store.set(key, value);
  }
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async remove(key: string) {
    const v = this.store.get(key);
    if (v !== undefined) this.used -= key.length + v.length;
    this.store.delete(key);
  }
}

/** PC 客户端:原生文件存储,语义与契约完全一致(示例把配额缩到 16MB 便于构造超限用例,真实端按磁盘余量评估) */
class DesktopStorageAdapter implements StorageCapability {
  readonly kind = "native-file";
  readonly quotaMB = 16;
  private files = new Map<string, string>();
  private used = 0;
  async set(key: string, value: string) {
    const bytes = value.length;
    if (this.used + bytes > this.quotaMB * 1024 * 1024) {
      throw new QuotaExceededError(`磁盘配额超出 ${this.quotaMB}MB`);
    }
    this.used += bytes;
    this.files.set(key, value);
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async remove(key: string) {
    const v = this.files.get(key);
    if (v !== undefined) this.used -= v.length;
    this.files.delete(key);
  }
}

/** 移动 H5 桥接存储:真实世界里常见的违约——桥层写入超容量时【静默丢弃】,不报错 */
class H5BridgeStorageAdapter implements StorageCapability {
  readonly kind = "bridge-proxy";
  readonly quotaMB = 4;
  private nativeDb = new Map<string, string>();
  constructor(private readonly silentDropOnOverflow: boolean) {}
  async set(key: string, value: string) {
    if (value.length > this.quotaMB * 1024 * 1024) {
      if (this.silentDropOnOverflow) return; // 违约点:假装成功,实际没写
      throw new QuotaExceededError(`Native 库超出 ${this.quotaMB}MB 配额`);
    }
    this.nativeDb.set(key, value);
  }
  async get(key: string) {
    return this.nativeDb.get(key) ?? null;
  }
  async remove(key: string) {
    this.nativeDb.delete(key);
  }
}

// ---------- 契约用例:只写一次,所有 adapter 共用 ----------

interface ContractCase {
  name: string;
  run(s: StorageCapability): Promise<void>;
}

const storageContract: ContractCase[] = [
  {
    name: "set/get 回环一致",
    async run(s) {
      await s.set("k1", "v1");
      assert((await s.get("k1")) === "v1", "写入后读回不一致");
    },
  },
  {
    name: "覆盖写返回新值",
    async run(s) {
      await s.set("k2", "old");
      await s.set("k2", "new");
      assert((await s.get("k2")) === "new", "覆盖写后读到旧值");
    },
  },
  {
    name: "remove 后 get 返回 null",
    async run(s) {
      await s.set("k3", "x");
      await s.remove("k3");
      assert((await s.get("k3")) === null, "remove 后仍能读到值");
    },
  },
  {
    name: "读不存在的 key 返回 null 而非抛错",
    async run(s) {
      assert((await s.get("never-existed")) === null, "缺失 key 应返回 null");
    },
  },
  {
    name: "特殊字符 key(中文/emoji/空格)可用",
    async run(s) {
      await s.set("草稿:邮件 📧", "内容");
      assert((await s.get("草稿:邮件 📧")) === "内容", "特殊字符 key 读写失败");
    },
  },
  {
    name: "容量超限必须抛 QuotaExceededError(不许静默丢数据)",
    async run(s) {
      const big = "x".repeat((s.quotaMB + 1) * 1024 * 1024); // 故意超配 1MB
      let caught: Error | null = null;
      try {
        await s.set("huge", big);
      } catch (e) {
        caught = e as Error;
      }
      assert(caught !== null, "超容量写入没有抛错(可能静默丢数据)");
      assert(caught.name === "QuotaExceededError", `错误名应为 QuotaExceededError,实际 ${caught.name}`);
      assert((await s.get("huge")) === null, "超限写入不应留下脏数据");
    },
  },
];

// ---------- 契约执行器:跑矩阵,出一致性报告 ----------

async function runContract(name: string, adapter: StorageCapability): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  for (const c of storageContract) {
    try {
      await c.run(adapter);
      results.set(c.name, "✅");
    } catch (e) {
      results.set(c.name, `❌ ${(e as Error).message}`);
    }
  }
  return results;
}

async function main() {
  console.log("== 第一轮:三端 adapter 跑同一套 storage 契约 ==\n");

  const adapters: Array<[string, StorageCapability]> = [
    ["Web(localStorage)", new WebStorageAdapter()],
    ["PC 客户端(原生文件)", new DesktopStorageAdapter()],
    ["H5 桥接(线上版本)", new H5BridgeStorageAdapter(true)],
  ];

  const matrix = new Map<string, Map<string, string>>();
  for (const [name, a] of adapters) matrix.set(name, await runContract(name, a));

  // 打印 用例 × 端 的矩阵报告
  for (const c of storageContract) {
    const cells = adapters.map(([name]) => {
      const r = matrix.get(name)!.get(c.name)!;
      return `${name}: ${r.startsWith("✅") ? "✅" : "❌"}`;
    });
    console.log(`${r_pad(c.name, 30)} ${cells.join("  ")}`);
  }
  for (const [name] of adapters) {
    for (const [caseName, r] of matrix.get(name)!) {
      if (r.startsWith("❌")) console.log(`\n⚠️ 违约详情 [${name}] ${caseName} → ${r.slice(2)}`);
    }
  }

  const broken = [...matrix.entries()].filter(([, rs]) => [...rs.values()].some((r) => r.startsWith("❌")));
  assert(broken.length === 1 && broken[0][0].includes("H5"), "第一轮应只有 H5 桥接违约");

  console.log("\n== 第二轮:修复桥层(超容量改为抛错)后重跑 ==");
  const fixed = await runContract("H5 桥接(修复后)", new H5BridgeStorageAdapter(false));
  const allPass = [...fixed.values()].every((r) => r === "✅");
  console.log(`H5 桥接(修复后): ${allPass ? "6/6 全部通过" : "仍有违约"}`);
  assert(allPass, "修复后 H5 应全部通过");

  console.log("\n✅ 契约测试演示完成:同一套用例揪出端差异,修复后三端行为对齐");
  console.log("(真实 CI 中,存在违约时本进程应 exit 1 阻断发布;示例为演示保持 exit 0)");
}

/** 按显示宽度右补空格(中文按 2 计),让矩阵报告对齐 */
function r_pad(s: string, width: number): string {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1;
  return s + " ".repeat(Math.max(0, width - w));
}

main();
