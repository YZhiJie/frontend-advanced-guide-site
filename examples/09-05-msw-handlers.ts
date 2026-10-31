// 文件: examples/09-05-msw-handlers.ts —— MSW mock 定义(一处定义,处处可用)
// @ts-nocheck —— 示意代码:依赖 msw,本仓库 examples 不安装该包。实际项目需 npm i -D msw。详见 09-testing.md 9.5 节。
//
// 设计要点:
// 1. handlers 用一个固定数据池(Map),便于不同测试切换状态
// 2. 路径参数 / 请求体 / 查询参数 三种 URL 形态都覆盖
// 3. 错误分支(404/401/500)必须 mock —— 这是 bug 高发区
// 4. 网络级超时(60s delay)让前端降级逻辑可被测
// 5. 在单测中用 server.use() 临时覆盖,afterEach 用 resetHandlers 复位

import { http, HttpResponse, delay, PathParams } from 'msw';

// 用一个固定的假数据池,便于不同测试切换
const users = new Map<string, { id: string; name: string; age: number }>([
    ['1', { id: '1', name: 'Alice', age: 18 }],
    ['2', { id: '2', name: 'Bob',   age: 22 }],
]);

export const handlers = [
    // ---- GET 路径参数 ----
    http.get('/api/user/:id', async ({ params }) => {
        const id = (params as PathParams).id as string;
        const user = users.get(id);
        if (!user) return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
        await delay(200);                       // 模拟网络延迟,让 loading 态可被测试
        return HttpResponse.json(user);
    }),

    // ---- POST 请求体解析 ----
    http.post('/api/login', async ({ request }) => {
        const { username, password } = (await request.json()) as { username: string; password: string };
        if (username === 'admin' && password === 'pass') {
            return HttpResponse.json({ token: 'fake-token' });
        }
        return HttpResponse.json({ message: '用户名或密码错误' }, { status: 401 });
    }),

    // ---- 查询参数 ----
    http.get('/api/users', async ({ request }) => {
        const url = new URL(request.url);
        const page  = Number(url.searchParams.get('page')  ?? '1');
        const size  = Number(url.searchParams.get('size')  ?? '10');
        const list  = [...users.values()].slice((page - 1) * size, page * size);
        return HttpResponse.json({ total: users.size, list });
    }),

    // ---- 错误分支:这是 bug 高发区,必须覆盖 ----
    http.get('/api/orders/:id', async ({ params }) => {
        const id = (params as PathParams).id as string;
        if (id === '500') {                      // 占位 ID 测 500 错误
            return HttpResponse.json({ message: 'DB down' }, { status: 500 });
        }
        return HttpResponse.json({ id, status: 'paid' });
    }),

    // ---- 网络级超时:让前端降级逻辑可被测 ----
    http.get('/api/slow', async () => {
        await delay(60_000);                     // 60s 后才返回,测试超时降级
        return HttpResponse.json({ ok: true });
    }),
];
