// 文件: examples/07-04-encrypted-storage.ts
// ============ 敏感数据加密落盘：AES-GCM 信封 + 口令派生密钥 + 篡改检测 ============
// 注意：前端加密只能防「拿到存储转储的人」，防不了同源 XSS——脚本能调用同样的解密函数。
// 所以 token 仍应走 HttpOnly Cookie；本地加密适合「离线数据、设备共享、合规脱敏」。
import assert from "node:assert/strict";

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("base64");
}
function fromB64(text: string): Uint8Array {
    return new Uint8Array(Buffer.from(text, "base64"));
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
    );
}

interface Envelope {
    v: 1;
    salt: string;
    iv: string;
    ciphertext: string;
}

async function encryptJson(value: unknown, passphrase: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const plaintext = enc.encode(JSON.stringify(value));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    const envelope: Envelope = { v: 1, salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(new Uint8Array(ciphertext)) };
    return JSON.stringify(envelope);
}

async function decryptJson<T>(payload: string, passphrase: string): Promise<T> {
    const env = JSON.parse(payload) as Envelope;
    if (env.v !== 1) throw new Error(`unsupported envelope version: ${env.v}`);
    const key = await deriveKey(passphrase, fromB64(env.salt));
    const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromB64(env.iv) },
        key,
        fromB64(env.ciphertext),
    );
    return JSON.parse(dec.decode(plaintext)) as T;
}

const draft = { id: "d-1", address: "上海市浦东新区", phone: "13800000000" };
const payload = await encryptJson(draft, "user-passphrase-2026");

// 1) 往返正确
assert.deepEqual(await decryptJson(payload, "user-passphrase-2026"), draft);
// 2) 密文里不应出现明文
assert.equal(payload.includes("13800000000"), false);
assert.equal(payload.includes("浦东"), false);
// 3) 每次加密 IV 不同，同一明文密文不同
assert.notEqual(await encryptJson(draft, "user-passphrase-2026"), payload);
// 4) 错误口令解不开
await assert.rejects(() => decryptJson(payload, "wrong-passphrase"), /operation failed|decrypt/i);
// 5) 篡改密文触发 GCM 完整性校验失败
const tampered = JSON.parse(payload) as Envelope;
const bytes = fromB64(tampered.ciphertext);
bytes[0] ^= 0xff;
tampered.ciphertext = toB64(bytes);
await assert.rejects(() => decryptJson(JSON.stringify(tampered), "user-passphrase-2026"), /operation failed|decrypt/i);

console.log("✓ AES-GCM：往返 / 无明文 / IV 随机 / 错口令拒绝 / 篡改检测 五类断言通过");
