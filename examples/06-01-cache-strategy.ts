// 文件: examples/06-01-cache-strategy.ts —— 前端侧缓存策略速查
// ============ "HTML 不缓存,带指纹资源强缓存"黄金法则 ============

// 1. index.html:Cache-Control: no-cache(每次协商,保证拿到最新引用)
//    → 但协商也有 RTT,追求极致可用 CDN 短缓存(s-maxage=60)

// 2. /assets/app.8f3d2c.js:Cache-Control: max-age=31536000, immutable
//    → 文件名带内容哈希,内容变 = 文件名变,强缓存一年绝对安全

// 3. API 接口分类型:
//    - 实时数据(余额、库存):no-store
//    - 低频变化(城市列表):no-cache 或短 max-age + SWR

// 4. 前端内存缓存:同一份数据多个组件共用时,在请求层做 Map 缓存 + 去重
const inflight = new Map<string, Promise<unknown>>();

function dedupeFetch<T>(url: string): Promise<T> {
    if (!inflight.has(url)) {
        inflight.set(
            url,
            fetch(url).then((r) => r.json()).finally(() => inflight.delete(url)), // 完成后删除
        );
    }
    return inflight.get(url) as Promise<T>; // 并发请求自动合并为一次
}

void (async () => {
    try {
        // 同时发起 3 次,实际只发 1 个网络请求(需浏览器或配置了 baseURL 的环境)
        const [a, b, c] = await Promise.all([dedupeFetch('/api/config'), dedupeFetch('/api/config'), dedupeFetch('/api/config')]);
        console.log(a, b, c);
    } catch {
        console.log('(需在浏览器或配置了 baseURL 的环境中运行;Node 直跑会因相对路径无法解析而失败)');
    }
})();
