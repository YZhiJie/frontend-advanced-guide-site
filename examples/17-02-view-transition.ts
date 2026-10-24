// 文件: examples/17-02-view-transition.ts —— View Transitions:状态切换的共享元素动画
// ============ document.startViewTransition:让浏览器自动做 FLIP ============

// 场景:列表 → 详情的共享元素过渡(图片从卡片位置放大到全屏)
async function openDetail(cardEl: HTMLElement) {
    if (!document.startViewTransition) {
        showDetailDirectly(); // 不支持的浏览器:直接切换,优雅降级
        return;
    }
    // 浏览器截取旧状态 → 更新 DOM → 截取新状态 → 自动生成两状态间的过渡
    await document.startViewTransition(() => showDetailDirectly()).updateCallbackDone;

    // 配合 CSS 命名共享元素,图片平滑放大:
    // .card img { view-transition-name: hero; }
    // .detail img { view-transition-name: hero; }   ← 同名元素之间自动补间
}
declare function showDetailDirectly(): void;

// ---- Speculation Rules:声明式预渲染(MPA 秒开) ----
// <script type="speculationrules">
// {
//     "prerender": [{
//         "where": { "href_matches": "/products/*" },
//         "eagerness": "moderate"   // 悬停/预连线时预渲染
//     }]
// }
// </script>
// 效果:用户点击时页面已经渲染完成,≈0ms 导航 —— MPA 也能有 SPA 的体验
export {};
