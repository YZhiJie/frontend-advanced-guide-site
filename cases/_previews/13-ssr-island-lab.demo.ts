// 13-ssr-island-lab 在线预览：服务端渲染（HTML + 岛屿清单）→ 客户端按需 hydration
import { h, renderPage } from "../13-ssr-island-lab/src/vnode.ts";
import { hydrateIslands } from "../13-ssr-island-lab/src/hydrate.ts";
import { section, button, buttonRow, output, log, pre, table } from "./shared.ts";

const sec = section("服务端渲染", "整页 renderToString：静态部分直出 HTML，交互岛屿只留占位 + 清单");
const out = output(sec);

let page: ReturnType<typeof renderPage> | null = null;

buttonRow(sec);
button(sec, "① 服务端 renderPage", () => {
    page = renderPage(
        h("html", null,
            h("body", null,
                h("header", null, "静态头部（无需 JS）"),
                h("section", { island: "Counter", islandId: "hero-counter", initial: 3 }),
                h("main", null, "静态正文：文章内容直出"),
                h("aside", { island: "ChatWidget", islandId: "chat-1", collapsed: true }),
                h("footer", null, "静态页脚"),
            ),
        ),
    );
    pre(out, page.html, "ok");
    log(out, `岛屿清单：${page.islands.map((i) => `${i.id}(${i.name})`).join("、")}`, "info");
});

button(sec, "② 客户端 hydrateIslands（占位节点可解析）", () => {
    if (!page) return log(out, "先执行服务端渲染", "err");
    const hosts = new Map(page.islands.map((i) => [i.id, { id: i.id }]));
    const report = hydrateIslands(page.islands, {
        Counter: (props, el) => log(out, `mount Counter#${el.id} props=${JSON.stringify(props)} → 绑定点击计数`, "ok"),
        ChatWidget: (props, el) => log(out, `mount ChatWidget#${el.id} props=${JSON.stringify(props)} → 建立长连接`, "ok"),
    }, (id) => hosts.get(id) ?? null);
    table(out, [
        ["已挂载", report.mounted.join("、")],
        ["跳过", report.skipped.length ? report.skipped.join("、") : "（无）"],
    ]);
    log(out, "只有两个岛屿执行了 JS，页面的其余部分保持纯静态——这就是岛屿架构的按需激活", "info");
});

button(sec, "③ 漏注册场景（requireAll:false 跳过并记录）", () => {
    if (!page) return log(out, "先执行服务端渲染", "err");
    const hosts = new Map(page.islands.map((i) => [i.id, { id: i.id }]));
    const report = hydrateIslands(page.islands, {
        Counter: () => log(out, "mount Counter（ChatWidget 未注册）", "ok"),
    }, (id) => hosts.get(id) ?? null);
    log(out, `mounted=${report.mounted} skipped=${report.skipped}`, report.skipped.length ? "err" : "ok");
});
