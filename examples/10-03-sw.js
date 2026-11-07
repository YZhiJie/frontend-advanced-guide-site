// 文件: examples/10-03-sw.js —— [浏览器] 按路由分流缓存策略的 Service Worker
const VERSION = 'v1'; // 发版时递增:旧缓存靠 activate 阶段清理
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;
const PRECACHE = ['/', '/offline.html', '/fonts/main.woff2'];

// ---- 安装:预缓存应用壳 ----
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)),
        // 不调用 skipWaiting:等用户所有标签页关闭后自然接管,避免新旧版本混跑
    );
});

// ---- 激活:清掉旧版本缓存 ----
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))),
        ),
    );
});

// ---- 拦截请求:按资源类型选择策略 ----
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET' || url.origin !== location.origin) return; // 只管同源 GET

    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirst(request));   // API:新鲜优先
    } else if (/\.(js|css|png|jpe?g|webp|avif|woff2)$/.test(url.pathname)) {
        event.respondWith(cacheFirst(request));     // 带指纹静态资源:缓存优先
    } else {
        event.respondWith(staleWhileRevalidate(request)); // 页面/文档:先用再更
    }
});

// 策略一:缓存优先 —— 命中即返回,永不等待网络(适合内容哈希命名的静态资源)
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const res = await fetch(request);
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, res.clone()); // clone:响应流只能被读一次,缓存与返回各要一份
    return res;
}

// 策略二:网络优先 —— 拿到最新,失败回退缓存,再失败回退离线页
async function networkFirst(request) {
    try {
        const res = await fetch(request);
        const cache = await caches.open(PAGE_CACHE);
        cache.put(request, res.clone());
        return res;
    } catch {
        return (await caches.match(request)) ?? caches.match('/offline.html');
    }
}

// 策略三:先用缓存保速度,后台静默更新(适合页面壳、文档)
async function staleWhileRevalidate(request) {
    const cached = await caches.match(request);
    const fetchPromise = fetch(request).then((res) => {
        caches.open(PAGE_CACHE).then((cache) => cache.put(request, res.clone()));
        return res;
    });
    return cached ?? fetchPromise;
}
