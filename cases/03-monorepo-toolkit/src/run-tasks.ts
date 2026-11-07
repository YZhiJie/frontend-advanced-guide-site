// 文件: cases/03-monorepo-toolkit/src/run-tasks.ts
// ============ 按拓扑序对各子包执行指定 script ============

import { spawn } from "node:child_process"
import { buildGraph, topologicalSort, type PackageInfo } from "./topo.js"

/** 单个包的执行器签名；默认实现会派生子进程，测试可注入替身 */
export type TaskExecutor = (pkg: PackageInfo, script: string) => Promise<void>

export interface RunTasksOptions {
    /** 要执行的 script 名，如 "build" / "test" */
    script: string
    /** 自定义执行器，缺省使用 npmExecutor */
    executor?: TaskExecutor
    /** 日志回调 */
    logger?: (message: string) => void
    /** 是否跳过未定义该 script 的包，默认 true */
    skipMissing?: boolean
}

export interface RunTasksResult {
    /** 实际执行过的包名，按执行顺序 */
    order: string[]
    /** 被跳过的包及原因 */
    skipped: string[]
}

/** 默认执行器：在子包目录内运行 `npm run <script>` */
export function npmExecutor(pkg: PackageInfo, script: string): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn("npm", ["run", script], {
            cwd: pkg.dir,
            stdio: "inherit",
            shell: process.platform === "win32",
        })
        child.on("error", rejectPromise)
        child.on("close", (code) => {
            if (code === 0) resolvePromise()
            else rejectPromise(new Error(`包 ${pkg.name} 执行 ${script} 失败，退出码 ${code}`))
        })
    })
}

/** 按拓扑序（依赖先于依赖方）遍历所有工作区包并执行指定 script */
export async function runTasks(root: string, options: RunTasksOptions): Promise<RunTasksResult> {
    const graph = await buildGraph(root)
    const order = topologicalSort(graph)
    const executor = options.executor ?? npmExecutor
    const logger = options.logger ?? (() => {})
    const skipMissing = options.skipMissing ?? true

    const executed: string[] = []
    const skipped: string[] = []

    for (const name of order) {
        const pkg = graph.packages.get(name)!
        if (skipMissing && !pkg.scripts[options.script]) {
            skipped.push(`${pkg.name}（未定义 ${options.script} 脚本）`)
            logger(`跳过 ${pkg.name}：未定义 ${options.script} 脚本`)
            continue
        }
        logger(`执行 ${pkg.name}: npm run ${options.script}`)
        await executor(pkg, options.script)
        executed.push(pkg.name)
    }

    return { order: executed, skipped }
}
