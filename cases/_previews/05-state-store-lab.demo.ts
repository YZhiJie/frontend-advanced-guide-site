// 05-state-store-lab 在线预览：不可变 setState + 订阅去重 + 记忆化 selector + 中间件
import { createStore, logger } from "../05-state-store-lab/src/store.ts";
import { section, button, buttonRow, output, log, table } from "./shared.ts";

interface State {
  count: number;
  list: string[];
}

const sec = section(
  "极简状态容器",
  "观察每次操作触发了几次订阅通知、selector 重算了几次（记忆化命中不重算）",
);
const out = output(sec);

let notifyCount = 0;
let selectorRuns = 0;

const store = createStore<State>(
  { count: 0, list: [] },
  {
    middleware: [
      logger<State>({
        name: "demo",
        log: (e) =>
          log(
            out,
            `[中间件] ${e.name}: ${JSON.stringify(e.prev)} → ${JSON.stringify(e.next)}`,
            "dim",
          ),
      }),
    ],
  },
);

store.subscribe(() => {
  notifyCount++;
});

// 记忆化 selector：同一状态快照重复调用不重算
const selectDoubled = store.select((s: State) => {
  selectorRuns++;
  return s.count * 2;
});

const row = buttonRow(sec);
button(row, "▶ set count+1", () =>
  store.setState((s) => ({ count: s.count + 1 })),
);
button(row, "▶ set 相同 state（浅相等 → 不通知）", () =>
  store.setState({ count: store.getState().count }),
);
button(row, "▶ push list 项", () =>
  store.setState((s) => ({ list: [...s.list, `item-${s.list.length + 1}`] })),
);
button(row, "▶ batch（合并 3 次 setState 为 1 次通知）", () => {
  notifyCount = 0;
  store.batch(() => {
    store.setState((s) => ({ count: s.count + 1 }));
    store.setState((s) => ({ count: s.count + 1 }));
    store.setState((s) => ({ count: s.count + 1 }));
  });
  log(out, `batch 内 3 次 setState，实际通知 ${notifyCount} 次`, "ok");
});
button(row, "📊 selector 记忆化统计", () => {
  selectorRuns = 0;
  selectDoubled();
  selectDoubled();
  table(out, [
    ["当前 state", store.getState()],
    ["selectDoubled() 两次调用值", selectDoubled()],
    ["selector 实际重算次数（3 次调用、state 未变 → 1）", selectorRuns],
  ]);
});
button(row, "🧹 清空日志", () => out.replaceChildren());
