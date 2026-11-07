// 09-mini-test-lab 在线预览：describe/it/expect + 钩子 + mock 的元演示（含故意失败用例）
import { createRunner, expect, mockFn, type Runner } from "../09-mini-test-lab/src/mini-test.ts";
import { section, button, buttonRow, output, log, table } from "./shared.ts";

const sec = section("迷你测试框架", "注册一套含「通过 / 失败 / 跳过」的用例，运行后渲染报告——框架用自己的断言测自己");
const out = output(sec);

function buildSuite(runner: Runner): void {
    runner.beforeEach(() => log(out, "  [beforeEach] 每个用例前执行", "dim"));
    runner.describe("math", () => {
        runner.it("toBe：值相等", () => {
            expect(1 + 1).toBe(2);
        });
        runner.it("toEqual：深相等", () => {
            expect({ a: [1, { b: 2 }] }).toEqual({ a: [1, { b: 2 }] });
        });
        runner.it("toThrow：捕获异常", () => {
            expect(() => {
                throw new Error("boom");
            }).toThrow(/boom/);
        });
        runner.it("故意失败：演示失败报告", () => {
            expect(1).toBe(2);
        });
        runner.it.skip("跳过的用例", () => {
            void 0;
        });
    });
    runner.describe("mock", () => {
        runner.it("mockFn 记录调用与参数", () => {
            const spy = mockFn<number, [number]>((x) => x * 2);
            spy(3);
            spy(4);
            expect(spy.calls.length).toBe(2);
            expect(spy.results[1]).toBe(8);
        });
    });
}

buttonRow(sec);
button(sec, "▶ 运行测试套件", async () => {
    out.replaceChildren();
    const runner = createRunner();
    buildSuite(runner);
    const summary = await runner.run();
    for (const r of summary.results) {
        const icon = r.status === "passed" ? "✓" : r.status === "failed" ? "✗" : "⊘";
        const kind = r.status === "passed" ? "ok" : r.status === "failed" ? "err" : "dim";
        log(out, `${icon} ${r.fullName}`, kind);
        if (r.status === "failed" && r.error instanceof Error) log(out, `    ↳ ${r.error.message}`, "err");
    }
    table(out, [
        ["通过", summary.passed],
        ["失败（预期内）", summary.failed],
        ["跳过", summary.skipped],
    ]);
    log(out, "观察：失败用例只记录不抛出——框架语义保证报告完整", "info");
});
