// 04-mini-framework-lab 在线预览：vdom diff 命令 + reactive effect + fiber 构建日志
import {
  h,
  diff,
  collectDOMCommands,
} from "../04-mini-framework-lab/src/vdom.ts";
import { reactive, effect } from "../04-mini-framework-lab/src/reactivity.ts";
import {
  schedule,
  waitForIdle,
  lastRunRecords,
  __resetScheduler,
} from "../04-mini-framework-lab/src/scheduler.ts";
import { render } from "../04-mini-framework-lab/src/fiber.ts";
import {
  section,
  button,
  buttonRow,
  output,
  log,
  pre,
  table,
} from "./shared.ts";

const sec = section(
  "vdom 同层 diff",
  "每次操作生成新 VNode 树，diff 出 CREATE / REMOVE / UPDATE 命令序列",
);
const out = output(sec);

let items = ["a", "b", "c"];
let v1: ReturnType<typeof h> | null = null;

function tree(list: string[]): ReturnType<typeof h> {
  return h(
    "ul",
    { className: "todo" },
    list.map((t, i) =>
      h("li", { key: `k${t}`, className: i % 2 ? "odd" : "even" }, t),
    ),
  );
}

function renderDiff(label: string, list: string[]) {
  const v2 = tree(list);
  const patches = [diff(v1, v2)];
  const cmds = collectDOMCommands(patches, "root");
  log(
    out,
    `${label}：${cmds.length === 0 ? "无 DOM 变更（key 命中原地复用）" : ""}`,
    "ok",
  );
  for (const c of cmds) pre(out, c, "info");
  v1 = v2;
  items = list;
}

buttonRow(sec);
button(sec, "① 首次渲染 [a,b,c]", () =>
  renderDiff("首次渲染", ["a", "b", "c"]),
);
button(sec, "② 尾部追加 d", () => renderDiff("追加 d", [...items, "d"]));
button(sec, "③ 删除首项 a（keyed：b/c/d 复用不重建）", () =>
  renderDiff(
    "删除首项",
    items.filter((x) => x !== "a"),
  ),
);
button(sec, "④ 中间改文本 b→B", () => {
  const list = items.map((x) => (x === "b" ? "B" : x));
  renderDiff("改文本", list);
});

const sec2 = section(
  "reactive + effect + 调度器",
  "Proxy 响应式收集依赖；任务按 high/normal/low/idle 分级出队",
);
const out2 = output(sec2);

const state = reactive({ count: 0, label: "hello" });
const row2 = buttonRow(sec2);

let effRuns = 0;
effect(() => {
  effRuns++;
  void state.count;
});

button(row2, "▶ state.count++（观察 effect 重跑）", () => {
  const before = effRuns;
  state.count++;
  table(out2, [
    ["count", state.count],
    ["effect 重跑次数增量（同步触发）", effRuns - before],
  ]);
});

button(row2, "▶ 调度器：混合优先级入队", async () => {
  __resetScheduler();
  log(out2, "入队顺序：idle → low → normal → high，观察实际执行顺序", "info");
  const noop = () => void 0;
  schedule(noop, "idle");
  schedule(noop, "low");
  schedule(noop, "normal");
  schedule(noop, "high");
  await waitForIdle(60);
  for (const r of lastRunRecords)
    log(out2, `${r.priority}（第 ${r.order} 个执行）`, "ok");
});

button(row2, "▶ fiber 同步 render（begin/complete 构建序）", () => {
  const t = h(
    "div",
    { id: "app" },
    h("h1", null, "标题"),
    h("p", null, "段落"),
  );
  const r = render(t, { sync: true });
  for (const b of r.buildLog)
    log(
      out2,
      `${b.phase.padEnd(8)} ${b.fiberType}`,
      b.phase === "begin" ? "info" : "ok",
    );
});
