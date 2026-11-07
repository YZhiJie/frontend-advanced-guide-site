// 文件: cases/10-virtual-list-lab/src/virtual-list.ts
// ============ 手写虚拟列表核心算法：定高/变高窗口计算 + 前缀和偏移 + 二分定位 ============

/** 单项几何信息：index 为列表下标，offset 为该锚点距列表顶部的位移 */
export interface VisibleItem {
    index: number
    offset: number
}

/** 可视窗口：供渲染层 translateY(offsetY)，只渲染 [startIndex, endIndex] 区间 */
export interface VisibleRange {
    /** 首个可见项下标（已含 overscan 缓冲），空列表为 0 */
    startIndex: number
    /** 末个可见项下标（已含 overscan 缓冲），空列表为 -1 */
    endIndex: number
    /** 首项位移：startIndex 对应项距列表顶部的距离，可直接用作容器位移 */
    offsetY: number
}

export interface VirtualListOptions {
    /** 列表总项数 */
    itemCount: number
    /** 视口（滚动容器）高度，px */
    viewportHeight: number
    /**
     * 单项高度（px）：
     * - 定高模式：所有项等高，直接作为统一高度；
     * - 变高模式：作为未测项的预估值（estimatedItemHeight），实测后逐项校正。
     */
    itemHeight: number
    /** 可视区上下各额外渲染的缓冲项数，默认 2 */
    overscan?: number
}

export interface VirtualListApi {
    /** 更新滚动位置（px），负值归零；读取时按最大可滚动距离夹紧 */
    setScrollTop(scrollTop: number): void
    /** 更新视口高度（px） */
    setViewportHeight(viewportHeight: number): void
    /** 记录第 index 项真实高度并重算偏移表（变高模式）；越界/非法高度忽略 */
    measure(index: number, height: number): void
    /** 当前可视窗口（含 overscan 缓冲） */
    getRange(): VisibleRange
    /** 可视项列表，按 index 升序；offset 为该项距顶部位移 */
    getVisibleItems(): VisibleItem[]
    /** 列表总高度：预估 + 已测校正后的结果 */
    getTotalHeight(): number
    /** 读取当前（已夹紧的）滚动位置 */
    getScrollTop(): number
    /** 第 index 项高度：已测用真实值，未测用预估值 */
    getItemHeight(index: number): number
    /** 第 index 项距顶部的位移 */
    getItemOffset(index: number): number
}

export function createVirtualList(options: VirtualListOptions): VirtualListApi {
    const overscan = Math.max(0, Math.floor(options.overscan ?? 2))
    const itemCount = Math.max(0, Math.floor(options.itemCount))
    const estimated = Math.max(0, options.itemHeight)

    let viewportHeight = Math.max(0, options.viewportHeight)
    let scrollTop = 0
    /** 已测真实高度；undefined 表示未测，回退到预估 */
    let measured: (number | undefined)[] = new Array<number | undefined>(itemCount)
    /** 前缀和偏移表，长度 itemCount + 1：offsets[i] 为第 i 项顶部位移 */
    let offsets: number[] = []

    const heightAt = (index: number): number => measured[index] ?? estimated

    /** 重建前缀和偏移表：O(n)，measure 后整体重算 */
    const rebuildOffsets = (): void => {
        const table = new Array<number>(itemCount + 1)
        table[0] = 0
        for (let i = 0; i < itemCount; i++) {
            table[i + 1] = table[i] + heightAt(i)
        }
        offsets = table
    }

    const totalHeight = (): number => offsets[itemCount]
    const maxScroll = (): number => Math.max(0, totalHeight() - viewportHeight)
    const clampedScrollTop = (): number => Math.max(0, Math.min(scrollTop, maxScroll()))

    /** 二分：满足 offsets[i] <= y 的最大 i（0..itemCount），即 y 落在第 i 项内 */
    const findStartIndexByOffset = (y: number): number => {
        let lo = 0
        let hi = itemCount
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (offsets[mid] <= y) lo = mid
            else hi = mid - 1
        }
        return lo
    }

    /** 二分：满足 offsets[i] >= y 的最小 i（0..itemCount），即可视区下沿的首个不可见项 */
    const findEndExclusiveByOffset = (y: number): number => {
        let lo = 0
        let hi = itemCount
        while (lo < hi) {
            const mid = (lo + hi) >> 1
            if (offsets[mid] < y) lo = mid + 1
            else hi = mid
        }
        return lo
    }

    rebuildOffsets()

    const getRange = (): VisibleRange => {
        if (itemCount === 0) return { startIndex: 0, endIndex: -1, offsetY: 0 }
        const top = clampedScrollTop()
        const bottom = top + viewportHeight
        const rawStart = findStartIndexByOffset(top)
        const rawEndExclusive = findEndExclusiveByOffset(bottom)
        // overscan 夹紧：上不越过首项，下不越过末项
        const startIndex = Math.max(0, rawStart - overscan)
        const endIndex = Math.min(itemCount, rawEndExclusive + overscan) - 1
        return { startIndex, endIndex, offsetY: offsets[startIndex] }
    }

    const getVisibleItems = (): VisibleItem[] => {
        const { startIndex, endIndex } = getRange()
        const items: VisibleItem[] = []
        for (let i = startIndex; i <= endIndex; i++) {
            items.push({ index: i, offset: offsets[i] })
        }
        return items
    }

    const measure = (index: number, height: number): void => {
        if (!Number.isInteger(index) || index < 0 || index >= itemCount) return
        if (!Number.isFinite(height) || height < 0) return
        if (measured[index] === height) return
        measured[index] = height
        rebuildOffsets()
    }

    const setScrollTop = (next: number): void => {
        scrollTop = Math.max(0, next)
    }

    const setViewportHeight = (next: number): void => {
        viewportHeight = Math.max(0, next)
    }

    return {
        setScrollTop,
        setViewportHeight,
        measure,
        getRange,
        getVisibleItems,
        getTotalHeight: totalHeight,
        getScrollTop: clampedScrollTop,
        getItemHeight: heightAt,
        getItemOffset: (index: number) => offsets[index] ?? 0,
    }
}
