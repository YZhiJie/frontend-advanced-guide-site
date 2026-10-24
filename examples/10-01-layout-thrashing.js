// 文件: examples/10-01-layout-thrashing.js —— [浏览器] 布局抖动的罪与罚

const items = document.querySelectorAll('.item');

// ❌ 反例:读写交替,每次 offsetHeight 都强制同步布局 —— N 次布局
// items.forEach((el) => {
//     const top = el.offsetTop;      // 读(强制布局)
//     el.style.transform = `translateY(${top + 10}px)`; // 写(使布局失效)
// });

// ✅ 正确:先批量读,再批量写 —— 只布局 1 次(读写分离/FastDom 模式)
requestAnimationFrame(() => {
    const tops = Array.from(items).map((el) => el.offsetTop); // 批量读
    tops.forEach((top, i) => {
        items[i].style.transform = `translateY(${top + 10}px)`; // 批量写
    });
});

// ✅ 动画永远用 transform/opacity(只走合成,不触发重排重绘)
// ❌ el.style.left = '100px'      → 触发重排
// ✅ el.style.transform = 'translateX(100px)' → 只合成
export {};
