// 文件: examples/117-04-keyboard-avoid-layout.ts
// 键盘避让布局：滚动容器高度重算、输入框抬升、吸底按钮避让与边界回弹
// 目标：键盘弹出后输入框可见、提交按钮不被遮挡、滚动到底不越界（回弹量可测）

import assert from 'node:assert';

interface LayoutInput {
    viewportHeight: number;
    headerHeight: number;
    bottomBarHeight: number;
    safeAreaBottom: number;
    keyboardHeight: number;
    /** 滚动内容总高（已包含底部操作栏留白） */
    contentHeight: number;
}

interface LayoutState {
    /** 键盘以上、头尾之外真正可滚动的区域高度 */
    scrollViewportHeight: number;
    maxScroll: number;
    /** 吸底按钮距视口底部的距离：无键盘时吃安全区，有键盘时抬到键盘上沿 */
    bottomBarBottom: number;
}

function computeLayout(input: LayoutInput): LayoutState {
    const visibleHeight = Math.max(0, input.viewportHeight - input.keyboardHeight);
    const scrollViewportHeight = Math.max(0, visibleHeight - input.headerHeight - input.bottomBarHeight);
    return {
        scrollViewportHeight,
        maxScroll: Math.max(0, input.contentHeight - scrollViewportHeight),
        bottomBarBottom: input.keyboardHeight > 0 ? input.keyboardHeight : input.safeAreaBottom,
    };
}

interface RevealResult {
    scrollTop: number;
    /** 到达 maxScroll 后仍然超出可视区的像素数 */
    occluded: number;
}

/** 将输入框底边抬到可视区底部上方 margin 处，结果钳制在 [0, maxScroll] */
function ensureInputVisible(inputBottom: number, scrollTop: number, layout: LayoutState, margin = 8): RevealResult {
    const visibleBottom = scrollTop + layout.scrollViewportHeight;
    const overflow = inputBottom + margin - visibleBottom;
    if (overflow <= 0) return { scrollTop, occluded: 0 };

    const next = Math.min(layout.maxScroll, scrollTop + overflow);
    const remaining = inputBottom + margin - (next + layout.scrollViewportHeight);
    return { scrollTop: next, occluded: Math.max(0, remaining) };
}

interface BounceResult {
    scrollTop: number;
    /** 越界的橡皮筋偏移：负数=顶部下拉，正数=底部上拉 */
    bounce: number;
}

/** 滚动越界钳制：用于 touchmove 期间禁用原生回弹，松手后把 bounce 归零 */
function overscroll(proposed: number, maxScroll: number): BounceResult {
    if (proposed < 0) return { scrollTop: 0, bounce: proposed };
    if (proposed > maxScroll) return { scrollTop: maxScroll, bounce: proposed - maxScroll };
    return { scrollTop: proposed, bounce: 0 };
}

function runAssertions() {
    // ---------- 测试 1：无键盘——按钮吃 Home Indicator，输入框只滚 16px ----------
    const closed = computeLayout({
        viewportHeight: 844,
        headerHeight: 88,
        bottomBarHeight: 64,
        safeAreaBottom: 34,
        keyboardHeight: 0,
        contentHeight: 1600,
    });
    assert.equal(closed.scrollViewportHeight, 692);
    assert.equal(closed.maxScroll, 908);
    assert.equal(closed.bottomBarBottom, 34, '无键盘时按钮要避开 Home Indicator');
    const r1 = ensureInputVisible(700, 0, closed);
    assert.equal(r1.scrollTop, 16);
    assert.equal(r1.occluded, 0);
    console.log('[1/4] 无键盘布局 OK, 可滚动高:', closed.scrollViewportHeight);

    // ---------- 测试 2：键盘弹出——滚动区变矮、按钮抬到键盘上沿、输入框仍可见 ----------
    const open = computeLayout({
        viewportHeight: 844,
        headerHeight: 88,
        bottomBarHeight: 64,
        safeAreaBottom: 34,
        keyboardHeight: 300,
        contentHeight: 1600,
    });
    assert.equal(open.scrollViewportHeight, 392, '844 - 300 - 88 - 64');
    assert.equal(open.maxScroll, 1208);
    assert.equal(open.bottomBarBottom, 300, '有键盘时按钮距底 300，正好在键盘上沿');
    const r2 = ensureInputVisible(700, 0, open);
    assert.equal(r2.scrollTop, 316);
    assert.equal(r2.occluded, 0);
    assert.ok(open.bottomBarBottom >= 300, '按钮距底不应小于键盘高度，否则会落进键盘区域');
    console.log('[2/4] 键盘避让按钮 OK, 按钮距底:', open.bottomBarBottom);

    // ---------- 测试 3：滚动到上限——补偿被截断，剩余遮挡必须靠底部留白 ----------
    const tight = computeLayout({
        viewportHeight: 700,
        headerHeight: 60,
        bottomBarHeight: 50,
        safeAreaBottom: 0,
        keyboardHeight: 300,
        contentHeight: 1000,
    });
    assert.equal(tight.scrollViewportHeight, 290);
    assert.equal(tight.maxScroll, 710);
    const r3 = ensureInputVisible(995, 600, tight);
    assert.equal(r3.scrollTop, 710, '不得超过 maxScroll');
    assert.equal(r3.occluded, 3, '995 + 8 - (710 + 290) = 3');
    console.log('[3/4] 滚动上限截断 OK, 剩余遮挡:', r3.occluded);

    // ---------- 测试 4：越界回弹——上下越界都被钳制，松手后偏移归零 ----------
    assert.deepEqual(overscroll(-40, 710), { scrollTop: 0, bounce: -40 });
    assert.deepEqual(overscroll(760, 710), { scrollTop: 710, bounce: 50 });
    assert.deepEqual(overscroll(300, 710), { scrollTop: 300, bounce: 0 });
    assert.equal(overscroll(710, 710).bounce, 0, '恰好在边界不应产生回弹');
    console.log('[4/4] 越界回弹 OK, 底部越界:', overscroll(760, 710).bounce);

    console.log('\n✅ 117-04 键盘避让布局 全部断言通过');
}

runAssertions();
