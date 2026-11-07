// 文件: examples/17-18-opfs-worker.js
// Worker 内用 createSyncAccessHandle 做同步读写：省去每次 await，
// 适合「大文件顺序写 / 日志批刷」；主线程不能用这个 API。
self.onmessage = async (event) => {
    const count = event.data?.count ?? 1024;
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("fag-opfs", { create: true });
    const handle = await dir.getFileHandle("bench-worker.log", { create: true });
    const access = await handle.createSyncAccessHandle();
    const encoder = new TextEncoder();
    try {
        access.truncate(0);
        let offset = 0;
        for (let i = 0; i < count; i++) {
            const bytes = encoder.encode(`line ${i}\n`);
            access.write(bytes, { at: offset });
            offset += bytes.byteLength;
        }
        access.flush();
    } finally {
        access.close();
    }
    self.postMessage({ bytes: offset });
};
