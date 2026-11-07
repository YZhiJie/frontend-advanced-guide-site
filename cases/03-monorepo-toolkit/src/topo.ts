// 文件: cases/03-monorepo-toolkit/src/topo.ts
// ============ 最小 monorepo 工具链：workspace 依赖图 + 拓扑排序（含环检测） ============

import { readFile, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"

/** 根包 / 子包 package.json 中我们关心的字段 */
export interface PackageJson {
    name?: string
    version?: string
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    workspaces?: string[] | { packages?: string[] }
}

/** 单个工作区包的信息 */
export interface PackageInfo {
    /** 包名（取自子包 package.json 的 name） */
    name: string
    /** 包所在目录（绝对路径） */
    dir: string
    /** 该包声明的 scripts */
    scripts: Record<string, string>
    /** 该包依赖的、且属于工作区内的其他包名（已排序、去重） */
    dependencies: string[]
}

/** 包依赖图 */
export interface DependencyGraph {
    /** 工作区根目录（绝对路径） */
    root: string
    /** 包名 -> 包信息 */
    packages: Map<string, PackageInfo>
}

async function readJson<T>(file: string): Promise<T> {
    return JSON.parse(await readFile(file, "utf8")) as T
}

/** 从 package.json 提取 workspaces 列表，兼容数组与 { packages } 两种写法 */
function readWorkspacePatterns(pkg: PackageJson): string[] {
    const workspaces = pkg.workspaces
    if (!workspaces) return []
    return Array.isArray(workspaces) ? workspaces : (workspaces.packages ?? [])
}

/** 把 workspace 通配模式展开为具体目录绝对路径；支持 "packages/*" 形式 */
async function expandPattern(root: string, pattern: string): Promise<string[]> {
    const suffix = "/*"
    if (!pattern.endsWith(suffix)) return [resolve(root, pattern)]
    const base = resolve(root, pattern.slice(0, -suffix.length))
    try {
        const entries = await readdir(base, { withFileTypes: true })
        return entries.filter((entry) => entry.isDirectory()).map((entry) => join(base, entry.name))
    } catch {
        // 目录不存在时视为无匹配
        return []
    }
}

/** 读取子包 package.json；目录下没有该文件时返回 null */
async function readPackage(dir: string): Promise<PackageJson | null> {
    try {
        return await readJson<PackageJson>(join(dir, "package.json"))
    } catch {
        return null
    }
}

/** 扫描根 package.json 的 workspaces，构建包依赖图 */
export async function buildGraph(root: string): Promise<DependencyGraph> {
    const rootPkg = await readJson<PackageJson>(join(root, "package.json"))

    const dirs: string[] = []
    for (const pattern of readWorkspacePatterns(rootPkg)) {
        dirs.push(...(await expandPattern(root, pattern)))
    }

    // 先收集全部包名，才能判断某个依赖是否属于“工作区内依赖”
    const raw: Array<{ pkg: PackageJson; dir: string }> = []
    for (const dir of dirs) {
        const pkg = await readPackage(dir)
        if (pkg?.name) raw.push({ pkg, dir })
    }
    const workspaceNames = new Set(raw.map(({ pkg }) => pkg.name!))

    const packages = new Map<string, PackageInfo>()
    for (const { pkg, dir } of raw) {
        const deps = new Set<string>()
        const sections = [
            pkg.dependencies,
            pkg.devDependencies,
            pkg.peerDependencies,
            pkg.optionalDependencies,
        ]
        for (const section of sections) {
            if (!section) continue
            for (const dep of Object.keys(section)) {
                if (workspaceNames.has(dep)) deps.add(dep)
            }
        }
        packages.set(pkg.name!, {
            name: pkg.name!,
            dir,
            scripts: pkg.scripts ?? {},
            dependencies: [...deps].sort(),
        })
    }

    return { root, packages }
}

/**
 * 拓扑排序：返回包名数组，保证每个包的依赖都排在其前面。
 * 使用 Kahn 算法；若存在循环依赖则抛错，并列出卡在环里的包。
 */
export function topologicalSort(graph: DependencyGraph): string[] {
    const names = [...graph.packages.keys()].sort()

    // 入度：某个包还有多少个“工作区内依赖”尚未排到前面
    const indegree = new Map<string, number>(names.map((name) => [name, 0]))
    // 反向邻接：dep -> 依赖它的包列表
    const dependents = new Map<string, string[]>(names.map((name) => [name, []]))
    for (const name of names) {
        for (const dep of graph.packages.get(name)!.dependencies) {
            if (!graph.packages.has(dep)) continue
            indegree.set(name, indegree.get(name)! + 1)
            dependents.get(dep)!.push(name)
        }
    }

    // 从入度为 0 的包出发；names 已按字典序，保证输出稳定
    const queue = names.filter((name) => indegree.get(name) === 0)
    const sorted: string[] = []
    while (queue.length > 0) {
        const current = queue.shift()!
        sorted.push(current)
        for (const dependent of dependents.get(current)!) {
            const left = indegree.get(dependent)! - 1
            indegree.set(dependent, left)
            if (left === 0) queue.push(dependent)
        }
    }

    if (sorted.length !== names.length) {
        const sortedSet = new Set(sorted)
        const cycle = names.filter((name) => !sortedSet.has(name))
        throw new Error(`检测到循环依赖，涉及以下包：${cycle.join(", ")}`)
    }
    return sorted
}
