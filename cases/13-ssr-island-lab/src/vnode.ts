// 文件: cases/13-ssr-island-lab/src/vnode.ts
// ============ 极简 vnode 与 SSR 渲染器：HTML 转义 + 岛屿占位标记 ============
//
// 服务端职责（本文件）：
//   1. 把 vnode 树递归渲染成 HTML 字符串；
//   2. 所有文本与属性值一律走转义表，杜绝 SSR 拼串造成的 XSS；
//   3. 把标记 `island: true` 的子树降级为占位节点，并收集「岛屿清单」交给客户端。
// 客户端职责（见 hydrate.ts）：
//   只按清单把注册表里的组件挂到对应 `data-island-id` 占位节点上，完成 hydration。

/**
 * 极简虚拟节点（vnode）。
 * 这里不引 React/Vue，不做组件抽象，`type` 既表示宿主元素标签名，
 * 也表示岛屿组件在客户端注册表里的名字。
 */
export interface VNode {
    /** 元素标签名，或岛屿组件名 */
    readonly type: string
    /** 属性袋：`island: true` 是岛屿边界标记，`islandId` 用于显式指定占位 id */
    readonly props: Readonly<Record<string, unknown>>
    /** 子节点：文本 / 数字 / 嵌套 vnode / 数组皆可 */
    readonly children: readonly VNodeChild[]
}

/** 子节点联合类型（数组形态用于铺开列表） */
export type VNodeChild =
    | VNode
    | string
    | number
    | boolean
    | null
    | undefined
    | readonly VNodeChild[]

/** 岛屿描述：服务端交付给客户端的「待 hydration 清单」里的一项 */
export interface IslandDescriptor {
    /** 与服务端占位节点上的 data-island-id 一一对应 */
    readonly id: string
    /** 客户端注册表里的组件名 */
    readonly name: string
    /** 透传给客户端 mount 的原始 props（已剔除标记字段 island / islandId） */
    readonly props: Readonly<Record<string, unknown>>
}

/** 渲染上下文：承接本次渲染产出的岛屿清单，并提供稳定编号 */
export interface RenderContext {
    /** 本次渲染收集到的岛屿清单，按遍历顺序排列 */
    readonly islands: IslandDescriptor[]
    /** 产出下一个自动编号，形如 island-0 / island-1 ... */
    readonly nextId: () => string
}

/** 创建渲染上下文（编号在闭包里自增，保证多次渲染结果确定） */
export function createRenderContext(): RenderContext {
    let cursor = 0
    return {
        islands: [],
        nextId: () => `island-${cursor++}`,
    }
}

/**
 * HTML 转义表：文本内容与属性值都必须过这张表。
 * 覆盖五类危险字符，其中引号两种形态都要转义，避免逃逸出 HTML 属性边界。
 */
const ESCAPE_MAP: Readonly<Record<string, string>> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
}

/** 转义一段文本：`& < > " '` -> 实体，其余字符原样保留 */
export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch)
}

/** 岛屿边界标记的保留字段：不会进入客户端的 props，也不会渲染成属性 */
const ISLAND_FLAG = 'island'
const ISLAND_ID_KEY = 'islandId'
const RESERVED_ISLAND_KEYS = new Set<string>([ISLAND_FLAG, ISLAND_ID_KEY])

/**
 * 创建 vnode：`h(type, props, ...children)`。
 * children 可传数组铺开，渲染时会统一拍平。
 */
export function h(
    type: string,
    props?: Readonly<Record<string, unknown>> | null,
    ...children: VNodeChild[]
): VNode {
    return { type, props: props ?? {}, children }
}

/**
 * 把 vnode 树渲染为 HTML 字符串。
 * 传入 ctx 时，岛屿清单会写入 ctx.islands；不传则自动建一个（清单被丢弃）。
 */
export function renderToString(
    node: VNodeChild,
    ctx: RenderContext = createRenderContext(),
): string {
    return renderNode(node, ctx)
}

/** 节点分派：空值/布尔 -> 空串；文本/数字 -> 转义后输出；数组 -> 拍平拼接 */
function renderNode(node: VNodeChild, ctx: RenderContext): string {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string') return escapeHtml(node)
    if (typeof node === 'number') return escapeHtml(String(node))
    if (Array.isArray(node)) {
        return node.map((child) => renderNode(child as VNodeChild, ctx)).join('')
    }
    return renderElement(node as VNode, ctx)
}

/** 渲染元素或岛屿占位 */
function renderElement(vnode: VNode, ctx: RenderContext): string {
    // 岛屿边界：命中标记就不再渲染子树，只留占位节点 + 登记清单
    if (vnode.props[ISLAND_FLAG] === true) {
        return renderIslandPlaceholder(vnode, ctx)
    }
    const attrs = renderAttrs(vnode.props)
    const inner = vnode.children.map((child) => renderNode(child, ctx)).join('')
    return `<${vnode.type}${attrs}>${inner}</${vnode.type}>`
}

/**
 * 岛屿占位节点：
 *   - `data-island-id` 是服务端与客户端之间唯一的锚点，客户端据此找到挂载位置；
 *   - 子节点被有意忽略——首屏静态内容不由岛屿子树提供，而是留给客户端 mount 决定；
 *   - `islandId` 可显式指定 id，否则用 ctx 产出稳定自动编号。
 */
function renderIslandPlaceholder(vnode: VNode, ctx: RenderContext): string {
    const explicit = vnode.props[ISLAND_ID_KEY]
    const islandId =
        typeof explicit === 'string' && explicit.length > 0 ? explicit : ctx.nextId()

    // 收集清单：剔除保留字段后的其余 props 原样透传给客户端
    const props: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(vnode.props)) {
        if (RESERVED_ISLAND_KEYS.has(key)) continue
        props[key] = value
    }
    ctx.islands.push({ id: islandId, name: vnode.type, props })

    return `<div data-island-id="${escapeHtml(islandId)}"></div>`
}

/**
 * 渲染属性串。规则：
 *   - 保留字段与 `false` / `null` / `undefined` 跳过；
 *   - `true` 渲染为布尔属性（`disabled`）；
 *   - 字符串 / 数字渲染为 `key="转义值"`；
 *   - 对象 / 函数等宿主无法直接表达的属性一律跳过。
 */
function renderAttrs(props: Readonly<Record<string, unknown>>): string {
    let out = ''
    for (const [key, value] of Object.entries(props)) {
        if (RESERVED_ISLAND_KEYS.has(key)) continue
        if (value === null || value === undefined || value === false) continue
        if (value === true) {
            out += ` ${key}`
            continue
        }
        if (typeof value === 'string' || typeof value === 'number') {
            out += ` ${key}="${escapeHtml(String(value))}"`
        }
    }
    return out
}

/** 一次页面渲染的产物：静态 HTML + 岛屿清单 */
export interface RenderedPage {
    readonly html: string
    readonly islands: IslandDescriptor[]
}

/**
 * 渲染整页：返回「一份 HTML + 一份岛屿清单」。
 * 这正是 SSR 交付给客户端的两件东西——静态骨架与待激活的岛屿描述。
 */
export function renderPage(root: VNodeChild): RenderedPage {
    const ctx = createRenderContext()
    const html = renderToString(root, ctx)
    return { html, islands: ctx.islands }
}

/** 只关心岛屿清单时的便捷封装（内部复用 renderPage，保证编号规则一致） */
export function collectIslands(root: VNodeChild): IslandDescriptor[] {
    return renderPage(root).islands
}
