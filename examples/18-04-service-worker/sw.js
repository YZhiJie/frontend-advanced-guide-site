// 文件: examples/18-04-service-worker/sw.js
// 最小可用 SW：预缓存 App Shell + 两种缓存策略 + 离线兜底。
// 调试：DevTools → Application → Service Workers，勾 Update on reload / Offline。

const VERSION = 'demo-sw-v1'; // 改这个常量（或本文件任意字节）即触发更新流程
const SHELL = [
    './',
    './index.html',
    './app.js',
    './offline.html',
    './data.json',
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)));
    // 教学演示用 skipWaiting 快速进入 activating；生产环境常停在 waiting 等用户确认
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
        await self.clients.claim(); // 立即接管已打开的页面
    })());
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    // 策略 A：导航请求 → Network First，离线回退缓存，再不行给 offline.html
    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const fresh = await fetch(request);
                const cache = await caches.open(VERSION);
                cache.put('./index.html', fresh.clone());
                return fresh;
            } catch {
                const cached = await caches.match('./index.html');
                return cached || caches.match('./offline.html');
            }
        })());
        return;
    }

    // data.json 演示接口：Network Only，离线直接失败（不缓存实时数据）
    if (new URL(request.url).pathname.endsWith('/data.json')) {
        event.respondWith(fetch(request));
        return;
    }

    // 策略 B：其他静态资源（脚本/样式）→ Cache First，未命中再走网络并回填
    event.respondWith(
        caches.match(request).then((hit) => {
            return (
                hit ||
                fetch(request).then((res) => {
                    const copy = res.clone(); // Response 流只能消费一次
                    caches.open(VERSION).then((cache) => cache.put(request, copy));
                    return res;
                })
            );
        })
    );
});

// 页面发来 SKIP_WAITING 时激活（本示例 install 已 skipWaiting，此处保留标准流程写法）
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
