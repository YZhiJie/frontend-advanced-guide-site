// 03-monorepo-toolkit 在线预览：虚拟 workspace 的依赖图 + 拓扑排序 + 按序执行（dry-run）
import { setVirtualWorkspace, spawnLog } from "./mocks/node-fs.ts";
import { buildGraph, topologicalSort } from "../03-monorepo-toolkit/src/topo.ts";
import { runTasks } from "../03-monorepo-toolkit/src/run-tasks.ts";
import { section, button, buttonRow, output, log, pre } from "./shared.ts";

// esbuild define 把 process.platform 替换为 "browser"，无残留引用
const ROOT = "/repo";

function pkg(name: string, deps: string[] = [], extra: Record<string, unknown> = {}): string {
    return JSON.stringify({ name, scripts: { build: "echo build", test: "echo test", ...extra }, dependencies: deps.length ? Object.fromEntries(deps.map((d) => [d, "*"])) : undefined });
}

const NORMAL_TREE = {
    [`${ROOT}/package.json`]: JSON.stringify({ workspaces: ["packages/*"] }),
    [`${ROOT}/packages/cli/package.json`]: pkg("@demo/cli", ["@demo/core", "@demo/utils"]),
    [`${ROOT}/packages/core/package.json`]: pkg("@demo/core", ["@demo/utils"]),
    [`${ROOT}/packages/utils/package.json`]: pkg("@demo/utils"),
};

const CYCLE_TREE = {
    [`${ROOT}/package.json`]: JSON.stringify({ workspaces: ["packages/*"] }),
    [`${ROOT}/packages/a/package.json`]: pkg("@demo/a", ["@demo/b"]),
    [`${ROOT}/packages/b/package.json`]: pkg("@demo/b", ["@demo/c"]),
    [`${ROOT}/packages/c/package.json`]: pkg("@demo/c", ["@demo/a"]),
};

const sec = section("monorepo 任务编排", "node:fs / node:child_process 已替换为浏览器 mock——虚拟文件树注入，spawn 只记录不执行");
const out = output(sec);
const row = buttonRow(sec);

async function run(tree: Record<string, string>, label: string, script: string) {
    setVirtualWorkspace(tree);
    spawnLog.length = 0;
    try {
        const graph = await buildGraph(ROOT);
        const order = topologicalSort(graph);
        log(out, `${label}：拓扑序 = ${order.join(" → ")}`, "ok");
        const r = await runTasks(ROOT, { script, logger: (m) => log(out, `  ${m}`, "dim") });
        log(out, `执行 ${r.order.length} 个包，跳过 ${r.skipped.length} 个；spawn 记录：`, "info");
        for (const s of spawnLog) log(out, `  $ npm ${s.args.join(" ")}  (cwd=${s.cwd})`);
    } catch (err) {
        log(out, `${label}：`, "err");
        pre(out, err instanceof Error ? err.message : err, "err");
    }
}

button(row, "▶ 正常工作区：按序 build", () => run(NORMAL_TREE, "正常工作区", "build"));
button(row, "▶ 环形依赖：检测并报错", () => run(CYCLE_TREE, "环形依赖", "build"));
button(row, "▶ skipMissing：test 只在部分包定义", () =>
    run(NORMAL_TREE, "skipMissing 演示", "test"));
