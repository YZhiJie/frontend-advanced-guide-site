// 文件: cases/03-monorepo-toolkit/test/topo.test.ts
// ============ 依赖图构建 / 拓扑排序 / 环检测 / 多级依赖链 ============

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildGraph, topologicalSort } from "../src/topo.js"
import { runTasks } from "../src/run-tasks.js"
import type { PackageInfo } from "../src/topo.js"

interface PackageSpec {
    deps?: string[]
    scripts?: Record<string, string>
}

/** 在临时目录里铺一个工作区：根 package.json（workspaces: ["packages/*"]）+ 各子包 package.json */
async function scaffold(packages: Record<string, PackageSpec>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "fag-monorepo-"))
    await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }, null, 2),
    )
    for (const [name, spec] of Object.entries(packages)) {
        const dir = join(root, "packages", name)
        await mkdir(dir, { recursive: true })
        const dependencies: Record<string, string> = {}
        for (const dep of spec.deps ?? []) dependencies[dep] = "workspace:*"
        await writeFile(
            join(dir, "package.json"),
            JSON.stringify({ name, version: "1.0.0", dependencies, scripts: spec.scripts ?? {} }, null, 2),
        )
    }
    return root
}

/** 收尾：删除临时工作区 */
function cleanup(root: string): Promise<void> {
    return rm(root, { recursive: true, force: true })
}

test("buildGraph 收集工作区包，并只保留工作区内的依赖", async () => {
    const root = await scaffold({
        a: { deps: ["b", "react"] },
        b: { deps: ["c"] },
        c: {},
    })
    const graph = await buildGraph(root)

    assert.deepEqual([...graph.packages.keys()].sort(), ["a", "b", "c"])
    // react 不是工作区包，应被忽略
    assert.deepEqual(graph.packages.get("a")!.dependencies, ["b"])
    assert.deepEqual(graph.packages.get("b")!.dependencies, ["c"])
    assert.deepEqual(graph.packages.get("c")!.dependencies, [])

    await cleanup(root)
})

test("topologicalSort 保证依赖排在依赖方之前", async () => {
    const root = await scaffold({ a: { deps: ["b"] }, b: { deps: ["c"] }, c: {} })
    const order = topologicalSort(await buildGraph(root))

    assert.ok(order.indexOf("c") < order.indexOf("b"))
    assert.ok(order.indexOf("b") < order.indexOf("a"))

    await cleanup(root)
})

test("存在循环依赖时抛出并列出涉及环的包", async () => {
    const root = await scaffold({ a: { deps: ["b"] }, b: { deps: ["a"] } })
    const graph = await buildGraph(root)

    assert.throws(() => topologicalSort(graph), /循环依赖/)
    let message = ""
    try {
        topologicalSort(graph)
    } catch (error) {
        message = (error as Error).message
    }
    assert.match(message, /a/)
    assert.match(message, /b/)

    await cleanup(root)
})

test("无依赖的多个包可被排序，且顺序按字典序稳定", async () => {
    const root = await scaffold({ b: {}, a: {}, c: {} })
    const order = topologicalSort(await buildGraph(root))

    assert.deepEqual(order, ["a", "b", "c"])

    await cleanup(root)
})

test("多级依赖链按逆序输出", async () => {
    const root = await scaffold({
        a: { deps: ["b"] },
        b: { deps: ["c"] },
        c: { deps: ["d"] },
        d: {},
    })
    const order = topologicalSort(await buildGraph(root))

    assert.deepEqual(order, ["d", "c", "b", "a"])

    await cleanup(root)
})

test("runTasks 按拓扑序执行，并跳过未定义该 script 的包", async () => {
    const root = await scaffold({
        a: { deps: ["b"], scripts: { build: "tsc" } },
        b: { deps: ["c"], scripts: { build: "tsc" } },
        c: { scripts: {} },
    })
    const executed: string[] = []
    const result = await runTasks(root, {
        script: "build",
        executor: async (pkg: PackageInfo) => {
            executed.push(pkg.name)
        },
    })

    assert.deepEqual(executed, ["b", "a"])
    assert.deepEqual(result.order, ["b", "a"])
    assert.equal(result.skipped.length, 1)
    assert.match(result.skipped[0], /c/)

    await cleanup(root)
})
