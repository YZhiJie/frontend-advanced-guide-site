// 文件: examples/130-01-query-key.ts
// 130.2 缓存键工程：稳定序列化、key factory、前缀失效、结构共享判断
// Query key 是「依赖数组」：键不稳定，缓存就永远不命中；键粒度过粗，失效就误伤。
import assert from "node:assert/strict";

export type KeyPart = string | number | boolean | null | undefined | Record<string, unknown> | KeyPart[];

/** 稳定序列化：对象键排序、undefined 省略、数组保序 */
export function stableSerialize(value: KeyPart): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableSerialize(value[k] as KeyPart)}`).join(",")}}`;
}

/** 键工厂：把「资源 + 参数」收敛成唯一入口，避免各处手写字符串 */
export const queryKeys = {
  all: ["todos"] as const,
  lists: () => [...queryKeys.all, "list"] as const,
  list: (filters: { status?: string; page: number }) => [...queryKeys.lists(), filters] as const,
  detail: (id: string) => [...queryKeys.all, "detail", id] as const,
};

/** 前缀匹配：invalidateQueries({ queryKey: ['todos'] }) 会命中所有 todos 派生键 */
export function matchesPrefix(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  if (prefix.length > key.length) return false;
  return prefix.every((part, i) => stableSerialize(part as KeyPart) === stableSerialize(key[i] as KeyPart));
}

/** 两个键是否等价（与对象属性书写顺序无关） */
export function keysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return stableSerialize(a as KeyPart[]) === stableSerialize(b as KeyPart[]);
}

// ---------------- 断言 ----------------
assert.equal(
  stableSerialize({ page: 1, status: "open" }),
  stableSerialize({ status: "open", page: 1 }),
  "对象键顺序不应影响键",
);
assert.notEqual(stableSerialize({ page: 1 }), stableSerialize({ page: "1" }), "类型不同即不同键");

assert.ok(keysEqual(["todos", "list", { page: 1 }], ["todos", "list", { page: 1 }]));
assert.ok(!keysEqual(["todos", "list", { page: 1 }], ["todos", "list", { page: 2 }]));

const all = queryKeys.all;
const list1 = queryKeys.list({ status: "open", page: 1 });
assert.deepEqual(list1, ["todos", "list", { status: "open", page: 1 }]);
assert.ok(matchesPrefix(list1, all), "失效 todos 应覆盖列表");
assert.ok(matchesPrefix(queryKeys.detail("42"), all));
assert.ok(!matchesPrefix(["users", "list"], all), "不同资源不应误伤");
assert.ok(matchesPrefix(list1, queryKeys.lists()), "失效 lists 应覆盖所有列表");
assert.ok(!matchesPrefix(queryKeys.detail("42"), queryKeys.lists()));

// 数组顺序敏感：分页游标顺序不同就是不同查询
assert.ok(!keysEqual(["feed", [1, 2]], ["feed", [2, 1]]));

console.log("✓ 130-01 稳定序列化、key factory 与前缀失效断言全部通过");
