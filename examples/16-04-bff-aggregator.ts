// 文件: examples/16-04-bff-aggregator.ts —— BFF 聚合层骨架(Express)
// 安装:npm i express && npm i -D @types/express
import express from 'express';

const app = express();

// ---- 中间件 1:统一日志 ----
app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next(); // 不调用 next,请求就会挂起
});

// ---- 中间件 2:简易内存缓存(GET 幂等接口) ----
const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_TTL = 30_000;
app.get('/api/*', (req, res, next) => {
    const hit = cache.get(req.url);
    if (hit && Date.now() - hit.at < CACHE_TTL) {
        res.json(hit.data); // 命中缓存,短路:不再 next
        return;
    }
    next();
});

// ---- 业务路由:聚合两个下游服务,裁剪字段 ----
app.get('/api/user-profile/:id', async (req, res, next) => {
    try {
        // 并行请求两个下游(呼应 1.5:无依赖的请求一律并行)
        const [user, orders] = await Promise.all([
            fetch(`https://user-service.internal/${req.params.id}`).then((r) => r.json()),
            fetch(`https://order-service.internal?userId=${req.params.id}`).then((r) => r.json()),
        ]);
        const data = {
            name: user.name,                    // 裁剪:前端只要三个字段
            vipLevel: user.vipLevel,
            recentOrders: orders.slice(0, 5),   // 裁剪:只取最近 5 单
        };
        cache.set(req.url, { at: Date.now(), data });
        res.json({ code: 0, data });
    } catch (e) {
        next(e); // 错误交给统一的错误中间件
    }
});

// ---- 错误中间件:四个参数的签名,Express 靠参数个数识别 ----
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[BFF 错误]', err.message);
    res.status(500).json({ code: -1, message: '服务暂不可用' });
});

app.listen(Number(process.env.PORT ?? 3000));
