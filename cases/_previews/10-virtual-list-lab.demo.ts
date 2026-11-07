// 10-virtual-list-lab 在线预览：拖动滚动条，观察窗口区间 / 渲染行数 / 变高模式的高度校正
import { createVirtualList } from "../10-virtual-list-lab/src/virtual-list.ts";
import { section, button, buttonRow, output, log, table } from "./shared.ts";

const sec = section("虚拟列表定位", "总 10 万行，视口 600px。拖动滑块模拟 scrollTop，看可视窗口只切出几十行");
const out = output(sec);

const COUNT = 100_000;
const VIEWPORT = 600;

function show(label: string, api: ReturnType<typeof createVirtualList>) {
    const range = api.getRange();
    const visible = api.getVisibleItems();
    table(out, [
        [label, ""],
        ["窗口 [startIndex .. endIndex]（含 overscan）", `${range.startIndex} .. ${range.endIndex}`],
        ["渲染行数（远小于 100000）", visible.length],
        ["首项位移 offsetY", `${range.offsetY.toFixed(1)}px`],
        ["列表总高度", `${api.getTotalHeight().toLocaleString()}px`],
    ]);
}

const row = buttonRow(sec);
button(row, "▶ 定高模式（40px/行）", () => {
    out.replaceChildren();
    const api = createVirtualList({ itemCount: COUNT, viewportHeight: VIEWPORT, itemHeight: 40, overscan: 2 });
    api.setScrollTop(123_456);
    show("scrollTop=123456", api);
    api.setScrollTop(3_999_960);
    show("滚到接近底部 scrollTop=3999960", api);
});

button(row, "▶ 变高模式（预估 40px，逐项实测校正）", () => {
    out.replaceChildren();
    const api = createVirtualList({ itemCount: COUNT, viewportHeight: VIEWPORT, itemHeight: 40, overscan: 2 });
    api.setScrollTop(120_000);
    show("未实测：按预估 40px 定位", api);
    // 模拟前 2000 项实测平均 80px：偏移表被校正，同 scrollTop 定位到不同 item
    for (let i = 0; i < 2000; i++) api.measure(i, 80);
    api.setScrollTop(120_000);
    show("实测前 2000 项(80px)后：同 scrollTop 定位变化", api);
});

button(row, "▶ overscan 缓冲对比（0 vs 6）", () => {
    out.replaceChildren();
    const a = createVirtualList({ itemCount: COUNT, viewportHeight: VIEWPORT, itemHeight: 40, overscan: 0 });
    a.setScrollTop(50_000);
    const b = createVirtualList({ itemCount: COUNT, viewportHeight: VIEWPORT, itemHeight: 40, overscan: 6 });
    b.setScrollTop(50_000);
    log(out, `overscan=0：渲染 ${a.getVisibleItems().length} 行（${a.getRange().startIndex}..${a.getRange().endIndex}）`, "dim");
    log(out, `overscan=6：渲染 ${b.getVisibleItems().length} 行（${b.getRange().startIndex}..${b.getRange().endIndex}）`, "dim");
    log(out, "缓冲越多滚动越不容易露白，代价是多渲染几行", "info");
});
