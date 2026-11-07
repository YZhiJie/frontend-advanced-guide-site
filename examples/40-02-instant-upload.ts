// 文件: examples/40-02-instant-upload.ts
// ============ 秒传与断点续传：hash 的角色 ============
// 秒传：上传前先算文件 hash，服务端已有相同 hash 的文件 → 直接建立引用，0 字节传输。
// 断点续传：hash 定位"文件身份"后，服务端返回已收到的分片列表，客户端只传缺的片。
// hash 的工程取舍：
// - 全量 MD5/SHA-256：稳但 1GB 文件要读全盘（几秒），放 Web Worker 里算不卡 UI（第 18 册）；
// - 抽样 hash（首中尾各取样）：快但有碰撞风险 → 秒传必须服务端二次校验。
// 本示例模拟 hash 计算（确定性伪 hash）与三态结果：秒传命中 / 续传 / 全新上传。

export function fakeHash(content: string): string {
    let h = 5381;
    for (const ch of content) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
    return `h_${h.toString(36)}`;
}

/** 抽样 hash：首 1MB + 中 1MB + 尾 1MB（教学模拟：直接拼字符串） */
export function sampleHash(fileContent: string, fileSize: number, sampleSize = 1): string {
    const head = fileContent.slice(0, sampleSize);
    const middle = fileContent.slice(Math.floor(fileSize / 2), Math.floor(fileSize / 2) + sampleSize);
    const tail = fileContent.slice(Math.max(0, fileSize - sampleSize));
    return fakeHash(`${fileSize}:${head}:${middle}:${tail}`);
}

/** 服务端分片账本：hash → 已收到的分片序号集合 */
export class UploadLedger {
    private received = new Map<string, Set<number>>();

    /** 秒传探测：完整文件是否已存在 */
    hasFile(hash: string): boolean {
        return this.received.has(hash) && this.received.get(hash)!.size === -1; // -1 表示"整文件已存"
    }

    markComplete(hash: string): void {
        this.received.set(hash, new Set([-1]));
    }

    /** 记录分片到账；返回该 hash 已收到的分片序号 */
    receiveChunk(hash: string, index: number): number[] {
        if (!this.received.has(hash) || this.received.get(hash)!.has(-1)) {
            if (!this.received.has(hash)) this.received.set(hash, new Set());
        }
        this.received.get(hash)!.add(index);
        return [...this.received.get(hash)!].filter((i) => i >= 0).sort((a, b) => a - b);
    }

    /** 续传探测：返回已收到的分片（客户端跳过这些） */
    receivedChunks(hash: string): number[] | null {
        const set = this.received.get(hash);
        if (!set || set.has(-1)) return set?.has(-1) ? [] : null; // 完整存在 → 不用传；不存在 → null
        return [...set].sort((a, b) => a - b);
    }
}

export type PreCheckResult =
    | { mode: "instant"; message: string }                      // 秒传
    | { mode: "resume"; skipChunks: number[]; message: string } // 断点续传
    | { mode: "full"; message: string };                        // 全新上传

/** 上传前探测 */
export function precheck(ledger: UploadLedger, hash: string, totalChunks: number): PreCheckResult {
    if (ledger.hasFile(hash)) return { mode: "instant", message: "服务端已有相同文件，建立引用即可" };
    const received = ledger.receivedChunks(hash);
    if (received !== null && received.length > 0) {
        return { mode: "resume", skipChunks: received, message: `已收到 ${received.length}/${totalChunks} 片，续传其余部分` };
    }
    return { mode: "full", message: "全新上传" };
}

// ---------------- 验证 ----------------

const ledger = new UploadLedger();
const fileA = "设计稿-终版-v7.psd 的内容...".repeat(50);

console.log("=== 第一次上传：全新 ===");
const hashA = sampleHash(fileA, fileA.length);
console.log("hash:", hashA, "→", precheck(ledger, hashA, 4).mode);

console.log("\n=== 分片到账 2/4 后断网 ===");
ledger.receiveChunk(hashA, 0);
ledger.receiveChunk(hashA, 2);

console.log("\n=== 恢复后重传：断点续传 ===");
const r1 = precheck(ledger, hashA, 4);
console.log(r1);
console.log("跳过片:", r1.mode === "resume" ? r1.skipChunks : "—", "只传片 1、3");

console.log("\n=== 传完后再传同一文件：秒传 ===");
for (const i of [1, 3]) ledger.receiveChunk(hashA, i);
ledger.markComplete(hashA);
const r2 = precheck(ledger, hashA, 4);
console.log(r2);

console.log("\n=== 别人上传相同文件：也命中秒传（网盘的核心省流机制） ===");
console.log("用户 B 传同一文件 → hash 相同:", sampleHash(fileA, fileA.length) === hashA, "→", precheck(ledger, hashA, 4).mode);

console.log("\n=== 安全边界提示 ===");
console.log(`
// 秒传必须服务端二次校验：抽样 hash 碰撞时若直接建引用，
// 用户 A 可能"秒传"出用户 B 的文件内容（越权读取）。
// 稳妥做法：秒传命中后，服务端对已存文件做全量 hash 比对确认。`);
