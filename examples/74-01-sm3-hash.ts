// 文件: examples/74-01-sm3-hash.ts
// ============ SM3 密码杂凑算法(GB/T 32905-2016)纯 TypeScript 实现 ============
// 设计要点:
// 1. 零依赖、纯位运算,可直接拷进政企内网项目(无 npm 源也能用)
// 2. 用国标附录的两组测试向量 + 社区交叉验证的空串向量做硬断言自校验
// 3. 演示前端真实场景:公文报文完整性校验(改动一个字 → 摘要天差地别)
//
// 算法结构速记(与 SHA-256 同族但细节不同):
// - 512 位分组,填充后追加 64 位大端比特长度
// - 8 个 32 位寄存器 A~H,64 轮迭代压缩
// - 前 16 轮与后 48 轮用不同的布尔函数 FF/GG 与常量 T

/** 断言工具:校验不通过直接抛错,让示例在门禁里「红得响亮」 */
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

/** 32 位循环左移(JS 移位天然按 32 取模,显式写清便于对照国标公式) */
function rotl(x: number, n: number): number {
  n &= 31;
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/** 置换函数 P0(压缩函数内用) */
const P0 = (x: number) => (x ^ rotl(x, 9) ^ rotl(x, 17)) >>> 0;
/** 置换函数 P1(消息扩展用) */
const P1 = (x: number) => (x ^ rotl(x, 15) ^ rotl(x, 23)) >>> 0;
/** 布尔函数 FF:前 16 轮异或,后 48 轮择多 */
const FF = (j: number, x: number, y: number, z: number) =>
  j <= 15 ? x ^ y ^ z : (x & y) | (x & z) | (y & z);
/** 布尔函数 GG:前 16 轮异或,后 48 轮按 x 选择 */
const GG = (j: number, x: number, y: number, z: number) =>
  j <= 15 ? x ^ y ^ z : (x & y) | (~x & z);
/** 常量 T_j */
const T = (j: number) => (j <= 15 ? 0x79cc4519 : 0x7a879d8a);

/** 初始向量 IV(国标 5.3 节) */
const IV = [
  0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600,
  0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
];

/** 对 512 位分组执行一次压缩,V 为 8 字寄存器状态 */
function compress(V: number[], block: Uint8Array, offset: number): number[] {
  // 消息扩展:W[0..67] + W'[0..63]
  const W = new Array<number>(68);
  for (let j = 0; j < 16; j++) {
    const i = offset + j * 4;
    W[j] =
      ((block[i] << 24) | (block[i + 1] << 16) | (block[i + 2] << 8) | block[i + 3]) >>> 0;
  }
  for (let j = 16; j < 68; j++) {
    W[j] = (P1(W[j - 16] ^ W[j - 9] ^ rotl(W[j - 3], 15)) ^ rotl(W[j - 13], 7) ^ W[j - 6]) >>> 0;
  }
  const W1 = new Array<number>(64);
  for (let j = 0; j < 64; j++) W1[j] = (W[j] ^ W[j + 4]) >>> 0;

  let [A, B, C, D, E, F, G, H] = V;
  for (let j = 0; j < 64; j++) {
    const SS1 = rotl((rotl(A, 12) + E + rotl(T(j), j)) >>> 0, 7);
    const SS2 = SS1 ^ rotl(A, 12);
    const TT1 = (FF(j, A, B, C) + D + SS2 + W1[j]) >>> 0;
    const TT2 = (GG(j, E, F, G) + H + SS1 + W[j]) >>> 0;
    D = C; C = rotl(B, 9); B = A; A = TT1;
    H = G; G = rotl(F, 19); F = E; E = P0(TT2);
  }
  return [A ^ V[0], B ^ V[1], C ^ V[2], D ^ V[3], E ^ V[4], F ^ V[5], G ^ V[6], H ^ V[7]].map(
    (x) => x >>> 0,
  );
}

/** SM3 主入口:输入字节序列,输出 32 字节摘要 */
export function sm3(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  // 填充:追加 0x80,再补 0 直到长度 ≡ 56 (mod 64),最后 8 字节大端比特长度
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  // 演示消息均 < 2^32 比特,高 32 位恒为 0
  dv.setUint32(padded.length - 8, 0);
  dv.setUint32(padded.length - 4, bitLen);

  let V = [...IV];
  for (let off = 0; off < padded.length; off += 64) {
    V = compress(V, padded, off);
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  V.forEach((w, i) => odv.setUint32(i * 4, w));
  return out;
}

/** 便捷封装:字符串按 UTF-8 编码后求摘要,输出小写 hex */
export function sm3Hex(text: string): string {
  const digest = sm3(new TextEncoder().encode(text));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** ============ 国标测试向量自校验 ============ */
export function runSm3Tests() {
  // GB/T 32905-2016 附录示例 1:消息 "abc"
  const v1 = sm3Hex("abc");
  console.log(`SM3("abc")     = ${v1}`);
  assert(
    v1 === "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0",
    "国标向量 1(abc)不匹配",
  );

  // GB/T 32905-2016 附录示例 2:64 字节的 "abcd" 重复 16 次
  const v2 = sm3Hex("abcd".repeat(16));
  console.log(`SM3("abcd"x16) = ${v2}`);
  assert(
    v2 === "debe9ff92275b8a138604889c18e5a4d6fdb70e5387e5765293dcba39c0c5732",
    "国标向量 2(abcd x16)不匹配",
  );

  // 空串向量(sm-crypto 等主流实现交叉验证)
  const v0 = sm3Hex("");
  assert(
    v0 === "1ab21d8355cfa17f8e61194831e81a8f22bec8c728fefb747ed035eb5082aa2b",
    "空串向量不匹配",
  );

  // ---- 场景演示:公文报文完整性校验 ----
  const 公文 = '{"文号":"政发〔2026〕12号","金额":"1000000","收款方":"某供应商"}';
  const 摘要A = sm3Hex(公文);
  const 篡改后 = 公文.replace("1000000", "9000000");
  const 摘要B = sm3Hex(篡改后);
  console.log(`原始报文摘要: ${摘要A.slice(0, 16)}...`);
  console.log(`篡改报文摘要: ${摘要B.slice(0, 16)}...`);
  assert(摘要A !== 摘要B, "篡改后摘要必须不同");

  // 摘要可做离线包 manifest 的完整性指纹(与 74-03 示例呼应)
  console.log("✅ SM3 国标向量与完整性校验演示全部通过");
}

runSm3Tests();
