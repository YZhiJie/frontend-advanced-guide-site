// 文件: examples/40-04-ranged-download.ts
// ============ 分块下载：Range 请求与合并 ============
// 大文件下载同理：单连接慢且断线全废。方案：
// 1) HEAD 请求拿 Content-Length + 是否支持 Accept-Ranges: bytes；
// 2) 按 Range: bytes=start-end 发 N 个并发请求（浏览器对同域并发有限制，实际 4~6 路）；
// 3) 每块落盘（Blob/临时文件），全部完成后按序合并；
// 4) 任一块失败可单独重试该块（断点续下）。
// 本示例模拟分块下载调度与失败重试，块数据用字符串占位。

export interface DownloadRange {
    index: number;
    start: number;
    end: number;         // 含 end
    status: "pending" | "downloading" | "done" | "failed";
    attempts: number;
}

export interface HeadInfo {
    contentLength: number;
    acceptRanges: boolean;
    etag: string;
}

/** HEAD 响应解析（模拟） */
export function parseHead(headers: Record<string, string>): HeadInfo {
    return {
        contentLength: Number(headers["content-length"]),
        acceptRanges: headers["accept-ranges"] === "bytes",
        etag: headers.etag ?? "",
    };
}

/** 切分下载范围 */
export function planRanges(total: number, partSize: number): DownloadRange[] {
    const ranges: DownloadRange[] = [];
    for (let start = 0, i = 0; start < total; start += partSize, i++) {
        ranges.push({ index: i, start, end: Math.min(start + partSize - 1, total - 1), status: "pending", attempts: 0 });
    }
    return ranges;
}

/** ETag 变化检测：下载中途文件被替换 → 全部作废重来（Range 结果拼错位） */
export function isStale(latestEtag: string, plannedEtag: string): boolean {
    return latestEtag !== plannedEtag;
}

/** 模拟下载调度：每块可能失败（failTable），失败重试直至 maxRetries */
export function downloadAll(
    ranges: DownloadRange[],
    failTable: Map<number, number>,
    maxRetries = 3,
): { ok: boolean; bytesFetched: number; failed: number[]; log: string[] } {
    const log: string[] = [];
    let bytesFetched = 0;
    const failed: number[] = [];
    for (const r of ranges) {
        r.status = "downloading";
        const fails = failTable.get(r.index) ?? 0;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            r.attempts = attempt;
            if (attempt > fails) {
                r.status = "done";
                bytesFetched += r.end - r.start + 1;
                log.push(`块${r.index} [${r.start}-${r.end}] ✓ (尝试${attempt})`);
                break;
            }
            log.push(`块${r.index} 第${attempt}次失败 → ${attempt < maxRetries ? "重试该块" : "放弃"}`);
        }
        if (r.status !== "done") {
            r.status = "failed";
            failed.push(r.index);
        }
    }
    return { ok: failed.length === 0, bytesFetched, failed, log };
}

/** 合并校验：块覆盖连续且总字节数吻合才允许拼接 */
export function verifyAndMerge(ranges: readonly DownloadRange[], total: number): { ok: boolean; reason?: string } {
    if (!ranges.every((r) => r.status === "done")) return { ok: false, reason: "存在未完成块" };
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const r of sorted) {
        if (r.start !== cursor) return { ok: false, reason: `块${r.index} 起点不连续（期望 ${cursor}，实际 ${r.start}）` };
        cursor = r.end + 1;
    }
    if (cursor !== total) return { ok: false, reason: `总长不吻合（期望 ${total}，实际 ${cursor}）` };
    return { ok: true };
}

// ---------------- 验证 ----------------

const head = parseHead({ "content-length": "10485760", "accept-ranges": "bytes", etag: "W/abc123" });
console.log("=== HEAD 探测 ===");
console.log(`大小 ${head.contentLength} 字节 / 支持分块: ${head.acceptRanges} / ETag: ${head.etag}`);

const ranges = planRanges(head.contentLength, 4 * 1024 * 1024);
console.log("分块计划:", ranges.map((r) => `[${r.start}-${r.end}]`).join(" "));

console.log("\n=== 块2 连挂 2 次 → 第 3 次成功 ===");
const r1 = downloadAll(ranges, new Map([[2, 2]]));
console.log(r1.log.filter((l) => l.includes("块2") || l.includes("块0") || l.includes("块1")).slice(0, 5));
console.log("总拉取字节:", r1.bytesFetched, "=", head.contentLength, "?", r1.bytesFetched === head.contentLength);

console.log("\n=== 合并前完整性校验 ===");
console.log(verifyAndMerge(ranges, head.contentLength));

console.log("\n=== ETag 变化：下载中文件被替换 → 全部作废 ===");
console.log("stale:", isStale("W/xyz789", "W/abc123"), "→ 丢弃全部已下块，用新 ETag 重新下载");

console.log("\n=== 对应浏览器实现（示意） ===");
console.log(`
// fetch(url, { headers: { Range: 'bytes=0-4194303' } }) → 206 Partial Content
// 块数据 collect 成 Blob 数组 → new Blob(parts) 合并 → a[download] 触发保存`);
