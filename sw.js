/**
 * 离线缓存 Service Worker —— 手写实现，不引入 workbox（不为「离线看文档」背一整个依赖树）。
 *
 * 设计取舍：
 *  - 不做构建期预缓存清单：全站产物 27 MB（94 个页面 + shiki 高亮分片 + 2.6 MB 搜索索引），
 *    预缓存意味着首次安装就下载数 MB，对文档站得不偿失。改为「访问过的才进缓存」，
 *    离线时可继续阅读已看过的页面。
 *  - 导航请求 network-first：在线永远拿最新内容，仅离线才回退缓存；若用 cache-first，
 *    已读页面会被旧版长期钉在浏览器里。
 *  - assets/ 下的构建产物文件名带内容哈希，cache-first 最省流量且天然不会读到旧内容
 *    （页面 HTML 变了 → 引用的哈希名也变 → 缓存未命中 → 重新拉取）。
 *  - 纯文本导出（llms-full.txt 2 MB）、.xml/.map 一律放行不缓存。
 *  - 构建期产物 JSON（playground / pitfalls / knowledge-map / *-map.json）：network-first。
 *    它们文件名不带哈希，而正文功能依赖「文件与页面同一版本」——stale-while-revalidate 会
 *    让读者跑上一版示例、点进失效锚点，代价远高于省下的那几百 KB 流量；离线时回退缓存副本。
 *
 * base 从注册作用域推导（scope 形如 https://host/repo/），因此本文件对本地（/）与
 * GitHub Pages 子路径（/repo/）都成立，无需为 DEPLOY_BASE 生成两份。
 * 注册见 .vitepress/theme/index.ts（仅生产环境、HTTPS 或 localhost 下注册）。
 */
const BASE = new URL(self.registration.scope).pathname; // 以 '/' 结尾
const CACHE = "fag-offline-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// 不值得占用缓存配额的内容：跨域请求、纯文本导出、站点地图/RSS、sourcemap
function isSkippable(url) {
  if (url.origin !== self.location.origin) return true;
  return /\.(txt|xml|map)$/.test(url.pathname);
}

// 导航（页面 HTML）：先网络后缓存，离线回退到缓存的同 URL 页面或首页
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch {
    // 首页在 cleanUrls 下被缓存为 "<base>"（无 index.html 后缀），两种形态都试一次
    return (
      (await cache.match(req)) ??
      (await cache.match(BASE)) ??
      (await cache.match(`${BASE}index.html`)) ??
      new Response("当前离线，且该页面尚未被缓存。", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

// 带哈希的构建产物：命中即返回，未命中才联网
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

// 其余同源静态资源（logo.svg、manifest、examples 源码等）：先给缓存，后台更新
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const pending = fetch(req).then(async (res) => {
    if (res.ok) await cache.put(req, res.clone());
    return res;
  });
  if (hit) {
    pending.catch(() => {}); // 命中缓存时后台更新失败静默（离线属正常）
    return hit;
  }
  try {
    return await pending;
  } catch {
    return new Response("", { status: 504 });
  }
}

// 构建期产物 JSON（playground / pitfalls / knowledge-map 等）：**必须**先网络后缓存。
// 这些文件名不带内容哈希，而页面功能与正文完全依赖它们与当前版本一致——用 stale-while-
// revalidate 会让读者点「▶ 运行」跑的是上一版示例代码、坑点索引指向已失效的旧锚点。
// 离线时回退缓存副本，保留「离线也能翻已读页面 / 用坑点索引」的能力。
async function networkFirstData(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch {
    return (
      (await cache.match(req)) ??
      new Response('{"error":"offline"}', {
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      })
    );
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // 不介入任何写操作
  const url = new URL(req.url);
  if (isSkippable(url)) return;
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(networkFirst(req));
  } else if (req.destination === "iframe") {
    // 案例在线预览页（E13 的 /case-previews/<slug>.html，文件名无内容哈希）：
    // 与页面同版本才有效，与 navigate 同样走 network-first，避免弹层里放上一版案例
    event.respondWith(networkFirst(req));
  } else if (url.pathname.startsWith(`${BASE}assets/`)) {
    event.respondWith(cacheFirst(req));
  } else if (/\.json$/.test(url.pathname)) {
    event.respondWith(networkFirstData(req));
  } else {
    event.respondWith(staleWhileRevalidate(req));
  }
});
