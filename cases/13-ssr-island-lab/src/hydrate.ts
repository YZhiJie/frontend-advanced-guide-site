// 文件: cases/13-ssr-island-lab/src/hydrate.ts
// ============ 客户端 hydration：按岛屿清单把组件挂载到占位节点 ============
//
// 核心约束：客户端只遍历「服务端产出的岛屿清单」。
// 因此非岛屿节点天然不会被挂载——这就是「只有被标记为岛屿的节点才被 hydration」。
// 宿主节点查找与组件注册表全部通过参数注入，便于在无 DOM 的 Node 环境测试。

import type { IslandDescriptor } from './vnode.js'

/**
 * 客户端最小宿主节点。真实环境是 DOM Element，
 * 这里只保留 `id`（对应 data-island-id）以便测试断言。
 */
export interface IslandHost {
    readonly id: string
}

/** 客户端挂载函数：收到服务端原样透传的 props 与占位节点 */
export type MountFn<P extends Record<string, unknown> = Record<string, unknown>> = (
    props: P,
    el: IslandHost,
) => void

/** 岛屿组件注册表：组件名 -> 挂载实现 */
export interface IslandRegistry {
    readonly [name: string]: MountFn
}

/** hydration 结果报告 */
export interface HydrateReport {
    /** 已挂载的岛屿 id，按清单出现顺序排列 */
    readonly mounted: string[]
    /** 被跳过的岛屿 id（未注册，或找不到对应占位节点） */
    readonly skipped: string[]
}

/** hydration 选项 */
export interface HydrateOptions {
    /** true：遇到未注册岛屿直接抛错（便于开发期暴露漏注册）；默认 false：跳过并记录 */
    readonly requireAll?: boolean
}

/**
 * 执行 hydration。
 *
 * @param descriptors  服务端产出的岛屿清单
 * @param registry     客户端组件注册表
 * @param resolveHost  按 id 查占位节点，返回 null 表示节点缺失
 * @param options      requireAll 控制未注册岛屿是跳过还是报错
 */
export function hydrateIslands(
    descriptors: readonly IslandDescriptor[],
    registry: IslandRegistry,
    resolveHost: (id: string) => IslandHost | null,
    options: HydrateOptions = {},
): HydrateReport {
    const mounted: string[] = []
    const skipped: string[] = []

    for (const descriptor of descriptors) {
        const mount: MountFn | undefined = registry[descriptor.name]
        // 未注册：默认跳过；requireAll 时立刻报错，避免「静默失效」的岛屿
        if (mount === undefined) {
            if (options.requireAll === true) {
                throw new Error(
                    `未注册的岛屿组件：${descriptor.name}（id=${descriptor.id}）`,
                )
            }
            skipped.push(descriptor.id)
            continue
        }

        const host = resolveHost(descriptor.id)
        // 清单里有、页面上却没有对应占位节点：同样跳过
        if (host === null) {
            skipped.push(descriptor.id)
            continue
        }

        // props 原样透传（同一引用），宿主节点也按 id 精确交付
        mount(descriptor.props, host)
        mounted.push(descriptor.id)
    }

    return { mounted, skipped }
}
