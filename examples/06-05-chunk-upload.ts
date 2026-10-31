// 文件: examples/06-05-chunk-upload.ts
// ============ 大文件分片上传:秒传 + 断点续传 + 并发控制 ============

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB 一片

/** 计算文件哈希作为唯一标识(大文件建议放 Web Worker + 增量抽样计算,避免卡 UI) */
async function hashFile(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
    return res.json() as Promise<T>;
}

/** 并发池(同 1.8 的 asyncPool) */
async function asyncPool<T>(limit: number, items: readonly T[], task: (item: T) => Promise<void>) {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) await task(items[cursor++]);
    });
    await Promise.all(workers);
}

export async function uploadLargeFile(file: File, onProgress?: (percent: number) => void) {
    // ① 计算唯一标识
    const hash = await hashFile(file);

    // ② 问服务器:这文件传过吗?(秒传)传过哪些片?(断点续传)
    const { uploaded, exists } = await fetchJSON<{ uploaded: number[]; exists: boolean }>('/api/upload/status', {
        method: 'POST',
        body: JSON.stringify({ hash, name: file.name, size: file.size }),
    });
    if (exists) return console.log('⚡ 秒传:服务器已有相同文件');

    const total = Math.ceil(file.size / CHUNK_SIZE);
    const pending = Array.from({ length: total }, (_, i) => i).filter((i) => !uploaded.includes(i));
    let doneCount = uploaded.length;

    // ③ 并发上传缺失分片(并发 3,失败单片自动重试)
    await asyncPool(3, pending, async (index) => {
        const blob = file.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE); // File.slice:零拷贝切片
        const form = new FormData();
        form.append('chunk', blob);
        form.append('hash', hash);
        form.append('index', String(index));

        // 单片重试 3 次
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await fetch('/api/upload/chunk', { method: 'POST', body: form });
                doneCount++;
                onProgress?.(Math.round((doneCount / total) * 100));
                return;
            } catch (e) {
                if (attempt === 2) throw e;
                await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
            }
        }
    });

    // ④ 通知服务端合并分片
    await fetchJSON('/api/upload/merge', { method: 'POST', body: JSON.stringify({ hash, total, name: file.name }) });
    console.log('✅ 上传完成');
}

// 触发:<input type="file" onChange={(e) => uploadLargeFile(e.target.files![0], console.log)} />
