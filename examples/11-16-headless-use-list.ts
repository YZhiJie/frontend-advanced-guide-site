/**
 * 11-16 Headless 列表逻辑 —— 逻辑与 UI 彻底分离
 *
 * 设计决策:
 * 1. useList 只管"取数与翻页状态",不渲染任何东西 —— 可独立单测、可跨项目复用;
 * 2. 示例用普通对象模拟响应式(接 Vue 换 ref、接 React 用 useState,骨架不变);
 * 3. loading 中忽略重复 load —— 状态机思想,最朴素的请求去重(详见 6.5 竞态处理)。
 *
 * 坑点:
 * - 翻页追加时必须按"第 1 页重置,否则追加"处理,否则筛选变化后列表会残留旧数据;
 * - fetcher 抛错时 loading 必须在 finally 里复位,否则一次失败后按钮永久禁用。
 */

interface UseListOptions<T> {
    fetcher: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>;
    pageSize?: number;
}

/** 只管"取数与翻页状态",不渲染任何东西 —— 可单测、可跨项目复用 */
function useList<T>(opts: UseListOptions<T>) {
    const page = { current: 1 };
    const items: { value: T[] } = { value: [] };
    const loading = { value: false };

    async function load(p = 1) {
        if (loading.value) return; // 状态机思想(11.1):loading 中忽略重复请求
        loading.value = true;
        try {
            const { items: list } = await opts.fetcher(p, opts.pageSize ?? 20);
            items.value = p === 1 ? list : [...items.value, ...list]; // 第 1 页重置,否则追加
            page.current = p;
        } finally {
            loading.value = false;
        }
    }
    return {
        items,
        loading,
        next: () => load(page.current + 1),
        reload: () => load(1), // 下拉刷新/筛选变化
    };
}

// ---- 演示:Node 环境直接跑通逻辑层(无 UI)----
const list = useList<{ id: number; name: string }>({
    fetcher: async (page, pageSize) => {
        console.log(`请求第 ${page} 页,每页 ${pageSize}`);
        return {
            items: Array.from({ length: pageSize }, (_, i) => ({ id: (page - 1) * pageSize + i + 1, name: `条目${(page - 1) * pageSize + i + 1}` })),
            total: 100,
        };
    },
    pageSize: 3,
});

await list.reload();
console.log('第 1 页:', list.items.value.map((i) => i.id));
await list.next();
console.log('追加后:', list.items.value.map((i) => i.id));
await list.reload();
console.log('刷新后(重置):', list.items.value.map((i) => i.id));

// UI 层(React/Vue 均可)只负责把 items 画出来 —— 逻辑可独立 vitest 单测,不用渲染组件
export {};
