// 文件: examples/56-03-sw.js
// Background Sync 唤醒后通知页面重放队列。
// 真实项目里也可以在这里直接操作 IndexedDB，但队列逻辑通常复用页面同一份模块。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("sync", (event) => {
    if (event.tag !== "fag-outbox-flush") return;
    event.waitUntil(
        self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) => {
            for (const client of clients) client.postMessage({ type: "OUTBOX_FLUSH" });
        }),
    );
});
