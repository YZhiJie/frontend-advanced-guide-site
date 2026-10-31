// 文件: examples/54-04-uuid-generator.ts
// ============ UUID v4 与 v7:随机标识 vs 时间有序标识 ============
// 设计要点:
// 1) v4 是纯随机,128 位中 122 位随机,碰撞概率可忽略,但完全无序;
// 2) v7 = 48 位毫秒时间戳 + 随机,既全局唯一又可按时间排序,适合做数据库主键/游标;
// 3) 生成必须使用密码学安全随机源(crypto.getRandomValues),不要用 Math.random。

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function format(hex: string): string {
  if (hex.length !== 32) throw new Error("UUID 必须是 128 位(32 个 hex)");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** RFC 9562 v4:随机位,第 13 个 hex 固定为 4,第 17 个 hex 的高两位固定为 10 */
function uuidv4(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return format(toHex(bytes));
}

/** RFC 9562 v7:高 48 位为 Unix 毫秒时间戳,其余为随机 */
function uuidv7(timestampMs: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ts = Math.floor(timestampMs);
  // 48 位时间戳写入前 6 字节(大端)
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  return format(toHex(bytes));
}

function extractVersion(uuid: string): number {
  return Number.parseInt(uuid[14], 16);
}

function extractVariant(uuid: string): string {
  const nibble = Number.parseInt(uuid[19], 16);
  return (nibble & 0b1000) === 0b1000 ? "RFC 4122/9562" : "reserved";
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------- 场景 1:v4 格式、版本、变体 ----------------
const v4s = Array.from({ length: 1000 }, uuidv4);
const sample = v4s[0];
console.log("v4 示例:", sample);
assert(UUID_RE.test(sample), "v4 格式必须合法");
assert(extractVersion(sample) === 4, "版本位必须是 4");
assert(extractVariant(sample) === "RFC 4122/9562", "变体位必须是 10xx");
assert(new Set(v4s).size === v4s.length, "1000 个 v4 不应重复");

// ---------------- 场景 2:v7 时间有序 ----------------
const t1 = 1_700_000_000_000;
const a = uuidv7(t1);
const b = uuidv7(t1 + 1);
console.log("v7(t):  ", a);
console.log("v7(t+1):", b);
assert(UUID_RE.test(a), "v7 格式必须合法");
assert(extractVersion(a) === 7, "版本位必须是 7");
assert(a.slice(0, 8) <= b.slice(0, 8), "同一毫秒前缀应单调不降");
assert(a < b, "时间戳更大的 v7 应可排序");

// ---------------- 场景 3:时间戳可还原 ----------------
function timestampOf(uuid: string): number {
  const hex = uuid.replace(/-/g, "").slice(0, 12);
  return Number.parseInt(hex, 16);
}
const t = 1_712_345_678_901;
const restored = timestampOf(uuidv7(t));
console.log("还原时间戳:", restored, "原值:", t);
assert(restored === t, "前 48 位应可还原毫秒时间戳");

// ---------------- 场景 4:与内置 randomUUID 对照 ----------------
const native = globalThis.crypto.randomUUID?.();
if (native) {
  console.log("内置 randomUUID:", native);
  assert(extractVersion(native) === 4, "内置 randomUUID 也是 v4");
}

console.log("\nUUID 通过:v4 随机、v7 有序、时间戳可还原、与内置实现一致。");

// 标记为模块,避免与其它示例的顶层变量重名
export {};
