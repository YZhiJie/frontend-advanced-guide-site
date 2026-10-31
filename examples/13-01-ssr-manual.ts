// 文件: examples/13-01-ssr-manual.ts —— 手写一个 20 行的 SSR 服务(理解原理用)
// 安装:npm i express react react-dom && npm i -D @types/express @types/react-dom
import express from 'express';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

const app = express();

// ① 组件写法与客户端完全一致(同一份组件代码两端共用)
const List = ({ items }: { items: string[] }) =>
    createElement('ul', null, items.map((it) => createElement('li', { key: it }, it)));

app.get('/', async (_req, res) => {
    // ② 服务端取数:可直连数据库/内网服务,没有 CORS 问题,密钥不出服务器
    const items = await fetch('https://api.example.com/list').then((r) => r.json());

    // ③ 把组件渲染成 HTML 字符串 —— 用户拿到就能看到内容,不用等 JS
    const html = renderToString(createElement(List, { items }));

    // ④ 数据同时注入 window,供客户端脚本 hydration 使用
    res.send(`<!DOCTYPE html>
        <html><body>
            <div id="root">${html}</div>
            <script>window.__DATA__ = ${JSON.stringify(items)}</script>
            <script type="module" src="/client.js"></script>
        </body></html>`);

    // client.js 中:hydrateRoot(root, createElement(List, { items: window.__DATA__ }))
    // → hydration 认领 DOM 并挂事件,页面从此可交互(TTI)
});

app.listen(3000);
// 客户端入口 client.js:hydrateRoot(document.getElementById('root'), <App items={window.__DATA__} />)
// 服务端渲染的 HTML 立即可见;hydration 后事件绑定、可交互(TTI)
