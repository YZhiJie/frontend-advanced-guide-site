// 文件: examples/54-03-query-string.ts
// ============ 查询串解析与序列化:qs 的括号语法、数组与原型污染防护 ============
// 设计要点:
// 1) 查询串不是「split('&') 就完事」:重复 key、数组、嵌套对象、编码都要处理;
// 2) `__proto__` / `constructor` 必须拦截,否则会污染 Object 原型;
// 3) 解析与序列化要能往返:parse(stringify(obj)) 应还原同一结构。

type Primitive = string | number | boolean;
type QueryValue = Primitive | QueryValue[] | { [key: string]: QueryValue };
type QueryObject = Record<string, QueryValue>;

/** 仅支持一层括号:qs 支持多层,但业务接口 90% 只用 [] 与 [key] */
function parseKey(raw: string): {
  base: string;
  child?: string;
  isArray: boolean;
} {
  const m = raw.match(/^([^\[\]]+)(?:\[([^\[\]]*)\])?$/);
  if (!m) return { base: raw, isArray: false };
  return { base: m[1], child: m[2], isArray: m[2] === "" };
}

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value; // 非法编码不抛,交给业务校验
  }
}

function parseQuery(input: string): QueryObject {
  const result: QueryObject = {};
  const query = input.startsWith("?") ? input.slice(1) : input;
  if (!query) return result;

  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawKey = safeDecode(eq === -1 ? pair : pair.slice(0, eq));
    const value = safeDecode(eq === -1 ? "" : pair.slice(eq + 1));
    const { base, child, isArray } = parseKey(rawKey);
    if (FORBIDDEN.has(base)) continue;

    if (child === undefined) {
      const prev = result[base];
      if (prev === undefined) result[base] = value;
      else if (Array.isArray(prev)) prev.push(value);
      else result[base] = [prev, value];
      continue;
    }

    if (isArray) {
      const arr = (result[base] as QueryValue[] | undefined) ?? [];
      arr.push(value);
      result[base] = arr;
      continue;
    }

    const obj =
      (result[base] as { [key: string]: QueryValue } | undefined) ?? {};
    obj[child] = value;
    result[base] = obj;
  }
  return result;
}

interface StringifyOptions {
  /** repeat: a=1&a=2;bracket: a[]=1&a[]=2 */
  arrayFormat?: "repeat" | "bracket";
  encode?: (v: string) => string;
}

function stringifyQuery(obj: QueryObject, opts: StringifyOptions = {}): string {
  const { arrayFormat = "repeat", encode = encodeURIComponent } = opts;
  const parts: string[] = [];

  const push = (key: string, value: QueryValue) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v) =>
        push(arrayFormat === "bracket" ? `${key}[]` : key, v as QueryValue),
      );
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) push(`${key}[${k}]`, v);
      return;
    }
    parts.push(`${encode(key)}=${encode(String(value))}`);
  };

  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN.has(key)) continue;
    push(key, value);
  }
  return parts.join("&");
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 场景 1:重复 key → 数组 ----------------
const r1 = parseQuery("?tag=a&tag=b&tag=c");
console.log("重复 key:", r1);
assert(
  Array.isArray(r1.tag) && (r1.tag as string[]).length === 3,
  "重复 key 应聚合为数组",
);

// ---------------- 场景 2:数组与嵌套对象 ----------------
const r2 = parseQuery("ids[]=1&ids[]=2&user[name]=张三&user[age]=18");
console.log("数组与对象:", r2);
assert((r2.ids as string[]).length === 2, "ids[] 应解析为数组");
assert(
  (r2.user as Record<string, string>).name === "张三",
  "嵌套对象中文应正确解码",
);

// ---------------- 场景 3:编码与空格 ----------------
const r3 = parseQuery("q=hello+world&path=%2Fdocs%2Fintro");
console.log("编码:", r3);
assert(r3.q === "hello world", "+ 应解码为空格");
assert(r3.path === "/docs/intro", "%2F 应解码为斜杠");

// ---------------- 场景 4:原型污染防护 ----------------
const polluted = parseQuery("__proto__[polluted]=1&constructor=2&safe=ok");
console.log("污染尝试:", polluted);
assert(
  ({} as Record<string, unknown>).polluted === undefined,
  "原型不应被污染",
);
assert(polluted.safe === "ok", "正常字段应保留");
assert(
  !Object.prototype.hasOwnProperty.call(polluted, "__proto__"),
  "危险 key 应被丢弃",
);

// ---------------- 场景 5:序列化与往返 ----------------
const obj: QueryObject = {
  q: "hello world",
  ids: ["1", "2"],
  user: { name: "张三", age: "18" },
  active: "true",
};
const repeated = stringifyQuery(obj);
const bracketed = stringifyQuery(obj, { arrayFormat: "bracket" });
console.log("repeat:", repeated);
console.log("bracket:", bracketed);
assert(repeated.includes("ids=1&ids=2"), "repeat 模式数组应重复 key");
assert(
  decodeURIComponent(bracketed).includes("ids[]=1&ids[]=2"),
  "bracket 模式数组应带 []",
);

const roundTrip = parseQuery(repeated);
assert(roundTrip.q === "hello world", "往返后 q 应一致");
assert(
  (roundTrip.user as Record<string, string>).age === "18",
  "往返后嵌套对象应一致",
);
assert((roundTrip.ids as string[]).join(",") === "1,2", "往返后数组应一致");

// ---------------- 场景 6:非法编码不崩 ----------------
const bad = parseQuery("bad=%E0%A4%A&ok=1");
console.log("非法编码:", bad);
assert(bad.ok === "1", "单个非法编码不应影响其他字段");

console.log(
  "\n查询串通过:重复 key、数组、嵌套、编码、污染防护、往返均有确定行为。",
);

// 标记为模块,避免与其它示例的顶层变量重名
export {};
