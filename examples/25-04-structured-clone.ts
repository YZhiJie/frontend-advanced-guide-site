// 文件: examples/25-04-structured-clone.ts —— structuredClone vs JSON 深拷贝
// ============ 结构化克隆算法是 postMessage/IndexedDB 的底层协议,Node 17+ 原生可跑============

// 不含循环引用的基础对象:先看 JSON 的类型丢失,再单独演示循环引用
const source = {
  id: 1,
  name: "购物车",
  createdAt: new Date("2026-01-01T00:00:00Z"), // 日期对象
  tags: new Set(["热销", "新品"]), // Set
  stock: new Map([
    ["SKU-1", 99],
    ["SKU-2", 3],
  ]), // Map
  extra: undefined, // undefined 字段
  score: NaN,
  nested: { deep: { list: [1, 2, 3] } },
};

// ── 方案一:JSON.parse(JSON.stringify(x)) —— 反例大户 ──
const viaJson = JSON.parse(JSON.stringify(source));
console.log("JSON 深拷贝的丢失清单:");
console.log(
  "  createdAt 变字符串:",
  viaJson.createdAt,
  "→",
  typeof viaJson.createdAt,
);
console.log("  tags 变普通对象:", JSON.stringify(viaJson.tags), "(Set 丢失)");
console.log("  stock 变普通对象:", JSON.stringify(viaJson.stock), "(Map 丢失)");
console.log("  extra 被丢弃:", "extra" in viaJson, "(undefined 字段直接消失)");
console.log("  score 变 null:", viaJson.score, "(NaN → null,类型静默污染)");

// ── 方案二:structuredClone —— 类型保真 ──
const viaClone = structuredClone(source);
console.log("\nstructuredClone 的保真清单:");
console.log("  createdAt:", viaClone.createdAt instanceof Date);
console.log(
  "  tags:",
  viaClone.tags instanceof Set,
  "stock:",
  viaClone.stock instanceof Map,
);
console.log(
  "  extra 字段保留:",
  "extra" in viaClone,
  "score 仍是 NaN:",
  Number.isNaN(viaClone.score),
);

// 修改副本不影响源(深拷贝语义)
viaClone.nested.deep.list.push(4);
console.log("  改副本不影响源:", source.nested.deep.list.length === 3);

// ── 循环引用:JSON 直接抛错,structuredClone 原生支持 ──
const circular: Record<string, unknown> = { name: "自引用节点" };
circular.self = circular;
try {
  JSON.stringify(circular);
} catch (e) {
  console.log(
    "\n循环引用 JSON.stringify:",
    (e as TypeError).message.split("\n")[0],
  );
}
const clonedCircular = structuredClone(circular);
console.log(
  "循环引用 structuredClone 还原:",
  (clonedCircular.self as Record<string, unknown>) === clonedCircular,
);

// ── 边界:什么克隆不了/克隆了也变味 ──
console.log("\n边界行为:");
try {
  structuredClone({ fn: () => {} }); // 类型层面允许,运行时抛 DataCloneError
} catch (e) {
  console.log("  函数 →", (e as DOMException).name);
}
const err = structuredClone(new TypeError("boom"));
console.log(
  "  Error 可克隆,类型保留:",
  err instanceof TypeError,
  "message:",
  err.message,
);
// 注意:Error 的自定义属性依赖宿主实现,跨上下文传错误请序列化成纯数据对象
