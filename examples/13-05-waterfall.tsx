// 文件: examples/13-05-waterfall.tsx —— 取数 waterfall:从 1.5s 到 0.5s
// ============ ❌ 反例:串行 await 形成请求瀑布 ============
// export default async function Dashboard() {
//     const user = await getUser();          // 500ms
//     const orders = await getOrders(user.id); // 依赖 user,再 500ms
//     const stats = await getStats(user.id);   // 再 500ms → 共 1.5s
// }

// ============ ✅ 方案一:先并行无依赖请求,再补依赖请求 ============
export default async function Dashboard() {
    const userPromise = getUser();                         // 立即发起,不 await
    const [orders, stats] = await Promise.all([
        getOrdersPublic(),                                  // 无需 user 的部分先并行
        getStatsPublic(),
    ]);
    const user = await userPromise;                        // 与上面并行进行
    return <Summary user={user} orders={orders} stats={stats} />;
}
declare function getUser(): Promise<{ id: string }>;
declare function getOrdersPublic(): Promise<unknown[]>;
declare function getStatsPublic(): Promise<unknown>;

// ============ ✅✅ 方案二:慢请求包进 Suspense,流式先送其余部分 ============
// <main>
//     <Summary user={user} />               {/* 立刻流式送达 */}
//     <Suspense fallback={<OrdersSkeleton />}>
//         <OrdersPanel />                    {/* 内部 await getOrders,好了再送 */}
//     </Suspense>
// </main>
// 首字节时间(TTFB)取决于最快的部分,而不是最慢的请求
