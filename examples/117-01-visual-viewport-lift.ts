// 文件: examples/117-01-visual-viewport-lift.ts
// 软键盘顶起计算：overlay(iOS) / resize(Android) 两种模式下的键盘高度、可视区与滚动补偿
// 目标：键盘高度可算、遮挡可判定、滚动补偿量有界（不越界、底部不误留白）

import assert from 'node:assert';

/** iOS 键盘覆盖布局视口（overlay）；Android 多数机型压缩布局视口（resize） */
type KeyboardMode = 'overlay' | 'resize';

interface ViewportSnapshot {
    mode: KeyboardMode;
    /** 无键盘时的布局视口高度，用于推 resize 模式的键盘高度 */
    baselineLayoutHeight: number;
    /** 当前 layout viewport 高度：overlay 模式不变，resize 模式被键盘压缩 */
    layoutHeight: number;
    /** visualViewport.height：两种模式都只剩键盘以上区域 */
    visualHeight: number;
    /** visualViewport.offsetTop：页面被顶起/滚动的偏移 */
    visualOffsetTop: number;
    /** 页面滚动量 */
    scrollY: number;
    /** 文档总高，用于算滚动上限 */
    documentHeight: number;
}

interface Rect {
    top: number;
    bottom: number;
}

/** 键盘占用的高度（CSS px） */
function keyboardHeight(vp: ViewportSnapshot): number {
    if (vp.mode === 'resize') {
        // Android：布局视口被压扁，键盘高度 = 基线高度 - 当前布局高度
        return Math.max(0, vp.baselineLayoutHeight - vp.layoutHeight);
    }
    // iOS：布局视口不变，只能用 visualViewport 的收缩量推算
    return Math.max(0, vp.baselineLayoutHeight - vp.visualHeight - vp.visualOffsetTop);
}

/** 可视区在文档坐标系中的底边（即键盘上沿） */
function visibleBottom(vp: ViewportSnapshot): number {
    return vp.scrollY + vp.visualOffsetTop + vp.visualHeight;
}

/** 文档允许的最大滚动量 */
function maxScroll(vp: ViewportSnapshot): number {
    return Math.max(0, vp.documentHeight - vp.visualHeight);
}

/**
 * 把元素滚动到可视区内还差多少滚动量。
 * 返回 0 表示已可见；返回正数需要向下滚；被文档底部截断时返回不足额的量。
 */
function revealDelta(rect: Rect, vp: ViewportSnapshot, margin = 8): number {
    const overflow = rect.bottom + margin - visibleBottom(vp);
    if (overflow <= 0) return 0;
    const room = Math.max(0, maxScroll(vp) - vp.scrollY);
    return Math.min(overflow, room);
}

function runAssertions() {
    // ---------- 测试 1：iOS overlay 模式——布局高度不变，键盘高度从 visualViewport 反推 ----------
    const ios: ViewportSnapshot = {
        mode: 'overlay',
        baselineLayoutHeight: 667,
        layoutHeight: 667,
        visualHeight: 375,
        visualOffsetTop: 0,
        scrollY: 0,
        documentHeight: 1200,
    };
    assert.equal(keyboardHeight(ios), 292, 'iOS 键盘高度应为 667 - 375');
    assert.equal(visibleBottom(ios), 375, '可视区底边应等于 visualViewport 底边');
    console.log('[1/4] iOS overlay 键盘高度 OK, 键盘:', keyboardHeight(ios));

    // ---------- 测试 2：Android resize 模式——布局视口本身被压缩 ----------
    const android: ViewportSnapshot = {
        mode: 'resize',
        baselineLayoutHeight: 800,
        layoutHeight: 500,
        visualHeight: 500,
        visualOffsetTop: 0,
        scrollY: 0,
        documentHeight: 1400,
    };
    assert.equal(keyboardHeight(android), 300);
    assert.equal(visibleBottom(android), 500);
    // 无键盘时不应该凭空算出键盘高度
    const closed: ViewportSnapshot = { ...android, layoutHeight: 800, visualHeight: 800 };
    assert.equal(keyboardHeight(closed), 0);
    console.log('[2/4] Android resize 键盘高度 OK, 键盘:', keyboardHeight(android));

    // ---------- 测试 3：输入框被键盘遮挡时，滚动补偿恰好把它抬到键盘上方 ----------
    const hidden: ViewportSnapshot = {
        mode: 'overlay',
        baselineLayoutHeight: 667,
        layoutHeight: 667,
        visualHeight: 408,
        visualOffsetTop: 120,
        scrollY: 0,
        documentHeight: 900,
    };
    const input: Rect = { top: 500, bottom: 548 };
    const delta = revealDelta(input, hidden);
    // 可视区底边 = 0 + 120 + 408 = 528；需要 548 + 8 - 528 = 28
    assert.equal(delta, 28, '补偿量应为输入框底边加间距超出可视区的部分');
    const after: ViewportSnapshot = { ...hidden, scrollY: delta };
    assert.equal(revealDelta(input, after), 0, '补偿后输入框应完全可见');
    assert.ok(input.bottom + 8 <= visibleBottom(after), '输入框底边加间距不应超过键盘上沿');
    console.log('[3/4] 遮挡滚动补偿 OK, 补偿量:', delta);

    // ---------- 测试 4：接近文档底部时补偿被截断，剩余遮挡要靠 padding 兜底 ----------
    const nearBottom: ViewportSnapshot = {
        mode: 'overlay',
        baselineLayoutHeight: 667,
        layoutHeight: 667,
        visualHeight: 300,
        visualOffsetTop: 0,
        scrollY: 500,
        documentHeight: 1000,
    };
    const lowInput: Rect = { top: 960, bottom: 1000 };
    const clamped = revealDelta(lowInput, nearBottom);
    // maxScroll = 1000 - 300 = 700，当前 500，最多还能滚 200；需求 208，被截断
    assert.equal(clamped, 200, '补偿量应被 maxScroll 截断');
    const bottom: ViewportSnapshot = { ...nearBottom, scrollY: 700 };
    assert.equal(revealDelta(lowInput, bottom), 0, '已无滚动空间，补偿量为 0');
    assert.ok(lowInput.bottom + 8 > visibleBottom(bottom), '8px 间距仍缺失，只能靠容器底部留白兜底');
    assert.equal(visibleBottom(bottom), 1000, '滚到底时可视区底边等于文档高度');
    console.log('[4/4] 底部截断 OK, 截断后补偿:', clamped);

    console.log('\n✅ 117-01 visualViewport 顶起计算 全部断言通过');
}

runAssertions();
